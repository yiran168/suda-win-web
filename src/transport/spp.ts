/**
 * SPP 传输：经典蓝牙虚拟串口，经 Electron 主进程的 serialport 执行。
 * 纯浏览器环境不可用（window.qrintSerial 不存在）。
 */
import { PrinterTransport } from '../protocol/qring';
import { logInfo, logWarn } from '../logging/logger';

export class SppTransport implements PrinterTransport {
  readonly name: string;
  private api = window.qrintSerial;

  constructor(private portPath: string, private baud = 115200) {
    this.name = `SPP ${portPath}`;
  }

  static isAvailable(): boolean {
    return !!window.qrintSerial?.available;
  }

  static async listPorts(): Promise<Array<{ path: string; friendlyName?: string }>> {
    if (!SppTransport.isAvailable()) return [];
    return window.qrintSerial!.list();
  }

  async open(): Promise<void> {
    if (!this.api) throw new Error('SPP 仅在桌面客户端（Electron）中可用');
    await this.api.open(this.portPath, this.baud);
    logInfo('transport', `SPP 已连接 ${this.portPath} @ ${this.baud}`);
  }

  async write(data: Uint8Array): Promise<void> {
    await this.api!.write(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  }

  async read(n: number, timeoutMs: number): Promise<Uint8Array> {
    const buf = await this.api!.read(n, timeoutMs);
    return new Uint8Array(buf);
  }

  async flushInput(): Promise<void> {
    try { await this.api?.flush(); } catch { /* 忽略 */ }
  }

  async close(): Promise<void> {
    try {
      await this.api?.close();
      logInfo('transport', `SPP 已断开 ${this.portPath}`);
    } catch (e) {
      logWarn('transport', `SPP 关闭异常：${String(e)}`);
    }
  }
}
