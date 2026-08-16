/**
 * Web Serial 传输：Chrome / Edge 浏览器直连 SPP 虚拟串口（不经 Electron）。
 * 仅在支持 navigator.serial 的浏览器可用（Firefox / Safari 不支持 Web Serial）。
 * 与 SppTransport 的差异：
 * - 端口由浏览器选择器授权——requestPort 必须由用户手势触发，不能静默调用；
 * - 已授权端口可通过 getPorts() 找回（自动重连不需要再次弹窗）；
 * - 设备断开由流结束（read done）/ 写入失败暴露，经 onDrop 回调通知上层重连。
 */
import { PrinterTransport } from '../protocol/qring';
import { logInfo, logWarn } from '../logging/logger';

/* Web Serial 最小类型声明：TS dom lib 未内建这套类型，自己声明避免引入外部类型包 */
export interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
interface NavigatorSerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}
function serialApi(): NavigatorSerialLike | null {
  return (navigator as Navigator & { serial?: NavigatorSerialLike }).serial ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class WebSerialTransport implements PrinterTransport {
  readonly name = 'Web Serial';
  /** 连接断开回调（manager 注入，驱动自动重连） */
  onDrop: (() => void) | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  /** read(n) 缓冲：流式读取攒够 n 字节或超时返回 */
  private rxBuf: number[] = [];
  private dropped = false;

  constructor(readonly port: SerialPortLike, private baud = 115200) {}

  static isAvailable(): boolean {
    return typeof navigator !== 'undefined' && !!serialApi();
  }

  /** 弹出浏览器串口选择器（必须用户手势触发）；用户取消返回 null */
  static async requestPort(): Promise<SerialPortLike | null> {
    const api = serialApi();
    if (!api) throw new Error('当前浏览器不支持 Web Serial——请用 Chrome / Edge 打开，或使用桌面客户端');
    try {
      return await api.requestPort();
    } catch (e) {
      if (/cancel|abort|no port selected/i.test(String(e))) return null;
      throw e;
    }
  }

  /** 已授权过的端口（自动重连用，无需用户手势） */
  static async grantedPorts(): Promise<SerialPortLike[]> {
    return (await serialApi()?.getPorts()) ?? [];
  }

  get alive(): boolean { return !this.dropped; }

  async open(): Promise<void> {
    await this.port.open({ baudRate: this.baud });
    this.reader = this.port.readable?.getReader() ?? null;
    this.writer = this.port.writable?.getWriter() ?? null;
    logInfo('transport', `Web Serial 已连接 @ ${this.baud}`);
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer || this.dropped) throw new Error('连接已断开（Web Serial 未打开）');
    try {
      await this.writer.write(data);
    } catch (e) {
      this.markDropped(`写入失败：${String(e)}`);
      throw new Error(`连接已断开（${String(e)}）`); // 措辞匹配上层断点续打判定
    }
  }

  async read(n: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.rxBuf.length < n && !this.dropped) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || !this.reader) break;
      const result = await Promise.race([this.reader.read(), sleep(remaining).then(() => null)] as const);
      if (result === null) break; // 超时
      if (result.done) { this.markDropped('串口流结束（设备断开）'); break; }
      if (result.value?.length) this.rxBuf.push(...result.value);
    }
    return Uint8Array.from(this.rxBuf.splice(0, n));
  }

  async flushInput(): Promise<void> { this.rxBuf.length = 0; }

  async close(): Promise<void> {
    this.dropped = true; // 主动关闭也标记，防 read 循环悬挂
    try { await this.reader?.cancel(); } catch { /* 忽略 */ }
    try { this.reader?.releaseLock(); } catch { /* 忽略 */ }
    try { this.writer?.releaseLock(); } catch { /* 忽略 */ }
    try { await this.port.close(); } catch { /* 忽略 */ }
    logInfo('transport', 'Web Serial 已断开');
  }

  private markDropped(reason: string): void {
    if (this.dropped) return;
    this.dropped = true;
    logWarn('transport', `Web Serial ${reason}`);
    this.onDrop?.();
  }
}
