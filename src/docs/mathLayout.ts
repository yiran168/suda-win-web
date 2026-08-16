/**
 * OMML 公式子集排版器：MathNode AST → MathBox（宽/高/基线 + 相对绘制项）。
 * 覆盖中小学错题/试卷场景的常用结构：分数、上下标、根式、括号、上下划线、
 * 大型运算符（∑∫∏ 的上下限）、矩阵/方程组。未知结构降级为纯文本，保证不丢内容。
 * 排版约定：所有子盒以基线对齐（ascent = 基线以上高度，h - ascent = 基线以下）。
 */
import { MathNode } from './docxModel';
import { DrawItem, TextStyle, translateItems } from './draw';

export interface MathBox {
  w: number;
  h: number;
  /** 基线以上高度（盒内绘制项以 y = ascent 为基线） */
  ascent: number;
  items: DrawItem[];
}

export type Measurer = (text: string, size: number, bold: boolean) => number;

const MIN_SIZE = 10;
const FRAC_SCALE = 0.72;   // 分数分子/分母字号比例
const SCRIPT_SCALE = 0.68; // 上下标字号比例
const LIMIT_SCALE = 0.6;   // 大型运算符上下限字号比例
const MATRIX_SCALE = 0.85; // 矩阵单元格字号比例

function styleOf(size: number, bold: boolean): TextStyle {
  return { bold, italic: false, underline: false, strike: false, size };
}

function runBox(text: string, size: number, bold: boolean, measure: Measurer): MathBox {
  const w = Math.max(1, Math.ceil(measure(text, size, bold)));
  const ascent = Math.round(size * 1.05);
  return {
    w, ascent, h: Math.round(size * 1.35),
    items: [{ t: 'text', x: 0, y: ascent, text, style: styleOf(size, bold) }],
  };
}

/** 顺序拼接若干子盒：基线对齐，水平排列 */
function concat(boxes: MathBox[]): MathBox {
  if (!boxes.length) return { w: 1, h: 4, ascent: 2, items: [] };
  const ascent = Math.max(...boxes.map((b) => b.ascent));
  const descent = Math.max(...boxes.map((b) => b.h - b.ascent));
  let x = 0;
  const items: DrawItem[] = [];
  for (const b of boxes) {
    items.push(...translateItems(b.items, x, ascent - b.ascent));
    x += b.w;
  }
  return { w: x, h: ascent + descent, ascent, items };
}

function seq(nodes: MathNode[], size: number, bold: boolean, measure: Measurer): MathBox {
  return concat(nodes.flatMap((n) => layoutNode(n, size, bold, measure)));
}

function layoutNode(n: MathNode, size: number, bold: boolean, measure: Measurer): MathBox[] {
  const s = Math.max(MIN_SIZE, Math.round(size));
  switch (n.t) {
    case 'run':
      return n.text ? [runBox(n.text, s, bold, measure)] : [];

    case 'frac': {
      const num = seq(n.num, s * FRAC_SCALE, bold, measure);
      const den = seq(n.den, s * FRAC_SCALE, bold, measure);
      const gap = Math.max(3, Math.round(s * 0.18));
      const barH = Math.max(2, Math.round(s * 0.08));
      const w = Math.max(num.w, den.w) + 6;
      const barY = num.h + gap;
      const h = num.h + gap + barH + gap + den.h;
      const ascent = barY + barH + Math.round(s * 0.3); // 基线略低于分数线（视觉居中）
      return [{
        w, h, ascent,
        items: [
          ...translateItems(num.items, Math.round((w - num.w) / 2), 0),
          { t: 'rect', x: 0, y: barY, w, h: barH },
          ...translateItems(den.items, Math.round((w - den.w) / 2), barY + barH + gap),
        ],
      }];
    }

    case 'sup': case 'sub': case 'subsup': {
      const base = seq(n.base, s, bold, measure);
      const supB = n.t !== 'sub' && n.sup.length ? seq(n.sup, s * SCRIPT_SCALE, bold, measure) : null;
      const subB = n.t !== 'sup' && n.sub.length ? seq(n.sub, s * SCRIPT_SCALE, bold, measure) : null;
      const baseDesc = base.h - base.ascent;
      const shiftUp = Math.round(base.ascent * 0.55);
      const shiftDown = Math.max(2, Math.round(baseDesc * 0.9));
      const scriptX = base.w + 2;
      const scriptW = Math.max(supB?.w ?? 0, subB?.w ?? 0);
      const ascent = Math.max(base.ascent, supB ? shiftUp + supB.ascent : 0, subB ? subB.ascent - shiftDown : 0);
      const descent = Math.max(baseDesc, subB ? shiftDown + subB.h - subB.ascent : 0, supB ? supB.h - supB.ascent - shiftUp : 0);
      const items: DrawItem[] = translateItems(base.items, 0, ascent - base.ascent);
      if (supB) items.push(...translateItems(supB.items, scriptX, ascent - shiftUp - supB.ascent));
      if (subB) items.push(...translateItems(subB.items, scriptX, ascent + shiftDown - subB.ascent));
      return [{ w: scriptX + scriptW, h: ascent + descent, ascent, items }];
    }

    case 'rad': {
      const body = seq(n.body, s, bold, measure);
      const lineH = Math.max(2, Math.round(s * 0.08));
      const radSize = Math.max(s, Math.round(body.h * 0.95));
      const degB = n.deg?.length ? seq(n.deg, s * 0.55, bold, measure) : null;
      const degW = degB ? Math.round(degB.w * 0.7) : 0;
      const signX = degW;
      const signW = Math.ceil(measure('√', radSize, false)) + 2;
      const bodyX = signX + signW + 2;
      const bodyY = lineH + 1;
      const h = bodyY + body.h;
      const ascent = bodyY + body.ascent;
      const items: DrawItem[] = [
        { t: 'text', x: signX, y: ascent, text: '√', style: styleOf(radSize, false) },
        { t: 'rect', x: bodyX - 2, y: 0, w: body.w + 3, h: lineH }, // 根号顶线
        ...translateItems(body.items, bodyX, bodyY),
      ];
      if (degB) items.push(...translateItems(degB.items, 0, 0)); // 次数置于根号左上
      return [{ w: bodyX + body.w + 1, h, ascent, items }];
    }

    case 'delim': {
      const body = seq(n.body, s, bold, measure);
      const beg = n.beg || '(', end = n.end || ')';
      const glyphSize = Math.max(s, Math.round(body.h * 0.92));
      const begW = Math.ceil(measure(beg, glyphSize, false)) + 1;
      const endW = Math.ceil(measure(end, glyphSize, false)) + 1;
      const ascent = Math.max(body.ascent, Math.round(glyphSize * 0.92));
      const descent = Math.max(body.h - body.ascent, Math.round(glyphSize * 0.3));
      return [{
        w: begW + body.w + endW + 4, h: ascent + descent, ascent,
        items: [
          { t: 'text', x: 0, y: ascent, text: beg, style: styleOf(glyphSize, false) },
          ...translateItems(body.items, begW + 2, ascent - body.ascent),
          { t: 'text', x: begW + 2 + body.w + 2, y: ascent, text: end, style: styleOf(glyphSize, false) },
        ],
      }];
    }

    case 'bar': {
      const body = seq(n.body, s, bold, measure);
      const barH = Math.max(2, Math.round(s * 0.07));
      const gap = 2;
      return [{
        w: body.w, h: body.h + gap + barH, ascent: body.ascent + gap + barH,
        items: [
          { t: 'rect', x: 0, y: 0, w: body.w, h: barH },
          ...translateItems(body.items, 0, gap + barH),
        ],
      }];
    }

    case 'nary': {
      const chr = n.chr || '∑';
      const chrSize = Math.round(s * 1.6);
      const chrW = Math.ceil(measure(chr, chrSize, false));
      const chrAscent = Math.round(chrSize * 1.0);
      const chrH = Math.round(chrSize * 1.3);
      const subB = n.sub?.length ? seq(n.sub, s * LIMIT_SCALE, bold, measure) : null;
      const supB = n.sup?.length ? seq(n.sup, s * LIMIT_SCALE, bold, measure) : null;
      const body = seq(n.body, s, bold, measure);
      const colW = Math.max(chrW, subB?.w ?? 0, supB?.w ?? 0);
      const topH = supB ? supB.h + 1 : 0;
      const botH = subB ? subB.h + 1 : 0;
      const ascent = topH + chrAscent;
      const h = topH + chrH + botH;
      const items: DrawItem[] = [
        { t: 'text', x: Math.round((colW - chrW) / 2), y: ascent, text: chr, style: styleOf(chrSize, false) },
      ];
      if (supB) items.push(...translateItems(supB.items, Math.round((colW - supB.w) / 2), 0));
      if (subB) items.push(...translateItems(subB.items, Math.round((colW - subB.w) / 2), topH + chrH + 1));
      const bodyX = colW + 3;
      items.push(...translateItems(body.items, bodyX, ascent - body.ascent));
      return [{ w: bodyX + body.w, h: Math.max(h, ascent + body.h - body.ascent), ascent, items }];
    }

    case 'matrix': {
      if (!n.rows.length) return [runBox('[]', s, bold, measure)];
      const cellSize = s * MATRIX_SCALE;
      const cells = n.rows.map((row) => row.map((c) => seq(c, cellSize, bold, measure)));
      const cols = Math.max(...cells.map((r) => r.length));
      const colW: number[] = [];
      const rowH: number[] = [];
      for (let j = 0; j < cols; j++) colW[j] = Math.max(...cells.map((r) => r[j]?.w ?? 0)) + 14;
      for (let i = 0; i < cells.length; i++) rowH[i] = Math.max(...cells[i].map((c) => c.h)) + 8;
      const gridW = colW.reduce((a, b) => a + b, 0);
      const gridH = rowH.reduce((a, b) => a + b, 0);
      const bracketSize = Math.max(s, Math.round(gridH * 0.98));
      const brW = Math.ceil(measure('[', bracketSize, false)) + 2;
      const ascent = Math.round(gridH / 2 + s * 0.25);
      const items: DrawItem[] = [
        { t: 'text', x: 0, y: ascent, text: '[', style: styleOf(bracketSize, false) },
        { t: 'text', x: brW + gridW + 2, y: ascent, text: ']', style: styleOf(bracketSize, false) },
      ];
      let y = 0;
      for (let i = 0; i < cells.length; i++) {
        let x = brW + 2;
        for (let j = 0; j < cells[i].length; j++) {
          const c = cells[i][j];
          items.push(...translateItems(
            c.items,
            x + Math.round((colW[j] - c.w) / 2),
            y + Math.round((rowH[i] - c.h) / 2),
          ));
          x += colW[j];
        }
        y += rowH[i];
      }
      return [{ w: brW * 2 + gridW + 4, h: Math.max(gridH, ascent + Math.round(s * 0.4)), ascent, items }];
    }

    default:
      return [];
  }
}

/**
 * 公式 → MathBox。size 为所在段落字号（光栅点）。
 * 调用方按 token 放置：x 为行内横坐标，baseline - box.ascent 为盒顶纵坐标。
 */
export function layoutMath(nodes: MathNode[], size: number, bold: boolean, measure: Measurer): MathBox {
  return seq(nodes, size, bold, measure);
}
