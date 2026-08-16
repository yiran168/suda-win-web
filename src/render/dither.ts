/**
 * 二值化 / 抖动算法（纯计算，不依赖图像库）。
 * 输入为 RGBA 像素，输出 0/1 位（1 = 黑）。
 * 与安卓参考版对齐的 8 种模式：阈值 + 5 种误差扩散 + 2 种 Bayer 有序网点。
 */
import { clamp } from '../model/document';

export type DitherName =
  | 'threshold' | 'floyd' | 'atkinson' | 'jarvis' | 'stucki' | 'sierra'
  | 'bayer4' | 'bayer8';

/** 兼容旧文档中的 ordered / bayer 取值 */
export function normalizeDitherName(mode: string): DitherName {
  switch (mode) {
    case 'ordered': return 'bayer4';
    case 'bayer': return 'bayer8';
    case 'threshold': case 'floyd': case 'atkinson': case 'jarvis':
    case 'stucki': case 'sierra': case 'bayer4': case 'bayer8':
      return mode;
    default: return 'floyd';
  }
}

export const DITHER_OPTIONS: Array<{ value: DitherName; label: string; hint: string }> = [
  { value: 'threshold', label: '清晰阈值', hint: '文字、线稿与二维码最锐利' },
  { value: 'floyd', label: 'Floyd–Steinberg', hint: '照片层次细腻，通用首选' },
  { value: 'atkinson', label: 'Atkinson', hint: '亮部干净、对比更强' },
  { value: 'jarvis', label: 'Jarvis–Judice–Ninke', hint: '渐变柔和，细节丰富' },
  { value: 'stucki', label: 'Stucki', hint: '长图稳定，颗粒更均匀' },
  { value: 'sierra', label: 'Sierra Lite', hint: '速度快、边缘清楚' },
  { value: 'bayer4', label: 'Bayer 4×4', hint: '规则网点，适合图标与浅灰底' },
  { value: 'bayer8', label: 'Bayer 8×8', hint: '更细的规则网点，适合大面积灰阶' },
];

/** RGBA → 灰度（0..255），含亮度/对比度/反色。 */
export function toGray(
  data: Uint8ClampedArray, brightness: number, contrast: number, invert: boolean,
): Float32Array {
  const out = new Float32Array(data.length / 4);
  const c = 1 + clamp(contrast, -100, 100) / 100;
  const b = (clamp(brightness, -100, 100) / 100) * 255;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const a = data[i + 3] / 255;
    // 透明区域按白处理
    let g = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
    g = (g - 128) * c + 128 + b;
    if (invert) g = 255 - g;
    out[j] = clamp(g, 0, 255);
  }
  return out;
}

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

const ORDERED4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

/** 误差扩散核：[dx, dy, 分子]，除以 div */
const KERNELS: Record<string, { div: number; taps: Array<[number, number, number]> }> = {
  floyd: { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jarvis: {
    div: 48,
    taps: [
      [1, 0, 7], [2, 0, 5],
      [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
    ],
  },
  stucki: {
    div: 42,
    taps: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
    ],
  },
  sierra: { div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] }, // Sierra Lite
};

/** 灰度 → 0/1 位（行优先，1=黑）。 */
export function binarize(
  gray: Float32Array, width: number, height: number,
  mode: DitherName, threshold: number,
): Uint8Array {
  const name = normalizeDitherName(mode);
  const out = new Uint8Array(width * height);
  if (name === 'threshold') {
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] < threshold ? 1 : 0;
    return out;
  }
  if (name === 'bayer4' || name === 'bayer8') {
    const matrix = name === 'bayer4' ? ORDERED4 : BAYER8;
    const n = name === 'bayer4' ? 4 : 8;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = ((matrix[(y % n) * n + (x % n)] + 0.5) / (n * n)) * 255;
        out[y * width + x] = gray[y * width + x] < t ? 1 : 0;
      }
    }
    return out;
  }
  // 误差扩散族（floyd / atkinson / jarvis / stucki / sierra）
  const kernel = KERNELS[name] ?? KERNELS.floyd;
  const g = Float32Array.from(gray);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = g[i];
      const next = old < threshold ? 0 : 255;
      out[i] = next === 0 ? 1 : 0;
      const err = old - next;
      for (const [dx, dy, num] of kernel.taps) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny >= height) continue;
        g[ny * width + nx] += (err * num) / kernel.div;
      }
    }
  }
  return out;
}

/** 0/1 位图（宽必须 384）→ GS v 0 光栅字节：每行 48 字节，MSB first，1=黑。 */
export function bitsToRaster(bits: Uint8Array, width: number, height: number): Uint8Array {
  const widthBytes = Math.ceil(width / 8);
  const out = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < widthBytes; bx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit;
        if (x < width && bits[y * width + x]) byte |= 0x80 >> bit;
      }
      out[y * widthBytes + bx] = byte;
    }
  }
  return out;
}
