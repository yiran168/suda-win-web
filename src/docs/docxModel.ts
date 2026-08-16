/**
 * docx 文档模型：自研解析层与排版器共用的 AST。
 * 绕过 mammoth 的原因：它丢弃分栏（w:cols）、文本框（w:txbxContent）、公式（OMML），
 * 嵌套表格也只剩扁平结构。这里保留这四样，排版器据此还原版式。
 */

/** 字符样式（docx rPr 的直接映射；size 为光栅点字号） */
export interface CharStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** 字号（点）；0 = 继承块级默认 */
  size: number;
  /** 上标 / 下标 */
  vertAlign?: 'superscript' | 'subscript';
}

export type Inline =
  | { t: 'text'; text: string; style: CharStyle }
  | { t: 'img'; dataUrl: string; wDots: number; hDots: number }
  | { t: 'math'; root: MathNode[] }
  | { t: 'br' };

export interface ParaStyle {
  /** 标题级别 1–6；0 = 正文 */
  heading: number;
  align: 'left' | 'center' | 'right';
  /** 列表：>0 为有序（值为编号），-1 为无序；0 = 非列表 */
  list: number;
  /** 有序列表的编号模板（w:lvlText，如 "%1." / "第%1条"）；缺省用 "N. " */
  listText?: string;
  /** 列表/段落缩进层级 */
  indentLevel: number;
  /** 段落左缩进（w:ind @w:left，点） */
  indentDots?: number;
}

export type Block =
  | { t: 'para'; style: ParaStyle; content: Inline[] }
  | { t: 'table'; rows: TableCell[][]; weights?: number[] } // weights：tblGrid 列宽比例（twips 原值，排版时归一化）
  | { t: 'box'; blocks: Block[] }      // 文本框：内容完整，位置按阅读顺序就近放置
  | { t: 'hr' };

export interface TableCell {
  blocks: Block[];
  head: boolean;
  /** gridSpan：横跨的列数，缺省 1 */
  span?: number;
}

/** 一节内容：blocks + 分栏数（w:cols @w:num，默认 1） */
export interface DocSection {
  blocks: Block[];
  cols: number;
  /** 栏间距（点），0 用默认 */
  colGapDots: number;
}

export interface FlowDoc {
  sections: DocSection[];
}

/* ------------------------------- OMML 公式子集 ------------------------------- */

export type MathNode =
  | { t: 'run'; text: string }
  | { t: 'frac'; num: MathNode[]; den: MathNode[] }
  | { t: 'sup'; base: MathNode[]; sup: MathNode[] }
  | { t: 'sub'; base: MathNode[]; sub: MathNode[] }
  | { t: 'subsup'; base: MathNode[]; sub: MathNode[]; sup: MathNode[] }
  | { t: 'rad'; deg: MathNode[] | null; body: MathNode[] }
  | { t: 'delim'; beg: string; end: string; body: MathNode[] }
  | { t: 'bar'; body: MathNode[] }                       // 上划线（平均数/共轭）
  | { t: 'nary'; chr: string; sub: MathNode[] | null; sup: MathNode[] | null; body: MathNode[] } // ∑∫ 等
  | { t: 'matrix'; rows: MathNode[][][] };

export function defaultCharStyle(): CharStyle {
  return { bold: false, italic: false, underline: false, strike: false, size: 0 };
}

export function defaultParaStyle(): ParaStyle {
  return { heading: 0, align: 'left', list: 0, indentLevel: 0 };
}
