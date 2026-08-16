/**
 * 文字增强算法（打印清晰度补偿）。
 * 背景：这台机器的浓度指令不生效，浓淡无法靠硬件调，清晰度只能在软件端
 * 于「灰度 → 二值化」之前补偿。五种算法按清晰度从高到低排列；
 * none = 不处理（默认，保持原始渲染）。
 * 输入/输出均为元素瓦片的灰度图（Float32Array，0..255），后续仍走 128 阈值二值化。
 */
import { clamp } from '../model/document';

export const TEXT_ENHANCE_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'none', label: '无（默认）', hint: '原始渲染，不做增强' },
  { value: 'usm', label: '① USM 锐化', hint: '清晰度最高：边缘反差强化，笔画干净利落' },
  { value: 'edge', label: '② 边缘加深', hint: '压黑笔画边缘的抗锯齿灰点，轮廓更挺' },
  { value: 'gamma', label: '③ 笔画加深', hint: '中间调整体压暗，偏淡的笔画变实' },
  { value: 'adaptive', label: '④ 自适应阈值', hint: '按局部亮度动态定界，深浅不均也清楚' },
  { value: 'bold', label: '⑤ 加粗一档', hint: '黑区外扩一点，字最粗但边缘略钝' },
];

/** 可分离盒式模糊（两遍：水平 + 垂直），radius 为半径 */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win;
      const add = clamp(x + radius + 1, 0, w - 1);
      const sub = clamp(x - radius, 0, w - 1);
      acc += src[y * w + add] - src[y * w + sub];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const add = clamp(y + radius + 1, 0, h - 1);
      const sub = clamp(y - radius, 0, h - 1);
      acc += tmp[add * w + x] - tmp[sub * w + x];
    }
  }
  return out;
}

/**
 * 在灰度瓦片上应用文字增强。
 * 只处理文字类元素（text / datetime / sequence）；none 或未知值原样返回。
 */
export function applyTextEnhance(gray: Float32Array, w: number, h: number, mode: string): Float32Array {
  switch (mode) {
    case 'usm': {
      // 反锐化掩模：原图 +（原图 − 模糊）× 强度 —— 边缘两侧反差拉大
      const blur = boxBlur(gray, w, h, 1);
      const amount = 1.3;
      const out = new Float32Array(gray.length);
      for (let i = 0; i < gray.length; i++) {
        out[i] = clamp(gray[i] + (gray[i] - blur[i]) * amount, 0, 255);
      }
      return out;
    }
    case 'edge': {
      // 边缘加深：比邻域均值暗的点进一步压黑，亮点不动 —— 灭掉笔画边缘的灰过渡
      const mean = boxBlur(gray, w, h, 1);
      const out = new Float32Array(gray.length);
      for (let i = 0; i < gray.length; i++) {
        const d = mean[i] - gray[i];
        out[i] = d > 0 ? clamp(gray[i] - d * 0.9, 0, 255) : gray[i];
      }
      return out;
    }
    case 'gamma': {
      // 伽马压暗（γ=0.55）：中间调向黑端移动，抗锯齿灰边整体落进黑区
      const out = new Float32Array(gray.length);
      for (let i = 0; i < gray.length; i++) {
        out[i] = 255 * Math.pow(gray[i] / 255, 0.55);
      }
      return out;
    }
    case 'adaptive': {
      // 局部均值阈值：15×15 邻域均值 − 偏移，逐点定黑白（输出已是 0/255 两值）
      const mean = boxBlur(gray, w, h, 7);
      const out = new Float32Array(gray.length);
      for (let i = 0; i < gray.length; i++) {
        out[i] = gray[i] < mean[i] - 14 ? 0 : 255;
      }
      return out;
    }
    case 'bold': {
      // 3×3 最小值滤波：黑区向四周外扩 1 点，字迹整体加粗
      const out = new Float32Array(gray.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let m = 255;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = clamp(y + dy, 0, h - 1);
            for (let dx = -1; dx <= 1; dx++) {
              const v = gray[yy * w + clamp(x + dx, 0, w - 1)];
              if (v < m) m = v;
            }
          }
          out[y * w + x] = m;
        }
      }
      return out;
    }
    default:
      return gray;
  }
}
