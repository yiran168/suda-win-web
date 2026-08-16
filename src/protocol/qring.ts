/**
 * Qring / BeePrt BY 私有协议（移植自 snowboys/QrintPrint-Windows app/driver.py
 * 与上游 Thisko/QrintPrint 的 QringProtocol，协议源自官方 App 逆向整理）。
 *
 * 传输无关：所有函数只产出/解析字节流；发送节奏（1024 字节分包、1ms 间隔）
 * 由 QringPrinter 驱动注入的 PrinterTransport 执行。
 */
import { logDebug, logInfo, logWarn } from '../logging/logger';

export const WIDTH_DOTS = 384;
export const CHUNK = 1024;
export const CHUNK_GAP_MS = 1;

/* --------------------------------- 命令 --------------------------------- */

export const CMD = {
  ENABLE: Uint8Array.from([0x10, 0xff, 0xf1, 0x02]),
  ENABLE2: Uint8Array.from([0x1f, 0xb2, 0x10]),
  STOP: Uint8Array.from([0x10, 0xff, 0xf1, 0x45]),
  WAKEUP: new Uint8Array(12),
  LABEL_POS: Uint8Array.from([0x1d, 0x0c]),
  LEARN_GAP: Uint8Array.from([0x10, 0xff, 0x03]),
  STATUS: Uint8Array.from([0x10, 0xff, 0x40]),
  BATTERY: Uint8Array.from([0x10, 0xff, 0x50, 0xf1]),
  BT_NAME: Uint8Array.from([0x10, 0xff, 0x30, 0x11]),
  BT_MAC: Uint8Array.from([0x10, 0xff, 0x30, 0x12]),
  BT_VERSION: Uint8Array.from([0x10, 0xff, 0x30, 0x10]),
  FW_VERSION: Uint8Array.from([0x10, 0xff, 0x20, 0xf1]),
  SN: Uint8Array.from([0x10, 0xff, 0x20, 0xf2]),
  MODEL: Uint8Array.from([0x10, 0xff, 0x20, 0xf0]),
  INFO: Uint8Array.from([0x10, 0xff, 0x70]),
};

export const ACK_PRINT_DONE = 0xaa;

/** 状态字节位定义 */
export const STATUS_BITS: Array<[number, string]> = [
  [0x01, '正在打印'],
  [0x02, '机身异常 / 开盖'],
  [0x04, '缺纸'],
  [0x08, '电量电压低'],
  [0x10, '过热'],
];

/** 打印过程中打印机主动上报的故障帧：0xFF + 代码 */
export const UNSOLICITED: Record<number, string> = {
  0x01: '缺纸',
  0x02: '开盖',
  0x03: '过热',
  0x04: '低电量',
};

export interface PrinterStatus {
  ok: boolean;
  problems: string[];
  raw: number | null;
}

export function parseStatus(resp: Uint8Array): PrinterStatus {
  if (resp.length === 0) return { ok: false, problems: ['无响应'], raw: null };
  const b = resp[0];
  const problems = STATUS_BITS.filter(([mask]) => b & mask).map(([, name]) => name);
  return { ok: b === 0, problems: problems.length ? problems : ['正常'], raw: b };
}

/** 打印浓度 / 加热强度 0–7 */
export function thicknessCommand(level: number): Uint8Array {
  return Uint8Array.from([0x10, 0xff, 0x10, 0x00, level & 0xff]);
}

/** ESC J n —— 走纸 n 点行，>255 自动拆分 */
export function feedCommands(dots: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let rest = Math.max(0, Math.round(dots));
  while (rest > 0) {
    const n = Math.min(rest, 255);
    out.push(Uint8Array.from([0x1b, 0x4a, n]));
    rest -= n;
  }
  return out;
}

/** GS v 0 光栅头：宽（字节）+ 高（点行），小端 */
export function rasterHeader(widthBytes: number, height: number, mode = 0): Uint8Array {
  return Uint8Array.from([
    0x1d, 0x76, 0x30, mode & 0x03,
    widthBytes % 256, Math.floor(widthBytes / 256),
    height % 256, Math.floor(height / 256),
  ]);
}

/* ------------------------------ 打印机驱动 ------------------------------ */

export interface PrinterTransport {
  readonly name: string;
  /** 连接是否还活着（可选）。false 时 waitAck/waitReady 立即失败，不在死连接上空等超时 */
  readonly alive?: boolean;
  write(data: Uint8Array): Promise<void>;
  read(n: number, timeoutMs: number): Promise<Uint8Array>;
  flushInput(): Promise<void>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PrinterInfo {
  型号: string | null;
  序列号: string | null;
  固件版本: string | null;
  蓝牙名称: string | null;
  MAC: string | null;
  电量: number | null;
}

export class QringPrinter {
  /**
   * protocol = 'qring'：Qring/BeePrt 私有握手（ENABLE/WAKEUP/STOP + 状态查询 + ACK）。
   * protocol = 'escpos'：通用 ESC/POS —— 跳过私有指令与状态查询，ESC @ 初始化后直接下发
   * 光栅与走纸（GS v 0 / ESC J 本身是 ESC/POS 标准指令）。
   */
  constructor(
    private t: PrinterTransport, private trace = false,
    private protocol: 'qring' | 'escpos' = 'qring',
  ) {}

  get transportName(): string { return this.t.name; }
  get isEscPos(): boolean { return this.protocol === 'escpos'; }

  /** 按 SDK 方式分片发送：每 1024 字节一包，包间 1ms */
  async send(data: Uint8Array): Promise<void> {
    if (this.trace) {
      logDebug('protocol', data.length <= 32
        ? `TX ${hex(data)}`
        : `TX ${data.length} bytes (${hex(data.slice(0, 16))} ...)`);
    }
    for (let off = 0; off < data.length; off += CHUNK) {
      await this.t.write(data.slice(off, off + CHUNK));
      await sleep(CHUNK_GAP_MS);
    }
  }

  /** 查询固定套路：清空输入 → 发送 → 延时 → 读响应 */
  async query(cmd: Uint8Array, nbytes = 64, timeoutMs = 1500): Promise<Uint8Array> {
    await this.t.flushInput();
    await this.send(cmd);
    await sleep(150);
    const resp = await this.t.read(nbytes, timeoutMs);
    if (this.trace && resp.length) logDebug('protocol', `RX ${hex(resp)}`);
    return resp;
  }

  async status(): Promise<PrinterStatus> {
    if (this.isEscPos) return { ok: true, problems: [], raw: null }; // ESC/POS 无状态查询，体检直接放行
    return parseStatus(await this.query(CMD.STATUS, 1));
  }

  async battery(): Promise<number | null> {
    if (this.isEscPos) return null;
    const resp = await this.query(CMD.BATTERY, 2);
    return resp.length >= 2 ? resp[1] : null;
  }

  private async queryString(cmd: Uint8Array): Promise<string | null> {
    const resp = await this.query(cmd, 64);
    if (!resp.length) return null;
    try {
      return new TextDecoder('gb18030').decode(resp).replace(/\0/g, '').trim();
    } catch {
      return new TextDecoder().decode(resp).replace(/\0/g, '').trim();
    }
  }

  async info(): Promise<PrinterInfo> {
    const mac = await this.query(CMD.BT_MAC, 16);
    return {
      型号: await this.queryString(CMD.MODEL),
      序列号: await this.queryString(CMD.SN),
      固件版本: await this.queryString(CMD.FW_VERSION),
      蓝牙名称: await this.queryString(CMD.BT_NAME),
      MAC: mac.length ? Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join(':').toUpperCase() : null,
      电量: await this.battery(),
    };
  }

  async setThickness(level: number): Promise<void> {
    if (this.isEscPos) return; // 通用 ESC/POS 浓度指令各厂商不一，跳过
    await this.send(thicknessCommand(level));
  }

  async enable(): Promise<void> {
    if (this.isEscPos) { await this.send(Uint8Array.from([0x1b, 0x40])); return; } // ESC @ 初始化
    await this.send(CMD.ENABLE); await this.send(CMD.ENABLE2);
  }
  async stop(): Promise<void> { if (this.isEscPos) return; await this.send(CMD.STOP); }
  async wakeup(): Promise<void> { if (this.isEscPos) return; await this.send(CMD.WAKEUP); }

  async feed(dots: number): Promise<void> {
    for (const cmd of feedCommands(dots)) await this.send(cmd);
  }

  /** GS v 0 —— 发送光栅位图（每行 widthBytes 字节，MSB first，1=黑） */
  async printRaster(data: Uint8Array, widthBytes: number, height: number): Promise<void> {
    await this.send(rasterHeader(widthBytes, height));
    await this.send(data);
  }

  /** 等待打印完成 ACK（0xAA），同时处理主动上报的故障帧；可被 AbortSignal 中断 */
  async waitAck(timeoutMs = 120000, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
    if (this.isEscPos) return { ok: true, message: '已发送（ESC/POS 无回执）' };
    const deadline = Date.now() + timeoutMs;
    const buf: number[] = [];
    while (Date.now() < deadline) {
      if (signal?.aborted) return { ok: false, message: '已取消' };
      if (this.t.alive === false) return { ok: false, message: '连接已断开' };
      const chunk = await this.t.read(16, 1000);
      if (!chunk.length) continue;
      buf.push(...chunk);
      if (this.trace) logDebug('protocol', `RX ${hex(chunk)}`);
      if (buf.includes(ACK_PRINT_DONE)) return { ok: true, message: '打印完成' };
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0xff && UNSOLICITED[buf[i + 1]]) {
          return { ok: false, message: UNSOLICITED[buf[i + 1]] };
        }
      }
    }
    return { ok: false, message: '等待 ACK 超时' };
  }

  /**
   * 轮询状态直到「正在打印」位清除。逐份打印时的关键节奏闸：
   * 上一份还在打印时就开下一份，固件会直接丢弃新任务（奇偶份丢失的根因）。
   * 回包通道不通时（连续多次无响应）不空等，直接放行。
   */
  async waitReady(timeoutMs = 30000, signal?: AbortSignal): Promise<void> {
    if (this.isEscPos) return;
    const deadline = Date.now() + timeoutMs;
    let silentPolls = 0;
    let heatWarned = false;
    while (Date.now() < deadline) {
      if (signal?.aborted) return;
      if (this.t.alive === false) return; // 连接已断：交给上层断点续打，不在死连接上空等
      const s = await this.status();
      if (s.raw === null) {
        silentPolls += 1;
        if (silentPolls >= 2) {
          logDebug('protocol', '状态查询连续无响应（回包通道不通），跳过空闲等待');
          return;
        }
      } else {
        silentPolls = 0;
        // 过热位：固件温控保护中——等散热恢复再开下一份，热态灌数据容易出白条/浅印
        if (s.raw & 0x10) {
          if (!heatWarned) {
            heatWarned = true;
            logWarn('print', '🌡️ 打印头过热，固件保护中——等待散热后继续剩余份数');
          }
        } else if (!(s.raw & 0x01)) return;
      }
      await sleep(150);
    }
    logDebug('protocol', 'waitReady 超时（打印机可能仍在忙），继续下一份');
  }

  /**
   * 过热故障帧（FF 03）后的散热等待：轮询状态直到过热位（0x10）清除。
   * 与 waitReady 的差别：waitReady 是份间节奏闸，状态通道不通时快速放行；
   * 而收到过热帧是确定事实——通道不通时不能空等放行，退化为固定盲等 20s 保守散热。
   * 返回 false 仅表示被取消/连接已断；散热完成、盲等结束、超时放行都返回 true
   * （超时放行后若仍过热，固件会再次上报过热帧，由上层重试上限兜底防死循环）。
   */
  async waitCoolDown(timeoutMs = 180000, signal?: AbortSignal): Promise<boolean> {
    if (this.isEscPos) return true; // ESC/POS 无过热帧，不可达，防御性返回
    const deadline = Date.now() + timeoutMs;
    let silentPolls = 0;
    let sawHeat = false;
    while (Date.now() < deadline) {
      if (signal?.aborted) return false;
      if (this.t.alive === false) return false; // 交上层断点续打
      const s = await this.status();
      if (s.raw === null) {
        silentPolls += 1;
        if (silentPolls >= 2) {
          logInfo('print', '状态通道不通，无法观察热位——盲等 20s 散热后续打');
          await sleep(20000);
          return true;
        }
      } else {
        silentPolls = 0;
        if (!(s.raw & 0x10)) {
          if (sawHeat) logInfo('print', '🌡️ 散热完成，继续打印');
          return true;
        }
        sawHeat = true;
      }
      await sleep(2000); // 散热是分钟级过程，轮询不必密
    }
    logWarn('print', '等待散热超时，尝试继续打印（若仍过热固件会再次保护）');
    return true;
  }

  async close(): Promise<void> { await this.t.close(); }
}

export function hex(data: Uint8Array): string {
  return Array.from(data).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
