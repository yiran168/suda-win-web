/**
 * 打印机连接管理：SPP（经典蓝牙虚拟串口，Electron）/ Web Serial（浏览器直连）双通道状态机。
 * - 断线自动重连，退避 1/2/4/8/15/30 秒（Web Serial 用已授权端口重开，无需再次弹窗）
 * - 每 10 秒轮询状态；打印期间暂停轮询，避免查询字节混入打印数据流
 *
 * 说明：这批打印机是 SPP+BLE 双模，但 BLE 透传模组缓冲太小，实测无法承载
 * 点阵打印数据（三个上游实现——安卓/鸿蒙/Windows——也全部只走 SPP），
 * 因此本应用只保留串口类通道（桌面 SPP / 浏览器 Web Serial）。
 */
import { PrinterStatus, PrinterTransport, QringPrinter } from '../protocol/qring';
import { SppTransport } from './spp';
import { WebSerialTransport, SerialPortLike } from './webSerial';
import { loadPrefs, savePrefs } from '../store/local';
import { logError, logInfo, logWarn } from '../logging/logger';

export type ChannelKind = 'spp' | 'webserial';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'printing';

/** 断连重连参数：SPP 记端口路径；Web Serial 用已授权端口对象（webSerialPort 字段） */
type ConnectArgs =
  | { kind: 'spp'; port: string; baud: number }
  | { kind: 'webserial'; baud: number };

export interface PrinterSnapshot {
  state: ConnectionState;
  channel: ChannelKind | null;
  deviceLabel: string;
  status: PrinterStatus | null;
  battery: number | null;
  lastError: string;
}

type Listener = () => void;

const BACKOFF_SECONDS = [1, 2, 4, 8, 15, 30];
const POLL_INTERVAL_MS = 10000;

class PrinterManager {
  private printer: QringPrinter | null = null;
  private transport: PrinterTransport | null = null;
  private state: ConnectionState = 'disconnected';
  private channel: ChannelKind | null = null;
  private deviceLabel = '';
  private lastStatus: PrinterStatus | null = null;
  private battery: number | null = null;
  private lastError = '';
  private listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConnectArgs: ConnectArgs | null = null;
  /** Web Serial 已授权端口对象（重连复用，getPorts() 对同一端口返回同一引用） */
  private webSerialPort: SerialPortLike | null = null;
  private manualDisconnect = false;
  private reconnectAbandoned = false; // 不可恢复的重连失败：awaitReady 据此提前放行
  private cachedSnap: PrinterSnapshot | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): PrinterSnapshot {
    // useSyncExternalStore 要求快照引用稳定：未变化时返回同一对象
    if (!this.cachedSnap) {
      this.cachedSnap = {
        state: this.state, channel: this.channel, deviceLabel: this.deviceLabel,
        status: this.lastStatus, battery: this.battery, lastError: this.lastError,
      };
    }
    return this.cachedSnap;
  }

  private emit(): void {
    this.cachedSnap = null;
    this.listeners.forEach((fn) => fn());
  }

  /** 当前是否可打印 */
  isReady(): boolean { return this.state === 'connected' && !!this.printer; }

  /** 打印任务专用：返回打印机并把状态切到 printing（暂停轮询） */
  acquireForPrint(): QringPrinter | null {
    if (!this.printer || this.state !== 'connected') return null;
    this.state = 'printing';
    this.stopPolling();
    this.emit();
    return this.printer;
  }

  releaseFromPrint(): void {
    // 打印途中断过线时 state 已被 onUnexpectedDisconnect 置为 disconnected 并启动重连，
    // 这里只在仍处于 printing 的正常路径上收口
    if (this.state !== 'printing') return;
    this.state = 'connected';
    this.startPolling();
    this.emit();
  }

  /** 打印任务断点续打用：等自动重连完成（断连后由 scheduleReconnect 驱动） */
  async awaitReady(timeoutMs = 25000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.isReady()) return true;
      if (this.reconnectAbandoned) return false; // 重连不可行，不空等
      await new Promise((r) => setTimeout(r, 300));
    }
    return this.isReady();
  }

  /** 单独走纸：不打印内容，仅向前送纸 dots 点（首页「走纸」入口） */
  async feedPaper(dots: number): Promise<void> {
    const printer = this.acquireForPrint();
    if (!printer) throw new Error('打印机未连接');
    try {
      logInfo('print', `单独走纸 ${dots} 点`);
      await printer.wakeup();
      await printer.enable();
      await printer.feed(dots);
      await printer.stop();
      logInfo('print', '走纸完成');
    } finally {
      this.releaseFromPrint();
    }
  }

  async connectSpp(portPath: string, baud = 115200): Promise<void> {
    await this.teardown();
    this.manualDisconnect = false;
    this.state = 'connecting';
    this.channel = 'spp';
    this.deviceLabel = portPath;
    this.lastConnectArgs = { kind: 'spp', port: portPath, baud };
    this.emit();
    try {
      const transport = new SppTransport(portPath, baud);
      await transport.open();
      this.attach(transport);
      this.rememberLast(portPath);
      logInfo('transport', `打印机连接成功（SPP ${portPath}）`);
    } catch (e) {
      this.fail(`SPP 连接失败：${String(e)}`);
      throw e;
    }
  }

  /** 浏览器通道：弹浏览器串口选择器（用户手势）→ 连接；用户取消则静默返回 */
  async connectWebSerial(): Promise<void> {
    const port = await WebSerialTransport.requestPort();
    if (!port) return;
    await this.connectWebSerialPort(port, loadPrefs().baud);
  }

  /** 用已知端口对象建立 Web Serial 连接（手动连接 / 自动重连共用） */
  private async connectWebSerialPort(port: SerialPortLike, baud: number): Promise<void> {
    await this.teardown();
    this.manualDisconnect = false;
    this.state = 'connecting';
    this.channel = 'webserial';
    this.deviceLabel = '浏览器串口（Web Serial）';
    this.lastConnectArgs = { kind: 'webserial', baud };
    this.webSerialPort = port;
    this.emit();
    try {
      const transport = new WebSerialTransport(port, baud);
      transport.onDrop = () => this.onUnexpectedDisconnect();
      await transport.open();
      this.attach(transport);
      const p = loadPrefs();
      savePrefs({ ...p, lastChannel: 'webserial', lastDevice: 'webserial' });
      logInfo('transport', '打印机连接成功（Web Serial）');
    } catch (e) {
      this.fail(`Web Serial 连接失败：${String(e)}`);
      throw e;
    }
  }

  /** 记住上次成功连接的端口，供「自动重连上次设备」 */
  private rememberLast(portPath: string): void {
    try {
      const p = loadPrefs();
      savePrefs({ ...p, lastChannel: 'spp', lastDevice: portPath });
    } catch { /* 忽略 */ }
  }

  /** 启动时自动重连上次设备（设置里可关）。静默失败只记日志，不打扰界面。 */
  async autoReconnect(): Promise<void> {
    const p = loadPrefs();
    if (!p.autoReconnect || !p.lastDevice || this.state !== 'disconnected') return;
    if (p.lastChannel === 'webserial') {
      // Web Serial：只自动连「唯一已授权」的端口，多个时不猜（防连错设备）
      try {
        const granted = await WebSerialTransport.grantedPorts();
        if (granted.length === 1) {
          logInfo('transport', '自动重连上次设备：Web Serial');
          await this.connectWebSerialPort(granted[0], p.baud);
        }
      } catch (e) {
        logWarn('transport', `自动重连失败：${String(e)}（可手动连接）`);
        this.state = 'disconnected';
        this.emit();
      }
      return;
    }
    logInfo('transport', `自动重连上次设备：SPP ${p.lastDevice}`);
    try {
      await this.connectSpp(p.lastDevice, p.baud);
    } catch (e) {
      logWarn('transport', `自动重连失败：${String(e)}（可手动连接）`);
      this.state = 'disconnected';
      this.emit();
    }
  }

  private attach(transport: PrinterTransport): void {
    this.transport = transport;
    const protocol = loadPrefs().protocol;
    this.printer = new QringPrinter(transport, true, protocol);
    this.state = 'connected';
    this.lastError = '';
    this.reconnectAttempts = 0;
    this.reconnectAbandoned = false;
    this.emit();
    void this.pollOnce();
    this.startPolling();
    if (protocol === 'escpos') logInfo('transport', '通用 ESC/POS 模式：跳过私有握手与状态查询');
  }

  private fail(message: string): void {
    logError('transport', message);
    this.state = 'disconnected';
    this.lastError = message;
    this.emit();
  }

  /** 串口断开由轮询失败/写入失败暴露（serialport 无主动断开事件），在打印循环里感知 */
  onUnexpectedDisconnect(): void {
    if (this.manualDisconnect) return;
    if (this.state === 'disconnected') return;
    const wasPrinting = this.state === 'printing';
    logWarn('transport', wasPrinting
      ? '打印途中连接断开（本份可能不完整），立即自动重连，任务将断点续打'
      : '连接意外断开，准备自动重连…');
    this.state = 'disconnected';
    this.emit();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const args = this.lastConnectArgs;
    if (!args || this.manualDisconnect) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAbandoned = false; // 新一轮重连开始，清除上一轮的放弃标记
    const delay = BACKOFF_SECONDS[Math.min(this.reconnectAttempts, BACKOFF_SECONDS.length - 1)] * 1000;
    this.reconnectAttempts += 1;
    logInfo('transport', `${delay / 1000} 秒后尝试第 ${this.reconnectAttempts} 次重连`);
    this.reconnectTimer = setTimeout(() => { void this.tryReconnect(args); }, delay);
  }

  private async tryReconnect(args: ConnectArgs): Promise<void> {
    this.reconnectTimer = null;
    if (this.state === 'connected') return; // 已被别的路径（如手动连接）恢复
    try {
      if (args.kind === 'webserial') {
        // 已授权端口仍在列表里才重开；授权失效（拔出/取消配对）则停住等手动连接
        const port = this.webSerialPort;
        const granted = await WebSerialTransport.grantedPorts();
        if (!port || !granted.includes(port)) {
          this.reconnectAbandoned = true;
          logWarn('transport', 'Web Serial 端口授权已失效，请手动重新连接');
          return;
        }
        const transport = new WebSerialTransport(port, args.baud);
        transport.onDrop = () => this.onUnexpectedDisconnect();
        await transport.open();
        this.attach(transport);
        logInfo('transport', '自动重连成功（Web Serial）');
        return;
      }
      const transport = new SppTransport(args.port, args.baud);
      await transport.open();
      this.attach(transport);
      logInfo('transport', '自动重连成功（SPP）');
    } catch (e) {
      const msg = String(e);
      // 端口不存在（打印机关机/蓝牙断配）：持续退避无意义，停住等用户手动连接
      if (/cannot open|not found|不存在|无法打开/i.test(msg) && this.reconnectAttempts >= 4) {
        this.reconnectAbandoned = true;
        logWarn('transport', '多次重连失败（打印机可能已关机或取消配对），已停止重试，请手动连接');
        return;
      }
      logWarn('transport', `重连失败：${msg}`);
      this.scheduleReconnect();
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => { void this.pollOnce(); }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  /** 打印中不要调用：查询字节会混入打印数据流 */
  async pollOnce(): Promise<void> {
    if (!this.printer || this.state !== 'connected') return;
    try {
      this.lastStatus = await this.printer.status();
      this.battery = await this.printer.battery();
      this.emit();
    } catch (e) {
      logWarn('protocol', `状态轮询失败：${String(e)}`);
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.teardown();
    this.webSerialPort = null;
    this.state = 'disconnected';
    this.deviceLabel = '';
    this.lastStatus = null;
    this.battery = null;
    this.emit();
    logInfo('transport', '已手动断开打印机');
  }

  private async teardown(): Promise<void> {
    this.stopPolling();
    try { await this.transport?.close(); } catch { /* 忽略 */ }
    this.transport = null;
    this.printer = null;
  }
}

export const printerManager = new PrinterManager();
