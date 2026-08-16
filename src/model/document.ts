/**
 * 数据模型：文档 / 纸张 / 元素。
 * 坐标单位全部为「打印点」（203 dpi 下 1 点 = 1/203 英寸），
 * 编辑器、最终预览、打印位图共用同一套点阵坐标，避免单位换算偏移。
 */

/**
 * 打印头硬件参数（默认 384 点 / 203 dpi，58mm 热敏典型值）。
 * 可在「设置 → 设备校准」调整；画布、预览、打印位图全部即时跟随。
 */
export const printerConfig = { headDots: 384, dpi: 203 };

export function setPrinterConfig(headDots: number, dpi: number): void {
  // 光栅按字节行传输，点数必须对齐到 8 的倍数，否则光栅头宽与数据长度不一致
  printerConfig.headDots = clamp(Math.round(headDots / 8) * 8, 96, 1248);
  printerConfig.dpi = clamp(Math.round(dpi), 100, 600);
}

export const MAX_DOCUMENT_HEIGHT_DOTS = 8000; // 约 1 米
export const MIN_ELEMENT_DOTS = 16;
export const MAX_ELEMENTS = 200;

export function mmToDots(mm: number): number {
  return Math.round((mm / 25.4) * printerConfig.dpi);
}

export function dotsToMm(dots: number): number {
  return Math.round((dots / printerConfig.dpi) * 25.4 * 10) / 10;
}

/* ---------------------------------- 纸张 ---------------------------------- */

export type PaperMode = 'continuous' | 'label';
export type PaperShape = 'rect' | 'rounded' | 'oval';
export type HorizontalAnchor = 'left' | 'center' | 'right';

export interface PaperSettings {
  mode: PaperMode;
  /** 实际纸宽 mm，10.0–57.0 */
  widthMm: number;
  /** 标签纸：单张标签长度 mm */
  labelHeightMm: number;
  /** 标签纸：两张标签之间的间隙 mm */
  labelGapMm: number;
  /** 横向微调 mm（整体左右偏移校准） */
  offsetXMm: number;
  /** 纵向偏移 mm（起印位置校准） */
  offsetYMm: number;
  /** 窄纸靠左/靠右装入 */
  anchor: HorizontalAnchor;
  shape: PaperShape;
  topPaddingMm: number;
  bottomPaddingMm: number;
  /** 连续纸打印完成后尾部走纸点数 */
  tailFeedDots: number;
}

export function defaultPaper(): PaperSettings {
  return {
    mode: 'continuous',
    widthMm: 57,
    labelHeightMm: 30,
    labelGapMm: 2,
    offsetXMm: 0,
    offsetYMm: 0,
    anchor: 'left',
    shape: 'rect',
    topPaddingMm: 1,
    bottomPaddingMm: 1,
    tailFeedDots: mmToDots(5), // 连续纸打印后默认走纸 5mm，方便撕纸
  };
}

export function paperWidthDots(p: PaperSettings): number {
  return Math.min(printerConfig.headDots, mmToDots(p.widthMm));
}

/** 纸外列保持全白：可打印区在打印头宽度内的起止列 */
export function printableStartX(p: PaperSettings): number {
  const width = paperWidthDots(p);
  const free = Math.max(0, printerConfig.headDots - width);
  if (p.anchor === 'center') return Math.floor(free / 2);
  return p.anchor === 'left' ? 0 : free;
}
export function printableEndX(p: PaperSettings): number {
  return printableStartX(p) + paperWidthDots(p);
}
export function contentWidthDots(p: PaperSettings): number {
  return paperWidthDots(p);
}
export function fixedHeightDots(p: PaperSettings): number {
  return mmToDots(p.labelHeightMm);
}
export function offsetXDots(p: PaperSettings): number {
  return mmToDots(p.offsetXMm);
}
export function offsetYDots(p: PaperSettings): number {
  return mmToDots(p.offsetYMm);
}

/* ---------------------------------- 元素 ---------------------------------- */

export type ElementKind =
  | 'text'
  | 'image'
  | 'qrcode'
  | 'barcode'
  | 'shape'
  | 'table'
  | 'datetime'
  | 'sequence'
  | 'drawing';

/** 文字类元素（内容大小 = 字号）：拖框与字号双向联动的对象范围 */
export function isTextLikeKind(kind: ElementKind): boolean {
  return kind === 'text' || kind === 'datetime' || kind === 'sequence';
}

export type DitherMode =
  | 'threshold' | 'floyd' | 'atkinson' | 'jarvis' | 'stucki' | 'sierra'
  | 'bayer4' | 'bayer8';
/** 文字增强算法（清晰度补偿，实现见 render/textEnhance.ts；none = 不处理） */
export type TextEnhance = 'none' | 'usm' | 'edge' | 'gamma' | 'adaptive' | 'bold';
export type ImageFit = 'fit' | 'crop' | 'stretch';
export type TextAlign = 'left' | 'center' | 'right';

/** 与安卓参考版对齐的图形种类（另保留 circle / arrow 两个历史值） */
export type ShapeType =
  | 'rect' | 'roundedRect' | 'circle' | 'ellipse' | 'triangle'
  | 'line' | 'verticalLine' | 'dashedLine' | 'dashedVerticalLine'
  | 'arrow' | 'arrowLeft' | 'arrowRight' | 'arrowUp' | 'arrowDown'
  | 'star' | 'heart' | 'pentagon' | 'hexagon' | 'diamond'
  | 'plus' | 'checkmark' | 'speechBubble' | 'cross';

export interface LabelElement {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 绕元素中心旋转，角度制，-180..180 */
  rotation: number;
  locked: boolean;
  /** 非空时同 groupId 的元素为持久组合 */
  groupId: string;

  /* 文本类（text / datetime / sequence 通用） */
  text: string;
  fontFamily: string;
  fontSizeDots: number;
  fontWeight: number; // 100–900
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  verticalText: boolean;
  letterSpacingDots: number;
  lineSpacingDots: number;
  /** 文字增强算法（仅文字类元素生效）：打印清晰度的软件补偿，none = 不处理 */
  textEnhance: TextEnhance;

  /* 图片 */
  /** dataURL 或 idb: 键 */
  src: string;
  imageFit: ImageFit;
  brightness: number; // -100..100
  contrast: number;   // -100..100
  invert: boolean;
  threshold: number;  // 0..255
  ditherMode: DitherMode;

  /* 条码 / 二维码 */
  codeValue: string;
  codeFormat: string; // qrcode | CODE128 | EAN13 | ...

  /* 形状 */
  shapeType: ShapeType;
  filled: boolean;
  strokeWidthDots: number;

  /* 表格 */
  tableRows: number;
  tableCols: number;
  tableCells: string[]; // rows*cols，行优先

  /* 日期时间 / 流水号 */
  dateTimeFormat: string;
  seqStart: number;
  seqStep: number;
  seqPrefix: string;
  seqSuffix: string;
  /** 流水号位数：0 = 不补位；>0 时数值部分左补零对齐到该位数（如 4 → 0001） */
  seqDigits: number;

  /* 手绘：归一化 0..1 坐标对，-1,-1 表示抬笔 */
  drawingPoints: number[];
}

export function uid(): string {
  return 'el-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function elementRight(e: LabelElement): number { return e.x + e.width; }
export function elementBottom(e: LabelElement): number { return e.y + e.height; }
export function elementCenter(e: LabelElement): { cx: number; cy: number } {
  return { cx: e.x + e.width / 2, cy: e.y + e.height / 2 };
}

/* ------------------------- 旋转几何（选中框修复核心） ------------------------- */

export interface Pt { x: number; y: number }
export interface AABB { left: number; top: number; right: number; bottom: number }

/**
 * 元素四个角在应用 rotation 后的真实坐标。
 * 选中框、命中测试、组合外框全部从这里取，保证「框跟着内容走」。
 */
export function elementCorners(e: LabelElement): [Pt, Pt, Pt, Pt] {
  const { cx, cy } = elementCenter(e);
  const r = (e.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const hw = e.width / 2;
  const hh = e.height / 2;
  const local: Pt[] = [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
  ];
  return local.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  })) as [Pt, Pt, Pt, Pt];
}

/** 旋转后的视觉外接框（AABB）。 */
export function visualBounds(e: LabelElement): AABB {
  const corners = elementCorners(e);
  return {
    left: Math.min(...corners.map((c) => c.x)),
    top: Math.min(...corners.map((c) => c.y)),
    right: Math.max(...corners.map((c) => c.x)),
    bottom: Math.max(...corners.map((c) => c.y)),
  };
}

/** 连续纸自动算长：所有元素旋转视觉下边界 + 底部留白。 */
export function contentBottomDots(doc: LabelDocument): number {
  let bottom = 0;
  for (const e of doc.elements) bottom = Math.max(bottom, visualBounds(e).bottom);
  return Math.ceil(bottom) + mmToDots(doc.paper.bottomPaddingMm);
}

/** 点是否在（可能旋转的）元素内 —— 命中测试修复。 */
export function hitTestElement(e: LabelElement, x: number, y: number): boolean {
  const { cx, cy } = elementCenter(e);
  const r = (-e.rotation * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= e.width / 2 && Math.abs(ly) <= e.height / 2;
}

/** 一组元素的组合外框（基于旋转后的视觉边界）。 */
export function groupBounds(elements: LabelElement[]): AABB {
  const boxes = elements.map(visualBounds);
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

export function aabbWidth(b: AABB): number { return Math.max(1, b.right - b.left); }
export function aabbHeight(b: AABB): number { return Math.max(1, b.bottom - b.top); }

/* ---------------------------------- 文档 ---------------------------------- */

/**
 * 按目标纸宽等比缩放整个文档（模板库套用模板时用）。
 * 版式比例不变：元素坐标/尺寸、字号字距、线宽随纸宽比例同升同降；
 * 物理纸张属性（宽度/装纸方向/偏移/尾送走纸）取目标设置，
 * 版式属性（标签长度/上下留白）按比例缩放，模板模式与标签间隙保留。
 * 元素 x 是相对可打印区原点换算的，装纸方向变化时版式仍锚定在纸面内。
 */
export function scaleDocumentToPaper(doc: LabelDocument, target: PaperSettings): LabelDocument {
  const fromDots = paperWidthDots(doc.paper);
  const toDots = paperWidthDots(target);
  if (fromDots <= 0 || toDots <= 0) return doc;
  const ratio = toDots / fromDots;
  const fromX = printableStartX(doc.paper);

  const paper: PaperSettings = {
    ...doc.paper,
    widthMm: target.widthMm,
    anchor: target.anchor,
    offsetXMm: target.offsetXMm,
    offsetYMm: target.offsetYMm,
    tailFeedDots: target.tailFeedDots,
    labelHeightMm: clamp(Math.round(doc.paper.labelHeightMm * ratio * 10) / 10, 5, 300),
    topPaddingMm: doc.paper.topPaddingMm * ratio,
    bottomPaddingMm: doc.paper.bottomPaddingMm * ratio,
  };
  const toX = printableStartX(paper);
  // 比例≈1 时元素原样（避免无意义的取整抖动），只同步纸张设置
  if (Math.abs(ratio - 1) < 0.005) return { ...doc, paper };

  const s = (v: number) => Math.round(v * ratio);
  const elements = doc.elements.map((e) => ({
    ...e,
    x: toX + s(e.x - fromX),
    y: s(e.y),
    width: Math.max(MIN_ELEMENT_DOTS, s(e.width)),
    height: Math.max(MIN_ELEMENT_DOTS, s(e.height)),
    fontSizeDots: clamp(s(e.fontSizeDots), 8, 240),
    letterSpacingDots: clamp(s(e.letterSpacingDots), -12, 64),
    lineSpacingDots: clamp(s(e.lineSpacingDots), -32, 128),
    strokeWidthDots: clamp(s(e.strokeWidthDots), 1, 40),
  }));
  return { ...doc, paper, elements };
}

export interface LabelDocument {
  id: string;
  title: string;
  category: string;
  paper: PaperSettings;
  elements: LabelElement[];
  createdAt: number;
  updatedAt: number;
}

/** 归一化：裁剪非法值，防止导入/撤销产生坏数据。 */
export function normalizeDocument(doc: LabelDocument): LabelDocument {
  const paper = { ...doc.paper };
  paper.widthMm = clamp(paper.widthMm, 10, 57);
  paper.labelHeightMm = clamp(paper.labelHeightMm, 5, 300);
  paper.labelGapMm = clamp(paper.labelGapMm, 0, 50);
  const elements = doc.elements.slice(0, MAX_ELEMENTS).map((e) => {
    const next = { ...e };
    next.x = clamp(Math.round(finite(e.x, 8)), -printerConfig.headDots * 4, printerConfig.headDots * 4);
    next.y = clamp(Math.round(finite(e.y, 8)), -MAX_DOCUMENT_HEIGHT_DOTS, MAX_DOCUMENT_HEIGHT_DOTS);
    next.width = clamp(Math.round(finite(e.width, 200)), MIN_ELEMENT_DOTS, printerConfig.headDots * 8);
    next.height = clamp(Math.round(finite(e.height, 56)), MIN_ELEMENT_DOTS, MAX_DOCUMENT_HEIGHT_DOTS);
    next.rotation = clamp(finite(e.rotation, 0), -360, 360);
    next.fontSizeDots = clamp(finite(e.fontSizeDots, 28), 8, 240);
    next.fontWeight = clamp(Math.round(finite(e.fontWeight, 400)), 100, 900);
    next.lineSpacingDots = clamp(finite(e.lineSpacingDots, 3), -32, 128);
    next.letterSpacingDots = clamp(finite(e.letterSpacingDots, 0), -12, 64);
    next.strokeWidthDots = clamp(finite(e.strokeWidthDots, 4), 1, 40);
    next.seqDigits = clamp(Math.round(finite(e.seqDigits, 0)), 0, 12);
    // 文字增强算法：旧文档无此字段或取值非法时回退 none
    const enhances = ['none', 'usm', 'edge', 'gamma', 'adaptive', 'bold'];
    if (!enhances.includes(e.textEnhance as string)) next.textEnhance = 'none';
    next.threshold = clamp(Math.round(finite(e.threshold, 128)), 0, 255);
    // 旧文档的 ordered/bayer 抖动取值迁移
    if ((e.ditherMode as string) === 'ordered') next.ditherMode = 'bayer4';
    else if ((e.ditherMode as string) === 'bayer') next.ditherMode = 'bayer8';
    return next;
  });
  return { ...doc, paper, elements };
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/* --------------------------------- JSON ---------------------------------- */

export function documentToJson(doc: LabelDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function documentFromJson(text: string): LabelDocument {
  const raw = JSON.parse(text) as LabelDocument;
  if (!raw || !Array.isArray(raw.elements) || !raw.paper) throw new Error('不是有效的素打文档 JSON');
  const ids = new Set<string>();
  for (const e of raw.elements) {
    if (!e.id || ids.has(e.id)) e.id = uid();
    ids.add(e.id);
  }
  return normalizeDocument(raw);
}
