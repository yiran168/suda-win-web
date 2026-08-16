/**
 * 元素绘制：预览与打印共用同一套绘制代码（同源渲染）。
 * 每个元素在自己的局部坐标系内绘制：调用前 ctx 已 translate 到元素中心并 rotate。
 */
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import * as bwipjs from 'bwip-js';
import { LabelElement } from '../model/document';
import { barcodeFormatInfo, formatDateTime, formatSequence } from '../model/presets';

export interface ImageProvider {
  /** 同步返回已加载图片；未加载返回 null 并触发加载。 */
  get(src: string): HTMLImageElement | null;
  /** 可选：打印前预热，等全部图片加载结束（成功或失败都返回） */
  preload?: (srcs: string[], timeoutMs?: number) => Promise<void>;
}

export function drawElement(
  ctx: CanvasRenderingContext2D, el: LabelElement, images: ImageProvider, seqIndex = 0,
): void {
  ctx.save();
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.width / 2, -el.height / 2);
  try {
    switch (el.kind) {
      case 'text': case 'datetime': case 'sequence': drawText(ctx, el, seqIndex); break;
      case 'image': drawImage(ctx, el, images); break;
      case 'qrcode': case 'barcode': drawCode(ctx, el); break;
      case 'shape': drawShape(ctx, el); break;
      case 'table': drawTable(ctx, el); break;
      case 'drawing': drawDrawing(ctx, el); break;
    }
  } catch {
    // 单个元素绘制失败不应拖垮整张画布
  }
  ctx.restore();
}

function applyFont(ctx: CanvasRenderingContext2D, el: LabelElement): void {
  ctx.font = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSizeDots}px ${el.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
}

function elementText(el: LabelElement, seqIndex: number): string {
  if (el.kind === 'datetime') return formatDateTime(el.dateTimeFormat);
  if (el.kind === 'sequence') return formatSequence(el, seqIndex);
  return el.text;
}

function wrapLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number, spacing: number): string[] {
  if (!line) return [''];
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    const candidate = cur + ch;
    if (ctx.measureText(candidate).width + spacing * candidate.length > maxWidth && cur) {
      out.push(cur);
      cur = ch;
    } else cur = candidate;
  }
  out.push(cur);
  return out;
}

/* 共享测量上下文：与 drawText 同源的字体设置，保证「量出来的高度」=「画出来的高度」 */
let sharedMeasureCtx: CanvasRenderingContext2D | null = null;
function textMeasureCtx(): CanvasRenderingContext2D {
  if (!sharedMeasureCtx) sharedMeasureCtx = document.createElement('canvas').getContext('2d')!;
  return sharedMeasureCtx;
}

/**
 * 文字类元素的内容高度（点）：按当前宽度/字号/字距/行距重排后的实际行数 × 行高。
 * 供编辑器做「字号/内容变化 → 框高自动适应」联动；竖排按字符数 × 行高计算。
 */
export function textContentHeightDots(el: LabelElement, seqIndex = 0): number {
  const ctx = textMeasureCtx();
  applyFont(ctx, el);
  const lineH = el.fontSizeDots + el.lineSpacingDots;
  const spacing = el.letterSpacingDots;
  if (el.verticalText) {
    const n = [...elementText(el, seqIndex).replace(/\n/g, '')].length;
    return Math.max(lineH, n * (lineH + spacing));
  }
  let lines = 0;
  for (const raw of elementText(el, seqIndex).split('\n')) {
    lines += wrapLine(ctx, raw, Math.max(1, el.width), spacing).length;
  }
  return Math.max(lineH, lines * lineH);
}

function drawText(ctx: CanvasRenderingContext2D, el: LabelElement, seqIndex: number): void {
  applyFont(ctx, el);
  const text = elementText(el, seqIndex);
  const lineH = el.fontSizeDots + el.lineSpacingDots;
  const spacing = el.letterSpacingDots;

  if (el.verticalText) {
    const chars = text.replace(/\n/g, '');
    let y = 0;
    for (const ch of chars) {
      let x = 0;
      if (el.align === 'center') x = (el.width - el.fontSizeDots) / 2;
      if (el.align === 'right') x = el.width - el.fontSizeDots;
      ctx.fillText(ch, x, y);
      y += lineH + spacing;
      if (y > el.height) break;
    }
    return;
  }

  const lines: string[] = [];
  for (const raw of text.split('\n')) lines.push(...wrapLine(ctx, raw, el.width, spacing));
  let y = 0;
  for (const line of lines) {
    if (y + lineH > el.height + lineH) break;
    const w = ctx.measureText(line).width + spacing * line.length;
    let x = 0;
    if (el.align === 'center') x = Math.max(0, (el.width - w) / 2);
    if (el.align === 'right') x = Math.max(0, el.width - w);
    if (spacing !== 0) {
      let cx = x;
      for (const ch of line) {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + spacing;
      }
    } else {
      ctx.fillText(line, x, y);
    }
    if (el.underline) {
      ctx.fillRect(x, y + el.fontSizeDots + 1, w, Math.max(1, Math.round(el.fontSizeDots / 14)));
    }
    y += lineH;
  }
}

function drawImage(ctx: CanvasRenderingContext2D, el: LabelElement, images: ImageProvider): void {
  if (!el.src) {
    ctx.strokeStyle = '#999';
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(1, 1, el.width - 2, el.height - 2);
    ctx.setLineDash([]);
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#999';
    ctx.fillText('未选择图片', 10, el.height / 2 - 10);
    return;
  }
  const img = images.get(el.src);
  if (!img) return;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (el.imageFit === 'stretch') {
    ctx.drawImage(img, 0, 0, el.width, el.height);
  } else {
    const scale = el.imageFit === 'fit'
      ? Math.min(el.width / iw, el.height / ih)
      : Math.max(el.width / iw, el.height / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, el.width, el.height);
    ctx.clip();
    ctx.drawImage(img, (el.width - dw) / 2, (el.height - dh) / 2, dw, dh);
    ctx.restore();
  }
}

const codeCanvasCache = new Map<string, HTMLCanvasElement>();

function codeCanvas(el: LabelElement): HTMLCanvasElement | null {
  const key = `${el.kind}|${el.codeFormat}|${el.codeValue}|${el.width}x${el.height}`;
  const cached = codeCanvasCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  try {
    if (el.kind === 'qrcode') {
      QRCode.toCanvas(canvas, el.codeValue || ' ', {
        margin: 0, width: Math.min(el.width, el.height),
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
    } else {
      const info = barcodeFormatInfo(el.codeFormat);
      if (info?.engine === 'bwip') {
        bwipjs.toCanvas(canvas, {
          bcid: info.bcid!,
          text: el.codeValue || '0',
          scale: 3,
          includetext: !info.twoD,
          textxalign: 'center',
        });
      } else {
        canvas.width = el.width;
        canvas.height = el.height;
        JsBarcode(canvas, el.codeValue || '0', {
          format: el.codeFormat, displayValue: true, margin: 0,
          width: 2, height: Math.max(20, el.height - 24), fontSize: 18,
        });
      }
    }
  } catch {
    return null;
  }
  if (codeCanvasCache.size > 200) codeCanvasCache.clear();
  codeCanvasCache.set(key, canvas);
  return canvas;
}

function drawCode(ctx: CanvasRenderingContext2D, el: LabelElement): void {
  const canvas = codeCanvas(el);
  if (!canvas) {
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#900';
    ctx.fillText('码内容无效', 6, el.height / 2 - 10);
    return;
  }
  // 码必须锐利：直接拉伸到元素框
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, el.width, el.height);
  ctx.imageSmoothingEnabled = true;
}

function drawShape(ctx: CanvasRenderingContext2D, el: LabelElement): void {
  const w = el.width;
  const h = el.height;
  const sw = el.strokeWidthDots;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineWidth = sw;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const dashed = el.shapeType === 'dashedLine' || el.shapeType === 'dashedVerticalLine';
  if (dashed) ctx.setLineDash([Math.max(4, sw * 3), Math.max(3, sw * 2)]);
  switch (el.shapeType) {
    case 'rect': ctx.rect(sw / 2, sw / 2, w - sw, h - sw); break;
    case 'roundedRect': {
      const r = Math.min(w, h) / 5;
      ctx.roundRect(sw / 2, sw / 2, w - sw, h - sw, r);
      break;
    }
    case 'circle': ctx.arc(w / 2, h / 2, Math.max(1, Math.min(w, h) / 2 - sw / 2), 0, Math.PI * 2); break;
    case 'ellipse': ctx.ellipse(w / 2, h / 2, Math.max(1, w / 2 - sw / 2), Math.max(1, h / 2 - sw / 2), 0, 0, Math.PI * 2); break;
    case 'triangle': ctx.moveTo(w / 2, sw); ctx.lineTo(w - sw, h - sw); ctx.lineTo(sw, h - sw); ctx.closePath(); break;
    case 'line': case 'dashedLine': ctx.moveTo(sw, h / 2); ctx.lineTo(w - sw, h / 2); break;
    case 'verticalLine': case 'dashedVerticalLine': ctx.moveTo(w / 2, sw); ctx.lineTo(w / 2, h - sw); break;
    case 'arrow': case 'arrowRight':
      ctx.moveTo(sw, h / 2); ctx.lineTo(w - sw - h / 4, h / 2);
      ctx.moveTo(w - sw - h / 4, h / 4); ctx.lineTo(w - sw, h / 2); ctx.lineTo(w - sw - h / 4, (h * 3) / 4);
      break;
    case 'arrowLeft':
      ctx.moveTo(w - sw, h / 2); ctx.lineTo(sw + h / 4, h / 2);
      ctx.moveTo(sw + h / 4, h / 4); ctx.lineTo(sw, h / 2); ctx.lineTo(sw + h / 4, (h * 3) / 4);
      break;
    case 'arrowUp':
      ctx.moveTo(w / 2, h - sw); ctx.lineTo(w / 2, sw + w / 4);
      ctx.moveTo(w / 4, sw + w / 4); ctx.lineTo(w / 2, sw); ctx.lineTo((w * 3) / 4, sw + w / 4);
      break;
    case 'arrowDown':
      ctx.moveTo(w / 2, sw); ctx.lineTo(w / 2, h - sw - w / 4);
      ctx.moveTo(w / 4, h - sw - w / 4); ctx.lineTo(w / 2, h - sw); ctx.lineTo((w * 3) / 4, h - sw - w / 4);
      break;
    case 'star': polygon(ctx, w / 2, h / 2, 5, Math.min(w, h) / 2 - sw / 2, true); break;
    case 'pentagon': polygon(ctx, w / 2, h / 2, 5, Math.min(w, h) / 2 - sw / 2, false); break;
    case 'hexagon': polygon(ctx, w / 2, h / 2, 6, Math.min(w, h) / 2 - sw / 2, false); break;
    case 'diamond':
      ctx.moveTo(w / 2, sw); ctx.lineTo(w - sw, h / 2); ctx.lineTo(w / 2, h - sw); ctx.lineTo(sw, h / 2);
      ctx.closePath(); break;
    case 'plus': {
      const arm = Math.min(w, h) * 0.18;
      ctx.rect(w / 2 - arm / 2, sw, arm, h - sw * 2);
      ctx.moveTo(sw, h / 2 - arm / 2); ctx.rect(sw, h / 2 - arm / 2, w - sw * 2, arm);
      break;
    }
    case 'checkmark':
      ctx.lineWidth = Math.max(sw * 1.5, 2);
      ctx.moveTo(w * 0.15, h * 0.55); ctx.lineTo(w * 0.42, h * 0.82); ctx.lineTo(w * 0.88, h * 0.18);
      break;
    case 'speechBubble': {
      const r = Math.min(w, h) / 6;
      const bh = h * 0.72;
      ctx.roundRect(sw / 2, sw / 2, w - sw, bh - sw, r);
      ctx.moveTo(w * 0.3, bh - sw / 2); ctx.lineTo(w * 0.22, h - sw); ctx.lineTo(w * 0.48, bh - sw / 2);
      break;
    }
    case 'cross':
      ctx.lineWidth = Math.max(sw * 1.4, 2);
      ctx.moveTo(sw * 2, sw * 2); ctx.lineTo(w - sw * 2, h - sw * 2);
      ctx.moveTo(w - sw * 2, sw * 2); ctx.lineTo(sw * 2, h - sw * 2);
      break;
    case 'heart': heart(ctx, w, h, sw); break;
  }
  if (el.filled && !dashed) ctx.fill(); else ctx.stroke();
  if (dashed) ctx.setLineDash([]);
}

function polygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, n: number, r: number, star: boolean): void {
  const inner = star ? r * 0.45 : r;
  const total = star ? n * 2 : n;
  for (let i = 0; i < total; i++) {
    const rr = star && i % 2 === 1 ? inner : r;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function heart(ctx: CanvasRenderingContext2D, w: number, h: number, sw: number): void {
  const x = w / 2;
  const y = h / 4;
  ctx.moveTo(x, y + h / 8);
  ctx.bezierCurveTo(x, y, x - w / 2, y - h / 8, x - w / 2, y + h / 8);
  ctx.bezierCurveTo(x - w / 2, y + h / 2.5, x, y + h / 1.6, x, h - sw);
  ctx.bezierCurveTo(x, y + h / 1.6, x + w / 2, y + h / 2.5, x + w / 2, y + h / 8);
  ctx.bezierCurveTo(x + w / 2, y - h / 8, x, y, x, y + h / 8);
}

function drawTable(ctx: CanvasRenderingContext2D, el: LabelElement): void {
  const rows = Math.max(1, el.tableRows);
  const cols = Math.max(1, el.tableCols);
  const cw = el.width / cols;
  const rh = el.height / rows;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, el.strokeWidthDots / 2);
  ctx.beginPath();
  for (let r = 0; r <= rows; r++) { ctx.moveTo(0, r * rh); ctx.lineTo(el.width, r * rh); }
  for (let c = 0; c <= cols; c++) { ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, el.height); }
  ctx.stroke();
  ctx.font = `${el.fontWeight} ${el.fontSizeDots}px ${el.fontFamily}`;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const text = el.tableCells[r * cols + c] ?? '';
      if (!text) continue;
      const w = ctx.measureText(text).width;
      ctx.fillText(text, c * cw + Math.max(2, (cw - w) / 2), r * rh + rh / 2);
    }
  }
}

function drawDrawing(ctx: CanvasRenderingContext2D, el: LabelElement): void {
  const pts = el.drawingPoints;
  if (pts.length < 4) return;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(2, el.strokeWidthDots);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const nx = pts[i];
    const ny = pts[i + 1];
    if (nx < 0 || ny < 0) { pen = false; continue; }
    const x = nx * el.width;
    const y = ny * el.height;
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
