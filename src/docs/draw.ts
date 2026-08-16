/**
 * 排版绘图原语：flowTypeset（段落/表格/分栏）与 mathLayout（公式）共用的
 * 绝对定位绘制项。所有坐标为 1:1 光栅点（203dpi）。
 * 只画文本、矩形、data: 图片——任何环境（Electron / Chrome / Firefox）都不污染画布。
 */

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** 字号（光栅点 = px） */
  size: number;
}

export type DrawItem =
  | { t: 'text'; x: number; y: number; text: string; style: TextStyle }
  | { t: 'rect'; x: number; y: number; w: number; h: number } // 下划线/删除线/表格线/边框/分数线
  | { t: 'img'; x: number; y: number; w: number; h: number; img: HTMLImageElement };

export function fontOf(s: Pick<TextStyle, 'bold' | 'italic' | 'size'>): string {
  return `${s.italic ? 'italic ' : ''}${s.bold ? 700 : 400} ${s.size}px system-ui,"Microsoft YaHei",sans-serif`;
}

/** 平移一组绘制项（子排版结果合并进父排版时使用） */
export function translateItems(items: DrawItem[], dx: number, dy: number): DrawItem[] {
  if (!dx && !dy) return items;
  return items.map((it) => ({ ...it, x: it.x + dx, y: it.y + dy }));
}

/** 文本 → 断词单元：拉丁词/数字串不断开，CJK 与标点逐字可断，空白为断点 */
export function splitTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9_$.%+\-/]+|[ \t]+|./gsu) ?? [];
}
