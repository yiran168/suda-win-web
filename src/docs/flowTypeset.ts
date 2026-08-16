/**
 * FlowDoc AST → 画布 的手工排版器（docxParser 的下游）。
 * 能力：段落（对齐/标题/真实字号/上下标）、有序无序列表（Word 编号模板）、
 * 分栏（节级，按栏带填充，块级回退防溢出）、表格（列宽比例 + gridSpan + 嵌套递归）、
 * 文本框（边框 + 就近放置）、公式（mathLayout）、图片（行内/整行自适应）、水平线。
 * 输出 1:1 光栅点画布（白底黑字）；只画文本/矩形/data:图片，任何环境不污染画布。
 */
import { Block, DocSection, FlowDoc, Inline, ParaStyle, TableCell } from './docxModel';
import { DrawItem, TextStyle, fontOf, splitTokens, translateItems } from './draw';
import { MathBox, layoutMath } from './mathLayout';

const BODY_SIZE = 28;
const LINE_RATIO = 1.45;
const HEADING_SIZE = [0, 46, 40, 34, 30, 28, 26]; // 1–6 级标题字号（点）
const CELL_PAD = 6;
const BOX_BORDER = 2;
const BOX_PAD = 10;
const MAX_IMG_H = 1200;
const COL_GAP_DEFAULT = 16;

/** 行内排版原子：文本片 / 图片 / 公式盒，统一带宽度与基线度量 */
interface LineTok {
  w: number;
  ascent: number;
  descent: number;
  text?: string;
  style?: TextStyle;
  img?: { img: HTMLImageElement; h: number };
  math?: MathBox;
}

class Layouter {
  readonly width: number;
  items: DrawItem[] = [];
  y = 0;
  /** 正文基准字号（表格单元格/文本框内的子排版器会调小） */
  baseSize = BODY_SIZE;
  baseBold = false;
  private ctx: CanvasRenderingContext2D;
  private line: LineTok[] = [];
  private indent = 0;
  /** 当前行起始缩进（行首 token 装入时捕获；悬挂缩进首行/折行不同） */
  private lineIndent = 0;
  private align: 'left' | 'center' | 'right' = 'left';
  /** 紧凑模式（表格单元格/文本框）：段落间距收敛，小空间不被空白吃掉 */
  private compact: boolean;

  constructor(width: number, compact = false) {
    this.width = width;
    this.compact = compact;
    this.ctx = document.createElement('canvas').getContext('2d')!;
  }

  measure(text: string, size: number, bold: boolean, italic = false): number {
    this.ctx.font = fontOf({ bold, italic, size });
    return this.ctx.measureText(text).width;
  }

  /** 分栏回退用：快照/回滚（保证块级原子性，装不下的整块换栏） */
  mark(): { n: number; y: number } {
    return { n: this.items.length, y: this.y };
  }
  rollback(m: { n: number; y: number }): void {
    this.items.length = m.n;
    this.y = m.y;
    this.line = [];
  }

  /** 当前行缓冲落盘并换行；行高 = 行内最大 ascent + descent（混排公式/图片也正确） */
  flushLine(): void {
    if (!this.line.length) return;
    const maxA = Math.max(...this.line.map((t) => t.ascent));
    const maxD = Math.max(...this.line.map((t) => t.descent));
    const baseline = this.y + maxA;
    const avail = this.width - this.lineIndent;
    const contentW = this.line.reduce((a, t) => a + t.w, 0);
    let x = this.lineIndent;
    if (this.align === 'center') x += Math.max(0, (avail - contentW) / 2);
    else if (this.align === 'right') x += Math.max(0, avail - contentW);
    for (const tok of this.line) {
      if (tok.text != null && tok.style) {
        this.items.push({ t: 'text', x, y: baseline, text: tok.text, style: tok.style });
        if (tok.style.underline) {
          this.items.push({ t: 'rect', x, y: baseline + 3, w: tok.w, h: Math.max(1, tok.style.size / 14) });
        }
        if (tok.style.strike) {
          this.items.push({ t: 'rect', x, y: baseline - tok.style.size * 0.32, w: tok.w, h: Math.max(1, tok.style.size / 16) });
        }
      } else if (tok.img) {
        this.items.push({ t: 'img', x, y: baseline - tok.ascent, w: tok.w, h: tok.img.h, img: tok.img.img });
      } else if (tok.math) {
        this.items.push(...translateItems(tok.math.items, x, baseline - tok.math.ascent));
      }
      x += tok.w;
    }
    this.y += maxA + maxD;
    this.line = [];
  }

  private lineWidth(): number {
    return this.line.reduce((a, t) => a + t.w, 0);
  }

  /* --------------------------------- 行内 --------------------------------- */

  private textTok(text: string, style: TextStyle, vertAlign?: 'superscript' | 'subscript'): LineTok {
    let size = style.size;
    let ascent = size * 1.1;
    let descent = size * (LINE_RATIO - 1.1);
    if (vertAlign === 'superscript') {
      size = Math.max(14, Math.round(style.size * 0.7));
      ascent = size * 1.1 + style.size * 0.45;
      descent = size * 0.35;
    } else if (vertAlign === 'subscript') {
      size = Math.max(14, Math.round(style.size * 0.7));
      ascent = size * 1.1;
      descent = size * 0.35 + style.size * 0.3;
    }
    return { w: this.measure(text, size, style.bold, style.italic), ascent, descent, text, style: { ...style, size } };
  }

  /** 逐 token 贪心装行（拉丁词不断、CJK 逐字可断、行首空白丢弃） */
  private feedText(text: string, style: TextStyle, vertAlign?: 'superscript' | 'subscript'): void {
    for (const piece of splitTokens(text)) {
      const isSpace = /^[ \t]+$/.test(piece);
      if (isSpace && !this.line.length) continue;
      if (!this.line.length) this.lineIndent = this.indent;
      const tok = this.textTok(piece, style, vertAlign);
      if (this.lineWidth() + tok.w > this.width - this.indent && this.line.length) {
        this.flushLine();
        if (isSpace) continue; // 行尾空白不带到下一行
        this.lineIndent = this.indent;
      }
      this.line.push(tok);
    }
  }

  private async feedImage(dataUrl: string, wDots: number, hDots: number): Promise<void> {
    const img = await loadImg(dataUrl);
    if (!img) return;
    const avail = this.width - this.indent;
    let w = Math.min(avail, wDots);
    let h = Math.max(1, Math.round((w * hDots) / Math.max(1, wDots)));
    if (h > MAX_IMG_H) { w = Math.round((w * MAX_IMG_H) / h); h = MAX_IMG_H; }
    if (this.lineWidth() + w > avail && this.line.length) this.flushLine();
    if (!this.line.length) this.lineIndent = this.indent;
    this.line.push({ w, ascent: h - 6, descent: 6, img: { img, h } });
    if (w > avail * 0.66) this.flushLine(); // 大图独占一行
  }

  private feedMath(root: Parameters<typeof layoutMath>[0], base: TextStyle): void {
    const measure = (t: string, sz: number, b: boolean) => this.measure(t, sz, b);
    let box = layoutMath(root, base.size, base.bold, measure);
    const avail = this.width - this.indent;
    if (box.w > avail) {
      // 公式超宽：整体缩字号重排一次（下限 12 点保证可读）
      const shrink = Math.max(12, Math.floor((base.size * avail) / box.w));
      if (shrink < base.size) box = layoutMath(root, shrink, base.bold, measure);
    }
    if (this.lineWidth() + box.w > avail && this.line.length) this.flushLine();
    if (!this.line.length) this.lineIndent = this.indent;
    this.line.push({ w: box.w, ascent: box.ascent, descent: box.h - box.ascent, math: box });
  }

  private async feedInlines(content: Inline[], base: TextStyle): Promise<void> {
    for (const inl of content) {
      switch (inl.t) {
        case 'text': {
          const text = inl.text.replace(/\s+/g, ' ');
          if (!text) break;
          const merged: TextStyle = {
            bold: base.bold || inl.style.bold,
            italic: inl.style.italic,
            underline: inl.style.underline,
            strike: inl.style.strike,
            size: inl.style.size || base.size,
          };
          this.feedText(text, merged, inl.style.vertAlign);
          break;
        }
        case 'br': this.flushLine(); break;
        case 'img': await this.feedImage(inl.dataUrl, inl.wDots, inl.hDots); break;
        case 'math': this.feedMath(inl.root, base); break;
      }
    }
  }

  /* --------------------------------- 块级 --------------------------------- */

  async flowBlocks(blocks: Block[]): Promise<void> {
    let emptyStreak = 0;
    for (const b of blocks) {
      switch (b.t) {
        case 'para':
          if (!b.content.length) {
            // 空段落 = Word 空行；封顶 3 连，防止一串空段吃掉半张纸
            emptyStreak += 1;
            this.flushLine();
            if (emptyStreak <= 3) this.y += this.compact ? 3 : 8;
          } else {
            emptyStreak = 0;
            await this.para(b.style, b.content);
          }
          break;
        case 'hr': {
          emptyStreak = 0;
          this.flushLine();
          this.y += this.compact ? 4 : 8;
          this.items.push({ t: 'rect', x: this.indent, y: this.y, w: this.width - this.indent, h: 2 });
          this.y += this.compact ? 6 : 10;
          break;
        }
        case 'table':
          emptyStreak = 0;
          await this.flowTable(b.rows, b.weights);
          break;
        case 'box':
          emptyStreak = 0;
          await this.flowBox(b.blocks);
          break;
      }
    }
    this.flushLine();
  }

  private async para(style: ParaStyle, content: Inline[]): Promise<void> {
    this.flushLine();
    const isH = style.heading >= 1;
    const base: TextStyle = {
      bold: isH || this.baseBold,
      italic: false, underline: false, strike: false,
      size: isH ? HEADING_SIZE[style.heading] : this.baseSize,
    };
    this.align = style.align;
    this.y += this.compact ? 1 : isH ? (style.heading === 1 ? 14 : 10) : 4;
    const savedIndent = this.indent;
    const extraIndent = Math.min(style.indentDots ?? 0, this.width / 3);
    if (style.list !== 0) {
      this.indent = savedIndent + style.indentLevel * 16 + extraIndent;
      const marker = style.list > 0
        ? `${style.listText ? style.listText.replace('%1', String(style.list)) : `${style.list}.`} `
        : '• ';
      const markerTok = this.textTok(marker, base);
      this.line.push(markerTok);
      this.lineIndent = this.indent;
      this.indent += markerTok.w; // 悬挂缩进：折行对齐 marker 之后
    } else if (extraIndent > 0) {
      this.indent = savedIndent + extraIndent;
    }
    await this.feedInlines(content, base);
    this.flushLine();
    this.indent = savedIndent;
    this.align = 'left';
    this.y += this.compact ? 1 : isH ? 6 : 4;
  }

  /** 表格：tblGrid 列宽比例（无则等宽）+ gridSpan 跨列 + 单元格子排版器递归（嵌套表格自然生效） */
  private async flowTable(rows: TableCell[][], weights?: number[]): Promise<void> {
    this.flushLine();
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.reduce((a, c) => a + (c.span ?? 1), 0)), 1);
    const avail = this.width - this.indent;
    const colW: number[] = [];
    if (weights && weights.length >= cols && weights.slice(0, cols).some((w) => w > 0)) {
      const sum = weights.slice(0, cols).reduce((a, b) => a + Math.max(0, b), 0);
      for (let j = 0; j < cols; j++) colW.push(Math.max(24, Math.floor((avail * Math.max(0, weights[j])) / sum)));
    } else {
      for (let j = 0; j < cols; j++) colW.push(Math.floor(avail / cols));
    }
    colW[cols - 1] += avail - colW.reduce((a, b) => a + b, 0); // 末列补差，保证总宽精确
    const colX: number[] = [this.indent];
    for (let j = 0; j < cols; j++) colX.push(colX[j] + colW[j]);

    this.y += this.compact ? 2 : 4;
    const tableTop = this.y;
    for (const row of rows) {
      const placed: { items: DrawItem[]; x: number }[] = [];
      let rowH = 24;
      let col = 0;
      for (const cell of row) {
        const span = Math.min(cell.span ?? 1, cols - col);
        const spanW = Math.max(24, colX[Math.min(col + span, cols)] - colX[col] - CELL_PAD * 2);
        const sub = new Layouter(spanW, true);
        sub.baseSize = BODY_SIZE - 4;
        sub.baseBold = cell.head;
        await sub.flowBlocks(cell.blocks);
        placed.push({ items: sub.items, x: colX[col] + CELL_PAD });
        rowH = Math.max(rowH, sub.y + CELL_PAD * 2);
        col += span;
      }
      for (const p of placed) this.items.push(...translateItems(p.items, p.x, this.y + CELL_PAD));
      this.items.push({ t: 'rect', x: this.indent, y: this.y, w: avail, h: 1 }); // 行线
      this.y += rowH;
    }
    // 外框加粗一档 + 内竖线（接近 Word 默认框线的热敏呈现）
    const h = this.y - tableTop;
    this.items.push({ t: 'rect', x: this.indent, y: tableTop, w: avail, h: 2 });
    this.items.push({ t: 'rect', x: this.indent, y: this.y - 1, w: avail, h: 2 });
    this.items.push({ t: 'rect', x: this.indent, y: tableTop, w: 2, h });
    this.items.push({ t: 'rect', x: this.indent + avail - 1, y: tableTop, w: 2, h });
    for (let j = 1; j < cols; j++) this.items.push({ t: 'rect', x: colX[j], y: tableTop, w: 1, h });
    this.y += this.compact ? 4 : 8;
  }

  /** 文本框：边框 + 内边距就近排（Word 浮动定位的热敏务实呈现，内容完整不丢） */
  private async flowBox(blocks: Block[]): Promise<void> {
    this.flushLine();
    const avail = this.width - this.indent;
    const sub = new Layouter(Math.max(48, avail - (BOX_BORDER + BOX_PAD) * 2), true);
    await sub.flowBlocks(blocks);
    this.y += this.compact ? 3 : 6;
    const top = this.y;
    this.items.push(...translateItems(sub.items, this.indent + BOX_BORDER + BOX_PAD, top + BOX_BORDER + BOX_PAD));
    const h = sub.y + (BOX_BORDER + BOX_PAD) * 2;
    const x0 = this.indent;
    this.items.push({ t: 'rect', x: x0, y: top, w: avail, h: BOX_BORDER });
    this.items.push({ t: 'rect', x: x0, y: top + h - BOX_BORDER, w: avail, h: BOX_BORDER });
    this.items.push({ t: 'rect', x: x0, y: top, w: BOX_BORDER, h });
    this.items.push({ t: 'rect', x: x0 + avail - BOX_BORDER, y: top, w: BOX_BORDER, h });
    this.y = top + h + (this.compact ? 3 : 6);
  }

  /* --------------------------------- 分栏 --------------------------------- */

  async flowSections(sections: DocSection[], bandHeight: number): Promise<void> {
    for (const sec of sections) {
      if (sec.cols <= 1 || !sec.blocks.length) {
        await this.flowBlocks(sec.blocks);
        continue;
      }
      await this.flowColumns(sec, bandHeight);
    }
  }

  /**
   * 分栏：栏带高 bandHeight（标签纸=标签高，连续纸=宽×1.4）。
   * 逐栏填充整块内容，装不下的块回退换栏；栏满后在下方开新栏带。
   * 单块超栏高时整块放进当前空栏（栏带随之加高），保证任何内容都能前进。
   */
  private async flowColumns(sec: DocSection, bandHeight: number): Promise<void> {
    const gap = sec.colGapDots > 0 ? sec.colGapDots : COL_GAP_DEFAULT;
    const colW = Math.max(40, Math.floor((this.width - gap * (sec.cols - 1)) / sec.cols));
    const blocks = sec.blocks;
    let i = 0;
    let guard = 0;
    while (i < blocks.length && guard++ < 500) {
      const bandTop = this.y;
      let bandH = 0;
      for (let c = 0; c < sec.cols && i < blocks.length; c++) {
        const sub = new Layouter(colW, false);
        let consumed = 0;
        while (i < blocks.length) {
          const mark = sub.mark();
          await sub.flowBlocks([blocks[i]]);
          if (sub.y > bandHeight && consumed > 0) { sub.rollback(mark); break; }
          consumed += 1;
          i += 1;
        }
        this.items.push(...translateItems(sub.items, c * (colW + gap), bandTop));
        bandH = Math.max(bandH, sub.y);
      }
      this.y = bandTop + bandH + 12;
    }
  }

  /* --------------------------------- 输出 --------------------------------- */

  render(): HTMLCanvasElement {
    this.flushLine();
    const height = Math.max(64, Math.ceil(this.y) + 8);
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.width, height);
    ctx.fillStyle = '#000';
    for (const item of this.items) {
      if (item.t === 'text') {
        ctx.font = fontOf(item.style);
        ctx.fillText(item.text, item.x, item.y);
      } else if (item.t === 'rect') {
        ctx.fillRect(item.x, item.y, item.w, item.h);
      } else {
        ctx.drawImage(item.img, item.x, item.y, item.w, item.h);
      }
    }
    return canvas;
  }
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // 坏图不拖垮整篇导入
    img.src = src;
  });
}

/**
 * FlowDoc → 画布。
 * bandHeight：分栏栏带高度——标签纸传标签高（栏带与标签边界对齐），连续纸传 宽×1.4；单栏文档忽略。
 */
export async function flowToCanvas(flow: FlowDoc, width: number, bandHeight: number): Promise<HTMLCanvasElement> {
  const layouter = new Layouter(width);
  await layouter.flowSections(flow.sections, bandHeight);
  return layouter.render();
}
