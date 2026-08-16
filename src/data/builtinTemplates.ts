/**
 * 内置行业模板目录（移植自安卓参考版 TemplateCatalog + IndustryCatalog）：
 * 494 套模板 = 装饰底图（webp）+ 归一化坐标上的文字/码/图形叠加层，
 * 经 pixelBox 映射为点阵文档，与编辑器、打印共用同一渲染管线。
 */
import specs, { BuiltinTemplateSpec } from './builtinTemplateSpecs';
import { TEMPLATE_THUMBS } from './templateThumbs';
import {
  LabelDocument, LabelElement, PaperSettings, ShapeType, clamp,
  defaultPaper, fixedHeightDots, paperWidthDots, printableStartX, uid,
} from '../model/document';

export const TEMPLATE_CATEGORIES = [
  '全部', '通用', '商业零售', '餐饮服务', '医药行业', '办公管理', '通讯电力',
  '居家生活', '生产制造', '仓储物流', '收款码', '直播带货', '其他场景',
];

export interface BuiltinTemplate {
  id: string;
  title: string;
  category: string;
  widthMm: number;
  heightMm: number;
  /** 装饰底图 URL（净化版，进文档、可编辑可删） */
  decorUrl: string;
  /** 缩略图 URL：原始设计图（含文字的最终效果），仅用于模板库预览 */
  thumbUrl: string;
  document: LabelDocument;
}

/** 安卓 BarcodeType → 我们的码制/元素种类 */
function codeToElement(box: PixelBox, type: string, content: string, paper: PaperSettings): LabelElement {
  const twoD = ['QR_CODE', 'GS1_QR', 'DATA_MATRIX', 'GS1_DATA_MATRIX', 'PDF_417', 'AZTEC'].includes(type);
  const base: LabelElement = {
    id: uid(), kind: twoD ? 'qrcode' : 'barcode',
    x: box.left, y: box.top, width: box.width, height: box.height,
    rotation: 0, locked: false, groupId: '',
    text: '', fontFamily: 'sans-serif', fontSizeDots: 20, fontWeight: 400,
    italic: false, underline: false, align: 'left', verticalText: false,
    letterSpacingDots: 0, lineSpacingDots: 0,
    src: '', imageFit: 'fit', brightness: 0, contrast: 0, invert: false,
    threshold: 128, ditherMode: 'threshold',
    codeValue: content,
    codeFormat: {
      CODE_128: 'CODE128', GS1_128: 'GS1_128', CODE_39: 'CODE39', CODE_93: 'CODE93',
      CODABAR: 'codabar', EAN_13: 'EAN13', ISBN_13: 'ISBN', ISSN_13: 'ISSN',
      JAN_13: 'JAN13', EAN_8: 'EAN8', UPC_A: 'UPC', UPC_E: 'UPCE', ITF: 'ITF',
      DATA_MATRIX: 'DATAMATRIX', GS1_DATA_MATRIX: 'GS1_DATAMATRIX',
      PDF_417: 'PDF417', AZTEC: 'AZTEC',
    }[type] ?? (twoD ? 'qrcode' : 'CODE128'),
    shapeType: 'rect', filled: false, strokeWidthDots: 2,
    tableRows: 0, tableCols: 0, tableCells: [],
    dateTimeFormat: '', seqStart: 0, seqStep: 0, seqPrefix: '', seqSuffix: '', seqDigits: 0,
    textEnhance: 'none',
    drawingPoints: [],
  };
  void paper;
  return base;
}

const SHAPE_KIND_MAP: Record<string, ShapeType> = {
  RECTANGLE: 'rect', ROUNDED_RECTANGLE: 'roundedRect', ELLIPSE: 'ellipse',
  TRIANGLE: 'triangle', PENTAGON: 'pentagon', HEXAGON: 'hexagon', DIAMOND: 'diamond',
  STAR: 'star', HEART: 'heart', PLUS: 'plus', CHECKMARK: 'checkmark',
  LINE: 'line', VERTICAL_LINE: 'verticalLine',
  DASHED_LINE: 'dashedLine', DASHED_VERTICAL_LINE: 'dashedVerticalLine',
  ARROW_LEFT: 'arrowLeft', ARROW_RIGHT: 'arrow', ARROW_UP: 'arrowUp', ARROW_DOWN: 'arrowDown',
  SPEECH_BUBBLE: 'speechBubble', CROSS: 'cross',
};

interface PixelBox { left: number; top: number; width: number; height: number }

/** 归一化坐标 → 点阵盒（移植 TemplateCatalog.pixelBox：最小尺寸 + 画布内钳制） */
function pixelBox(
  nl: number, nt: number, nr: number, nb: number,
  contentX: number, canvasW: number, canvasH: number, minW: number, minH: number,
): PixelBox {
  const safeMinW = Math.min(minW, canvasW);
  const safeMinH = Math.min(minH, canvasH);
  let left = contentX + Math.round(clamp(nl, 0, 1) * canvasW);
  let top = Math.round(clamp(nt, 0, 1) * canvasH);
  let right = contentX + Math.round(clamp(nr, 0, 1) * canvasW);
  let bottom = Math.round(clamp(nb, 0, 1) * canvasH);
  right = Math.max(right, left + safeMinW);
  bottom = Math.max(bottom, top + safeMinH);
  if (right > contentX + canvasW) { left -= right - (contentX + canvasW); right = contentX + canvasW; }
  if (bottom > canvasH) { top -= bottom - canvasH; bottom = canvasH; }
  left = clamp(left, contentX, contentX + canvasW - safeMinW);
  top = clamp(top, 0, canvasH - safeMinH);
  return { left, top, width: Math.max(safeMinW, right - left), height: Math.max(safeMinH, bottom - top) };
}

function createDocument(spec: BuiltinTemplateSpec): LabelDocument {
  const paper: PaperSettings = {
    ...defaultPaper(),
    mode: 'label',
    shape: 'rect',
    widthMm: clamp(spec.widthMm, 10, 57),
    labelHeightMm: clamp(spec.heightMm, 5, 300),
    labelGapMm: 2,
    anchor: 'left',
  };
  const widthDots = paperWidthDots(paper);
  const heightDots = fixedHeightDots(paper);
  const contentX = printableStartX(paper);
  const elements: LabelElement[] = [];

  // 装饰底图：整幅拉伸 + Floyd–Steinberg 抖动 + 较高阈值（对齐参考版参数）
  if (spec.decorResource) {
    elements.push({
      id: uid(), kind: 'image',
      x: contentX, y: 0, width: widthDots, height: heightDots,
      rotation: 0, locked: false, groupId: '',
      text: '', fontFamily: 'sans-serif', fontSizeDots: 20, fontWeight: 400,
      italic: false, underline: false, align: 'left', verticalText: false,
      letterSpacingDots: 0, lineSpacingDots: 0,
      src: `./templates/${spec.decorResource}.webp`,
      imageFit: 'stretch', brightness: 0, contrast: 6, invert: false,
      threshold: 170, ditherMode: 'floyd',
      codeValue: '', codeFormat: '',
      shapeType: 'rect', filled: false, strokeWidthDots: 2,
      tableRows: 0, tableCols: 0, tableCells: [],
      dateTimeFormat: '', seqStart: 0, seqStep: 0, seqPrefix: '', seqSuffix: '', seqDigits: 0,
    textEnhance: 'none',
      drawingPoints: [],
    });
  }

  for (const t of spec.text) {
    const box = pixelBox(t.left, t.top, t.right, t.bottom, contentX, widthDots, heightDots, 18, 18);
    elements.push({
      id: uid(), kind: 'text',
      x: box.left, y: box.top, width: box.width, height: box.height,
      rotation: 0, locked: false, groupId: '',
      text: t.text, fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSizeDots: clamp(box.height * 0.76, 10, 64),
      fontWeight: t.emphasis ? 700 : 400,
      italic: false, underline: false,
      align: t.alignment === 'CENTER' ? 'center' : t.alignment === 'RIGHT' ? 'right' : 'left',
      verticalText: false, letterSpacingDots: 0, lineSpacingDots: 1,
      src: '', imageFit: 'fit', brightness: 0, contrast: 0, invert: false,
      threshold: 128, ditherMode: 'threshold',
      codeValue: '', codeFormat: '',
      shapeType: 'rect', filled: false, strokeWidthDots: 2,
      tableRows: 0, tableCols: 0, tableCells: [],
      dateTimeFormat: '', seqStart: 0, seqStep: 0, seqPrefix: '', seqSuffix: '', seqDigits: 0,
    textEnhance: 'none',
      drawingPoints: [],
    });
  }

  for (const c of spec.codes) {
    const twoD = ['QR_CODE', 'GS1_QR', 'DATA_MATRIX', 'GS1_DATA_MATRIX', 'PDF_417', 'AZTEC'].includes(c.type);
    const min = twoD ? 42 : 24;
    const box = pixelBox(c.left, c.top, c.right, c.bottom, contentX, widthDots, heightDots, min, min);
    elements.push(codeToElement(box, c.type, c.content, paper));
  }

  for (const s of spec.shapes) {
    const kind = SHAPE_KIND_MAP[s.kind] ?? 'line';
    const horizontal = kind === 'line' || kind === 'dashedLine';
    const vertical = kind === 'verticalLine' || kind === 'dashedVerticalLine';
    const box = pixelBox(
      s.left, s.top, s.right, s.bottom, contentX, widthDots, heightDots,
      vertical ? 4 : 16, horizontal ? 4 : 16,
    );
    elements.push({
      id: uid(), kind: 'shape',
      x: box.left, y: box.top, width: box.width, height: box.height,
      rotation: 0, locked: false, groupId: '',
      text: '', fontFamily: 'sans-serif', fontSizeDots: 20, fontWeight: 400,
      italic: false, underline: false, align: 'left', verticalText: false,
      letterSpacingDots: 0, lineSpacingDots: 0,
      src: '', imageFit: 'fit', brightness: 0, contrast: 0, invert: false,
      threshold: 128, ditherMode: 'threshold',
      codeValue: '', codeFormat: '',
      shapeType: kind, filled: false,
      strokeWidthDots: clamp(s.strokeWidth * Math.min(widthDots, heightDots), 1, 10),
      tableRows: 0, tableCols: 0, tableCells: [],
      dateTimeFormat: '', seqStart: 0, seqStep: 0, seqPrefix: '', seqSuffix: '', seqDigits: 0,
    textEnhance: 'none',
      drawingPoints: [],
    });
  }

  const now = Date.now();
  return {
    id: uid(), title: spec.title, category: spec.category,
    paper, elements, createdAt: now, updatedAt: now,
  };
}

export const builtinTemplates: BuiltinTemplate[] = specs.map((spec) => ({
  id: spec.id,
  title: spec.title,
  category: spec.category,
  widthMm: spec.widthMm,
  heightMm: spec.heightMm,
  decorUrl: spec.decorResource ? `./templates/${spec.decorResource}.webp` : '',
  thumbUrl: TEMPLATE_THUMBS[spec.id] ?? (spec.decorResource ? `./templates/${spec.decorResource}.webp` : ''),
  document: createDocument(spec),
}));

export function builtinInCategory(category: string): BuiltinTemplate[] {
  return category === '全部' ? builtinTemplates : builtinTemplates.filter((t) => t.category === category);
}
