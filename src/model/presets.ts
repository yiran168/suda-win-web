/** 元素工厂与纸张预设。 */
import {
  ElementKind, LabelDocument, LabelElement, PaperSettings, defaultPaper,
  mmToDots, paperWidthDots, printableStartX, uid,
} from './document';

export const CONTINUOUS_PRESETS = [57, 50, 40, 30]; // mm
export const LABEL_PRESETS: Array<[number, number]> = [
  [30, 20], [40, 30], [50, 30], [50, 50], [57, 30],
];

export const FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '系统默认', value: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { label: '黑体', value: '"SimHei", "Microsoft YaHei", sans-serif' },
  { label: '等线', value: 'DengXian, "Microsoft YaHei", sans-serif' },
  { label: '宋体', value: 'SimSun, "Songti SC", serif' },
  { label: '新宋体', value: 'NSimSun, SimSun, serif' },
  { label: '楷体', value: 'KaiTi, "Kaiti SC", serif' },
  { label: '仿宋', value: 'FangSong, "FangSong_GB2312", serif' },
  { label: '隶书', value: 'LiSu, "STLiti", KaiTi, serif' },
  { label: '幼圆', value: 'YouYuan, "Microsoft YaHei", sans-serif' },
  { label: '思源黑体', value: '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif' },
  { label: '思源宋体', value: '"Source Han Serif SC", "Noto Serif CJK SC", SimSun, serif' },
  { label: '苹方', value: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { label: 'Arial', value: 'Arial, "Microsoft YaHei", sans-serif' },
  { label: 'Times', value: '"Times New Roman", SimSun, serif' },
  { label: '等宽', value: '"Cascadia Mono", Consolas, monospace' },
];

export interface BarcodeFormatInfo {
  /** 存入元素 codeFormat 的值 */
  value: string;
  /** 面板显示名 */
  label: string;
  engine: 'jsbarcode' | 'bwip';
  /** bwip-js 编码器 id */
  bcid?: string;
  /** 二维条码：不叠加供人识读文字 */
  twoD?: boolean;
}

/** 一维 + 二维条码格式（与安卓参考版的 BarcodeType 对齐） */
export const BARCODE_FORMATS: BarcodeFormatInfo[] = [
  { value: 'CODE128', label: 'Code 128', engine: 'jsbarcode' },
  { value: 'GS1_128', label: 'GS1-128', engine: 'bwip', bcid: 'gs1-128' },
  { value: 'CODE39', label: 'Code 39', engine: 'jsbarcode' },
  { value: 'CODE93', label: 'Code 93', engine: 'bwip', bcid: 'code93' },
  { value: 'codabar', label: 'Codabar', engine: 'jsbarcode' },
  { value: 'EAN13', label: 'EAN-13', engine: 'jsbarcode' },
  { value: 'ISBN', label: 'ISBN-13', engine: 'bwip', bcid: 'isbn' },
  { value: 'ISSN', label: 'ISSN-13', engine: 'bwip', bcid: 'issn' },
  { value: 'JAN13', label: 'JAN-13', engine: 'bwip', bcid: 'jan13' },
  { value: 'EAN8', label: 'EAN-8', engine: 'jsbarcode' },
  { value: 'UPC', label: 'UPC-A', engine: 'jsbarcode' },
  { value: 'UPCE', label: 'UPC-E', engine: 'bwip', bcid: 'upce' },
  { value: 'ITF', label: 'ITF 交叉25码', engine: 'bwip', bcid: 'interleaved2of5' },
  { value: 'ITF14', label: 'ITF-14', engine: 'jsbarcode' },
  { value: 'MSI', label: 'MSI', engine: 'jsbarcode' },
  { value: 'pharmacode', label: 'Pharmacode', engine: 'jsbarcode' },
  { value: 'DATAMATRIX', label: 'Data Matrix', engine: 'bwip', bcid: 'datamatrix', twoD: true },
  { value: 'GS1_DATAMATRIX', label: 'GS1 Data Matrix', engine: 'bwip', bcid: 'gs1datamatrix', twoD: true },
  { value: 'PDF417', label: 'PDF417', engine: 'bwip', bcid: 'pdf417', twoD: true },
  { value: 'AZTEC', label: 'Aztec', engine: 'bwip', bcid: 'azteccode', twoD: true },
];

export function barcodeFormatInfo(value: string): BarcodeFormatInfo | undefined {
  return BARCODE_FORMATS.find((f) => f.value === value);
}

function baseElement(kind: ElementKind, paper: PaperSettings): LabelElement {
  return {
    id: uid(), kind,
    x: printableStartX(paper) + 8, y: 8,
    width: 200, height: 56,
    rotation: 0, locked: false, groupId: '',
    text: '双击编辑文字', fontFamily: FONT_OPTIONS[0].value,
    fontSizeDots: 28, fontWeight: 400, italic: false, underline: false,
    align: 'left', verticalText: false, letterSpacingDots: 0, lineSpacingDots: 3,
    textEnhance: 'none',
    src: '', imageFit: 'fit', brightness: 0, contrast: 0, invert: false,
    threshold: 128, ditherMode: 'floyd',
    codeValue: '', codeFormat: 'CODE128',
    shapeType: 'rect', filled: false, strokeWidthDots: 4,
    tableRows: 2, tableCols: 2,
    tableCells: ['表头1', '表头2', '内容', '内容'],
    dateTimeFormat: 'YYYY-MM-DD HH:mm',
    seqStart: 1, seqStep: 1, seqPrefix: '', seqSuffix: '', seqDigits: 0,
    drawingPoints: [],
  };
}

export function blankDocument(title: string, paper?: PaperSettings): LabelDocument {
  const now = Date.now();
  return {
    id: uid(), title: title || '未命名标签', category: '自定义',
    paper: paper ?? defaultPaper(), elements: [], createdAt: now, updatedAt: now,
  };
}

export function createElement(kind: ElementKind, paper: PaperSettings): LabelElement {
  const el = baseElement(kind, paper);
  switch (kind) {
    case 'image':
      el.width = 160; el.height = 160; break;
    case 'qrcode':
      el.width = 120; el.height = 120; el.codeValue = 'https://example.com'; el.codeFormat = 'qrcode'; break;
    case 'barcode':
      el.width = 240; el.height = 80; el.codeValue = '123456789012'; break;
    case 'shape':
      el.width = 120; el.height = 80; break;
    case 'table':
      el.width = 300; el.height = 120; break;
    case 'datetime':
      el.width = 260; el.height = 40; el.text = ''; break;
    case 'sequence':
      el.width = 200; el.height = 40; el.text = ''; break;
    case 'drawing':
      el.width = 200; el.height = 120; break;
    default:
      el.width = 220; el.height = 48;
  }
  return el;
}

export function formatDateTime(format: string, date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return format
    .replace('YYYY', String(date.getFullYear()))
    .replace('MM', p(date.getMonth() + 1))
    .replace('DD', p(date.getDate()))
    .replace('HH', p(date.getHours()))
    .replace('mm', p(date.getMinutes()))
    .replace('ss', p(date.getSeconds()));
}

export function formatSequence(el: LabelElement, index = 0): string {
  const raw = String(el.seqStart + el.seqStep * index);
  const num = el.seqDigits > 0 ? raw.padStart(el.seqDigits, '0') : raw;
  return `${el.seqPrefix}${num}${el.seqSuffix}`;
}

/* ------------------------------ 便签纸（对齐安卓 NoteStyle） ------------------------------ */

export type NoteStyle = 'ruled' | 'grid' | 'checklist' | 'blank';

export const NOTE_STYLES: Array<{ value: NoteStyle; label: string }> = [
  { value: 'ruled', label: '横线' },
  { value: 'grid', label: '方格' },
  { value: 'checklist', label: '清单' },
  { value: 'blank', label: '空白' },
];

/** 生成便签纸文档：标题 + 横线/方格/清单/空白底纹。底纹高度跟随纸张：标签纸按标签长度，连续纸默认 65mm */
export function noteDocument(title: string, paper: PaperSettings, style: NoteStyle): LabelDocument {
  const doc = blankDocument(title || '便签', { ...paper, shape: 'rect' });
  const x = printableStartX(doc.paper) + 12;
  const width = Math.max(80, paperWidthDots(doc.paper) - 24);
  const height = paper.mode === 'label' ? mmToDots(paper.labelHeightMm) : mmToDots(65);
  const usableBottom = Math.max(88, height - 16);
  const header: LabelElement = {
    ...createElement('text', doc.paper),
    x, y: 12, width, height: 46, text: '随手记', fontSizeDots: 28, fontWeight: 700,
  };
  const elements: LabelElement[] = [header];
  if (style === 'blank') {
    elements.push({
      ...createElement('text', doc.paper),
      x, y: 70, width, height: usableBottom - 70,
      text: '点击这里开始记录……', fontSizeDots: 20, lineSpacingDots: 8,
    });
  } else if (style === 'ruled') {
    for (let y = 72; y < usableBottom; y += 40) {
      elements.push({
        ...createElement('shape', doc.paper),
        x, y, width, height: 16, shapeType: 'dashedLine', strokeWidthDots: 1,
      });
    }
  } else if (style === 'grid') {
    const grid = 38;
    for (let y = 70; y <= usableBottom; y += grid) {
      elements.push({
        ...createElement('shape', doc.paper),
        x, y, width, height: 16, shapeType: 'line', strokeWidthDots: 1,
      });
    }
    for (let cx = x; cx <= x + width; cx += grid) {
      elements.push({
        ...createElement('shape', doc.paper),
        x: cx, y: 70, width: usableBottom - 70, height: 16, rotation: 90,
        shapeType: 'line', strokeWidthDots: 1,
      });
    }
  } else {
    let i = 1;
    for (let y = 72; y + 32 < usableBottom; y += 42, i++) {
      elements.push({
        ...createElement('shape', doc.paper),
        x, y, width: 24, height: 24, shapeType: 'roundedRect', strokeWidthDots: 2,
      });
      elements.push({
        ...createElement('text', doc.paper),
        x: x + 36, y: y - 2, width: width - 36, height: 30,
        text: `待办事项 ${i}`, fontSizeDots: 19,
      });
    }
  }
  doc.elements = elements;
  return doc;
}

/* --------------------------- 偏移校准测试页（移植自安卓 PaperCalibration.kt） --------------------------- */

const formatMm = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const signedMm = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

/**
 * 校准测试页：外框 + 纸宽/装纸方向/当前偏移 + 毫米刻度尺。
 * 边框完整＝纸宽与装纸方向正确；刻度尺用于量出横向偏差再调「横向微调」。
 */
export function calibrationDocument(p: PaperSettings): LabelDocument {
  const paper: PaperSettings = {
    ...p, mode: 'label', shape: 'rect',
    labelHeightMm: 34, topPaddingMm: 0, bottomPaddingMm: 0, labelGapMm: 3,
  };
  const doc = blankDocument(`${formatMm(paper.widthMm)} mm 纸宽校准`, paper);
  doc.category = '校准';
  const start = printableStartX(paper);
  const width = paperWidthDots(paper);
  const height = mmToDots(34);
  const inset = Math.min(4, Math.max(1, Math.floor(width / 8)));
  const inside = Math.max(16, width - inset * 2);
  const anchorTitle = paper.anchor === 'left' ? '纸张靠左' : paper.anchor === 'right' ? '纸张靠右' : '纸张居中';
  const mk = (kind: ElementKind, ov: Partial<LabelElement>): LabelElement => ({ ...createElement(kind, paper), ...ov });
  const elements: LabelElement[] = [
    mk('shape', { x: start + inset, y: 4, width: inside, height: Math.max(16, height - 8), shapeType: 'rect', strokeWidthDots: 3 }),
    mk('text', {
      x: start + inset + 5, y: 18, width: inside - 10, height: 42,
      text: `纸宽校准  ${formatMm(paper.widthMm)} mm`,
      fontSizeDots: width < 120 ? 18 : 24, fontWeight: 700, align: 'center',
    }),
    mk('text', {
      x: start + inset + 5, y: 61, width: inside - 10, height: 34,
      text: `${anchorTitle}  偏移 ${signedMm(paper.offsetXMm)} mm`,
      fontSizeDots: width < 120 ? 14 : 19, align: 'center',
    }),
  ];
  // 毫米刻度尺：5mm 长刻度，1mm 短刻度
  const wholeMm = Math.max(1, Math.round(paper.widthMm));
  for (let m = 0; m <= wholeMm; m++) {
    const x = start + mmToDots(m);
    if (x >= start + width) break;
    const major = m % 5 === 0;
    elements.push(mk('shape', {
      x: Math.min(Math.max(x - 8, start), Math.max(start, start + width - 16)),
      y: major ? 110 : 122, width: 16, height: major ? 46 : 30,
      shapeType: 'verticalLine', strokeWidthDots: major ? 3 : 2,
    }));
  }
  elements.push(mk('shape', { x: start + inset + 5, y: 146, width: inside - 10, height: 16, shapeType: 'line', strokeWidthDots: 3 }));
  elements.push(mk('text', {
    x: start + inset + 5, y: 168, width: inside - 10, height: 54,
    text: '边框完整＝宽度与装纸方向正确\n裁边时每次调整 0.1 mm 后重打',
    fontSizeDots: width < 120 ? 13 : 17, align: 'center', lineSpacingDots: 2,
  }));
  doc.elements = elements;
  return doc;
}

/* --------------------------- 二维码内容预设（对齐安卓 16 项） --------------------------- */

export const QR_PRESETS: Array<{ label: string; value: string }> = [
  { label: '文本', value: '在这里输入内容' },
  { label: '网址', value: 'https://example.com' },
  { label: 'Wi-Fi', value: 'WIFI:T:WPA;S:网络名称;P:密码;;' },
  { label: '联系人', value: 'BEGIN:VCARD\nVERSION:3.0\nFN:联系人\nTEL:13800000000\nEND:VCARD' },
  { label: '电话', value: 'tel:13800000000' },
  { label: '短信', value: 'SMSTO:13800000000:短信内容' },
  { label: '邮件', value: 'MATMSG:TO:name@example.com;SUB:主题;BODY:正文;;' },
  { label: '定位', value: 'geo:39.9042,116.4074' },
  { label: '日历', value: 'BEGIN:VEVENT\nSUMMARY:事项名称\nDTSTART:20260812T090000\nDTEND:20260812T100000\nEND:VEVENT' },
  { label: '支付宝', value: 'https://qr.alipay.com/在这里粘贴收款链接' },
  { label: '微信链接', value: 'https://weixin.qq.com/在这里粘贴链接' },
  { label: '应用链接', value: 'https://example.com/app' },
  { label: '纯数字', value: '202608120001' },
  { label: 'GS1 商品', value: '(01)06901234567890(10)BATCH01(17)280812' },
  { label: '名片 MECARD', value: 'MECARD:N:张三;TEL:13800000000;EMAIL:name@example.com;;' },
  { label: '网络配置', value: 'WIFI:T:WPA2;S:网络名称;P:密码;H:false;;' },
];
