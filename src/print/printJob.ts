/**
 * 打印任务管线：
 * 文档 → 逐元素二值化位图 → GS v 0 光栅字节 → 体检 → 下发 → 等 ACK。
 * 全程写运行日志，异常进历史记录。
 */
import { bitsToRaster } from '../render/dither';
import { renderPrintBits } from '../render/rasterize';
import { ImageProvider } from '../render/draw';
import { LabelDocument, mmToDots } from '../model/document';
import { printerManager } from '../transport/manager';
import { appendHistory, loadPrefs } from '../store/local';
import { playPrintSound } from '../audio/printSound';
import { logError, logInfo, logWarn } from '../logging/logger';
import { uid } from '../model/document';
import { documentToJson } from '../model/document';

export interface PrintOptions {
  copies?: number;
  density?: number;     // 0–7
  seqIndex?: number;    // 流水号偏移
  /** 从第几份开始（断点续打，0 起始） */
  startCopy?: number;
  /** 取消信号：份间检查，当前份打完后停止 */
  signal?: AbortSignal;
  /** 每份完成后回报进度 */
  onProgress?: (done: number, total: number) => void;
}

export interface PrintResult {
  ok: boolean;
  message: string;
  /** 实际完成份数（取消/失败时 < copies），用于断点续打 */
  doneCopies?: number;
  cancelled?: boolean;
}

/** 同一份因过热保护被固件停机后允许的最大中断续打次数（每次断点行单调前进，防死循环） */
const MAX_HEAT_PAUSES = 6;
/** 过热散热等待上限：打印头自然散热通常 30–120s */
const COOLDOWN_TIMEOUT_MS = 180000;
/**
 * 过热断点行估算参数。
 * 物理依据：热敏打印一整行是同时加热的（行是原子单位，不存在「行内半行」），
 * 因此行级断点是正确粒度。固件不回报已打行号，只能估算：
 *   已打行数 ≈ (故障时刻 - 开始发送 - 传输耗时) × 打印速度
 * 两个不可测误差（固件缓冲积压、边传边打）都只会让估算偏小，
 * 再回退 HEAT_OVERLAP_ROWS 行重叠重打——宁可接缝处略加深，也不让内容缺半行。
 */
/** SPP 115200bps ≈ 11.5 KB/s，用于估算点阵传输耗时 */
const SPP_BYTES_PER_SEC = 11520;
/** 无标定数据时的保守打印速度（≈31mm/s，偏慢取值使断点估算偏小、重叠偏多） */
const FALLBACK_ROWS_PER_SEC = 250;
/** 断点回退重叠行数（≈16mm） */
const HEAT_OVERLAP_ROWS = 128;

export async function printDocument(
  doc: LabelDocument, images: ImageProvider, opts: PrintOptions = {},
): Promise<PrintResult> {
  const t0 = Date.now();
  logInfo('print', `开始打印「${doc.title}」（元素 ${doc.elements.length} 个）`);

  let printer = printerManager.acquireForPrint();
  if (!printer) {
    const message = '打印机未连接';
    recordHistory(doc, false, message);
    return { ok: false, message };
  }

  let doneCopies = 0; // 跨 catch 可见：失败/异常时用于断点续打
  try {
    // 1. 打印前体检
    logInfo('print', '打印前体检：查询打印机状态…');
    const status = await printer.status();
    if (status.raw === null && !printer.isEscPos) {
      logWarn('print', '状态查询无响应（回包通道可能未开启），本次将盲打；取消键仍可中断');
    }
    if (status.raw !== null && status.raw !== 0) {
      // 过热给明确指引：固件温控保护，继续灌数据也打不出来，凉一会自动恢复
      const message = status.problems.includes('过热')
        ? '打印头过热：固件保护中，请稍候片刻再打印（长内容中途停顿多为过热保护，属正常现象）'
        : `体检未通过：${status.problems.join('、')}`;
      logWarn('print', message);
      recordHistory(doc, false, message);
      return { ok: false, message };
    }
    logInfo('print', `体检通过（电量 ${await printer.battery() ?? '?'}%）`);

    // 2. 多份策略（实测对齐真机固件行为）：
    //    固件对单个 GS v 0 任务的点阵高度有内部缓冲上限——N 份堆叠成一帧会被截断，
    //    只打出第 1 份（安卓参考版的堆叠方案在同一固件上同样只打 1 份，已复现）；
    //    而逐份秒开会话又会在打印机忙时被吞（老版本奇偶份 bug 的根因是上一份还没打完
    //    就开了下一份）。因此采用【逐份任务 + 每份等 ACK + 轮询到打印机空闲再开下一份】：
    //    每份数据量小（不会触缓冲上限），节奏闸保证不互相吞掉。
    //    走纸规则：每份末尾补空白行走纸——标签纸走标签间隙，连续纸走 tailFeedDots。
    const copies = Math.max(1, opts.copies ?? 1);
    const startCopy = Math.min(Math.max(0, opts.startCopy ?? 0), copies - 1);
    const feedRows = doc.paper.mode === 'label'
      ? mmToDots(doc.paper.labelGapMm)
      : Math.max(0, doc.paper.tailFeedDots);
    const hasSequence = doc.elements.some((e) => e.kind === 'sequence');
    if (startCopy > 0) logInfo('print', `断点续打：从第 ${startCopy + 1}/${copies} 份开始`);

    // 图片预热：缓存是异步加载的，不预热的话首次光栅化会把未加载的图片画成空白页
    const imgSrcs = doc.elements.filter((e) => e.kind === 'image' && e.src).map((e) => e.src);
    if (imgSrcs.length && images.preload) {
      await images.preload(imgSrcs);
      logInfo('print', `图片预热完成（${imgSrcs.length} 张）`);
    }

    // 无流水号时只渲染一次，各份复用同一点阵；有流水号则逐份渲染（号码逐份递增）
    let base: { bits: Uint8Array; width: number; height: number } | null = null;
    let c = startCopy;
    let measuredSpeed = 0; // 本机实测打印速度（行/秒）：整份一次打成后标定，供过热断点估算
    while (c < copies) {
      // 份间取消闸：当前份打完后才响应取消，避免半份残票
      if (opts.signal?.aborted) {
        const message = `已取消（完成 ${c}/${copies} 份）`;
        logWarn('print', `「${doc.title}」${message}`);
        recordHistory(doc, false, message);
        return { ok: false, message, doneCopies: c, cancelled: true };
      }
      try {
        const rendered: { bits: Uint8Array; width: number; height: number } = hasSequence || !base
          ? renderPrintBits(doc, images, (opts.seqIndex ?? 0) + c)
          : base;
        if (!hasSequence) base = rendered;
        const { bits, width, height } = rendered;
        if (c === 0) logInfo('print', `光栅化完成：${width}×${height} 点`);
        if (!hasInk(bits)) {
          const message = '当前画布渲染后为空白，请先添加内容或调整图片阈值';
          logWarn('print', message);
          recordHistory(doc, false, message);
          return { ok: false, message, doneCopies: c };
        }

        if (copies > 1) logInfo('print', `第 ${c + 1}/${copies} 份开始…`);
        const widthBytes = Math.ceil(width / 8);
        const framed = appendBlankRows(bits, width, height, feedRows);

        // 行级断点续打：过热停机后估算断点行、回退重叠行，从断点接着打剩余部分，
        // 不整份重打。热敏一行同时加热（行是原子单位），行级断点物理上正确；
        // 回退重叠保证估算误差内内容不缺半行（接缝处可能略加深）。
        let rowOffset = 0;
        let heatPauses = 0;
        for (;;) {
          if (opts.signal?.aborted) break; // 取消：交给下方统一取消返回
          await printer.wakeup();
          await printer.enable();
          await printer.setThickness(opts.density ?? 1);
          if (rowOffset === 0) await printer.feed(10); // 续打不走纸，防止接缝
          const rows = framed.height - rowOffset;
          const raster = bitsToRaster(framed.bits.subarray(rowOffset * width), width, rows);
          logInfo('print', rowOffset === 0
            ? `下发点阵：${width}×${rows} 点，${raster.length} 字节`
            : `续打点阵：从第 ${rowOffset + 1}/${framed.height} 行起，剩余 ${rows} 行`);
          const t0 = Date.now();
          await printer.printRaster(raster, widthBytes, rows);
          const tSent = Date.now();
          await printer.stop();

          const ack = await printer.waitAck(120000, opts.signal);
          if (ack.ok) {
            if (rowOffset === 0) {
              // 整份一次打成：标定本机真实打印速度（行/秒），供后续过热断点估算
              const sec = (Date.now() - tSent) / 1000;
              if (sec > 0.5) measuredSpeed = framed.height / sec;
            }
            break;
          }
          if (ack.message === '连接已断开') throw new Error('连接已断开'); // 走下方断连重续分支

          // 过热判定：主动故障帧（FF 03）；不上报帧的固件则 ACK 超时后查状态位 0x10
          const overheated = ack.message === '过热'
            || (ack.message === '等待 ACK 超时' && !printer.isEscPos
              && !!(((await printer.status()).raw ?? 0) & 0x10));
          if (overheated && !opts.signal?.aborted) {
            heatPauses += 1;
            if (heatPauses > MAX_HEAT_PAUSES) {
              const message = `打印头过热保护反复触发：同一份断点续打 ${MAX_HEAT_PAUSES} 次仍被固件停机。请关机散热几分钟后再试，或拆分内容/降低浓度`;
              logWarn('print', `「${doc.title}」${message}`);
              recordHistory(doc, false, message);
              return { ok: false, message, doneCopies };
            }
            const transferSec = raster.length / SPP_BYTES_PER_SEC;
            const printSec = Math.max(0, (Date.now() - t0) / 1000 - transferSec);
            const speed = measuredSpeed || FALLBACK_ROWS_PER_SEC;
            const estRows = Math.floor(printSec * speed);
            const advance = Math.max(0, estRows - HEAT_OVERLAP_ROWS);
            rowOffset = Math.min(framed.height - 1, rowOffset + advance);
            logWarn('print', `🌡️ 第 ${c + 1} 份途中打印头过热，固件保护停机：估计已打约 ${rowOffset}/${framed.height} 行，散热后从断点行续打（回退重叠 ${HEAT_OVERLAP_ROWS} 行防缺行，第 ${heatPauses}/${MAX_HEAT_PAUSES} 次）`);
            await printer.waitCoolDown(COOLDOWN_TIMEOUT_MS, opts.signal);
            continue;
          }

          const cancelled = ack.message === '已取消';
          const baseMsg = cancelled
            ? `已取消（完成 ${doneCopies}/${copies} 份）`
            : copies > 1 ? `第 ${c + 1} 份失败：${ack.message}` : ack.message;
          logWarn('print', `「${doc.title}」${baseMsg}`);
          recordHistory(doc, false, baseMsg);
          return { ok: false, message: baseMsg, doneCopies, cancelled };
        }
        if (opts.signal?.aborted) {
          const message = `已取消（完成 ${doneCopies}/${copies} 份）`;
          logWarn('print', `「${doc.title}」${message}`);
          recordHistory(doc, false, message);
          return { ok: false, message, doneCopies, cancelled: true };
        }
        doneCopies = c + 1;
        opts.onProgress?.(doneCopies, copies);
        // 关键节奏闸：等打印机真正空闲再开下一份，否则固件忙时直接丢弃新任务
        await printer.waitReady(30000, opts.signal);
        c += 1;
      } catch (e) {
        // 打印途中断连：不判死刑——等 manager 的自动重连把链路拉回来，残份作废、重打这一份
        if (!isLinkDrop(e) || opts.signal?.aborted) throw e;
        logWarn('print', `第 ${c + 1} 份途中连接断开，等待自动重连后续打…`);
        printerManager.releaseFromPrint();
        const back = await printerManager.awaitReady(25000);
        if (!back) throw new Error('连接断开后自动重连超时');
        const re = printerManager.acquireForPrint();
        if (!re) throw new Error('自动重连后未能取得打印机');
        printer = re;
        logInfo('print', `已重连，从第 ${c + 1}/${copies} 份续打`);
        await printer.waitReady(8000, opts.signal); // 让重连后的固件稳定再续打
      }
    }

    // 3. 完成
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    logInfo('print', `「${doc.title}」打印完成（${copies} 份），耗时 ${elapsed}s`);
    playPrintSound(loadPrefs().printSound);
    recordHistory(doc, true, copies > 1 ? `打印完成（${copies} 份）` : '打印完成');
    return { ok: true, message: copies > 1 ? `打印完成（${copies} 份）` : '打印完成', doneCopies };
  } catch (e) {
    const raw = String(e);
    const message = `打印失败：${raw}`;
    logError('print', message);
    recordHistory(doc, false, message);
    return { ok: false, message, doneCopies };
  } finally {
    printerManager.releaseFromPrint();
  }
}

/** 断连类错误判定：只有这类错误才值得等自动重连续打，其余（缺纸/开盖/取消）直接失败 */
function isLinkDrop(e: unknown): boolean {
  return /断开|disconnected|未连接/i.test(String(e));
}

function recordHistory(doc: LabelDocument, ok: boolean, detail: string): void {
  try {
    appendHistory({
      id: uid(), time: Date.now(), title: doc.title, ok, detail,
      documentJson: documentToJson(doc),
    });
  } catch { /* 历史记录失败不影响打印结果 */ }
}

/** 点阵有墨检查：部分固件会静默忽略全白光栅，打了等于没打还等不到 ACK */
function hasInk(bits: Uint8Array): boolean {
  return bits.some((b) => b !== 0);
}

/** 在点阵末尾补 rows 行空白作为走纸（对齐参考版 RasterEncoder.appendBlankRows） */
function appendBlankRows(
  bits: Uint8Array, width: number, height: number, rows: number,
): { bits: Uint8Array; height: number } {
  if (rows <= 0) return { bits, height };
  const merged = new Uint8Array(width * (height + rows));
  merged.set(bits.subarray(0, width * height), 0);
  return { bits: merged, height: height + rows };
}
