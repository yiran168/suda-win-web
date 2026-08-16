/**
 * 文档光栅化：
 * - renderPreview：整纸彩色画布（编辑器最终预览用）
 * - renderPrintBits：逐元素二值化再 OR 合并（文字阈值、图片抖动、条码锐利），
 *   输出 384 点宽的 0/1 位图，供光栅编码。
 */
import {
  LabelDocument, MAX_DOCUMENT_HEIGHT_DOTS, isTextLikeKind, printerConfig,
  contentBottomDots, fixedHeightDots, offsetXDots, offsetYDots, visualBounds,
} from '../model/document';
import { drawElement, ImageProvider } from './draw';
import { binarize, toGray } from './dither';
import { applyTextEnhance } from './textEnhance';
import { logWarn } from '../logging/logger';

export function documentHeightDots(doc: LabelDocument): number {
  if (doc.paper.mode === 'label') return fixedHeightDots(doc.paper);
  return Math.min(MAX_DOCUMENT_HEIGHT_DOTS, contentBottomDots(doc));
}

/** 整纸彩色渲染（白底）。 */
export function renderPreview(doc: LabelDocument, images: ImageProvider, seqIndex = 0): HTMLCanvasElement {
  const width = printerConfig.headDots;
  const height = Math.max(64, documentHeightDots(doc));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(offsetXDots(doc.paper), offsetYDots(doc.paper));
  for (const el of doc.elements) drawElement(ctx, el, images, seqIndex);
  ctx.restore();
  return canvas;
}

/**
 * 打印位图：每个元素独立渲染到其旋转外接框瓦片 → 按元素模式二值化 → OR 合并。
 * 纸外列保持全白，不会加热打印头纸外部分。
 */
export function renderPrintBits(doc: LabelDocument, images: ImageProvider, seqIndex = 0): { bits: Uint8Array; width: number; height: number } {
  const width = printerConfig.headDots;
  const height = Math.max(64, documentHeightDots(doc));
  const merged = new Uint8Array(width * height);

  const ox = offsetXDots(doc.paper);
  const oy = offsetYDots(doc.paper);

  for (const el of doc.elements) {
    try {
      const bounds = visualBounds(el);
      const bx = Math.max(0, Math.floor(bounds.left + ox));
      const by = Math.max(0, Math.floor(bounds.top + oy));
      const bw = Math.min(width - bx, Math.ceil(bounds.right + ox) - bx);
      const bh = Math.min(height - by, Math.ceil(bounds.bottom + oy) - by);
      if (bw <= 0 || bh <= 0) continue;

      const tile = document.createElement('canvas');
      tile.width = bw;
      tile.height = bh;
      const tctx = tile.getContext('2d')!;
      tctx.fillStyle = '#fff';
      tctx.fillRect(0, 0, bw, bh);
      tctx.translate(-bx + ox - 0, -by + oy - 0);
      // drawElement 内部用元素自身 x/y 定位，这里把瓦片原点对齐到文档坐标
      drawElement(tctx, el, images, seqIndex);

      const img = tctx.getImageData(0, 0, bw, bh);
      let gray = toGray(img.data, el.brightness, el.contrast, el.invert);
      // 文字类元素：二值化前应用文字增强（硬件浓度不生效，清晰度靠软件补偿）
      if (isTextLikeKind(el.kind) && el.textEnhance !== 'none') {
        gray = applyTextEnhance(gray, bw, bh, el.textEnhance);
      }
      // 文字/条码用阈值锐利化，图片用各自抖动模式
      const mode = el.kind === 'image' ? el.ditherMode : 'threshold';
      const threshold = el.kind === 'image' ? el.threshold : 128;
      const bits = binarize(gray, bw, bh, mode, threshold);

      for (let y = 0; y < bh; y++) {
        const row = (by + y) * width;
        const trow = y * bw;
        for (let x = 0; x < bw; x++) {
          if (bits[trow + x]) merged[row + bx + x] = 1;
        }
      }
    } catch (e) {
      logWarn('render', `元素 ${el.id}(${el.kind}) 打印渲染失败：${String(e)}`);
    }
  }
  return { bits: merged, width, height };
}
