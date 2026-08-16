/**
 * 文档直印导入器：PDF / Word(.docx) / Excel(.xlsx) / PPT(.pptx) / TXT。
 * 统一产物：每页/每表一个可编辑的 LabelDocument，进入画布后可继续排版再打印。
 * 与安卓版一致：离线、限大小、页数有上限。
 */
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  contentWidthDots, LabelDocument, MAX_DOCUMENT_HEIGHT_DOTS, PaperMode,
  PaperSettings, printableStartX,
} from '../model/document';
import { blankDocument, createElement } from '../model/presets';
import { logInfo, logWarn } from '../logging/logger';
import { parseDocx } from './docxParser';
import { flowToCanvas } from './flowTypeset';
import { blobToDataUrl } from './docUtil';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_FILE_BYTES = 96 * 1024 * 1024;
const MAX_PAGES = 200;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const TEXT_FONT_DOTS = 24;
const TEXT_LINE_DOTS = 30;

export interface ImportResult {
  sourceName: string;
  documents: LabelDocument[];
}

export function acceptForFile(name: string): boolean {
  return /\.(pdf|docx|xlsx|xls|pptx|txt)$/i.test(name);
}

export async function importDocumentFile(file: File, paper: PaperSettings): Promise<ImportResult> {
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 96 MB 限制');
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  logInfo('docs', `导入文档：${file.name}（${(file.size / 1024).toFixed(0)} KB，.${ext}）`);
  let result: ImportResult;
  switch (ext) {
    case 'pdf': result = await importPdf(file, paper); break;
    case 'docx': result = await importDocx(file, paper); break;
    case 'xlsx': case 'xls': result = await importExcel(file, paper); break;
    case 'pptx': result = await importPptx(file, paper); break;
    case 'txt': result = await importText(file, paper); break;
    default: throw new Error(`不支持的格式 .${ext}（支持 PDF / Word docx / PPT pptx / Excel / TXT）`);
  }
  logInfo('docs', `导入完成：${result.documents.length} 页/个文档`);
  return result;
}

/* ------------------------------- 公共工具 ------------------------------- */

function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return (i > 0 ? name.slice(0, i) : name) || '导入文档';
}

/** 画布 → 图片元素文档（按内容宽度等比缩放；标签纸钳制高度） */
function canvasPageDocument(
  canvas: HTMLCanvasElement, sourceName: string, page: number, pages: number, paper: PaperSettings,
): LabelDocument {
  const contentWidth = contentWidthDots(paper);
  const naturalHeight = Math.max(64, Math.round((contentWidth * canvas.height) / Math.max(1, canvas.width)));
  let targetHeight = naturalHeight;
  if (paper.mode === ('label' as PaperMode)) {
    targetHeight = Math.min(naturalHeight, Math.max(64, Math.round((paper.labelHeightMm / 25.4) * 203)));
  } else {
    targetHeight = Math.min(naturalHeight, MAX_DOCUMENT_HEIGHT_DOTS - 16);
  }
  const doc = blankDocument(`${baseName(sourceName)} · ${page}/${pages}`, paper);
  doc.category = '办公管理';
  const el = createElement('image', paper);
  el.src = canvas.toDataURL('image/png');
  el.x = printableStartX(paper);
  el.y = 0;
  el.width = contentWidth;
  el.height = targetHeight;
  el.imageFit = 'fit';
  el.ditherMode = 'floyd';
  doc.elements = [el];
  return doc;
}

/** 超长画布按标签/连续纸高度切片分页 */
function sliceTallCanvas(canvas: HTMLCanvasElement, paper: PaperSettings): HTMLCanvasElement[] {
  const maxH = paper.mode === 'label'
    ? Math.max(64, Math.round((paper.labelHeightMm / 25.4) * 203))
    : MAX_DOCUMENT_HEIGHT_DOTS - 16;
  const contentWidth = contentWidthDots(paper);
  // 先缩放到内容宽度
  const scaled = document.createElement('canvas');
  const scale = contentWidth / canvas.width;
  scaled.width = contentWidth;
  scaled.height = Math.round(canvas.height * scale);
  scaled.getContext('2d')!.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  const pages: HTMLCanvasElement[] = [];
  for (let y = 0; y < scaled.height; y += maxH) {
    const h = Math.min(maxH, scaled.height - y);
    const page = document.createElement('canvas');
    page.width = contentWidth;
    page.height = h;
    page.getContext('2d')!.drawImage(scaled, 0, y, contentWidth, h, 0, 0, contentWidth, h);
    pages.push(page);
  }
  return pages.length ? pages : [scaled];
}

/* --------------------------------- PDF --------------------------------- */

async function importPdf(file: File, paper: PaperSettings): Promise<ImportResult> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  if (pdf.numPages < 1 || pdf.numPages > MAX_PAGES) throw new Error(`PDF 页数必须在 1–${MAX_PAGES} 页`);
  const documents: LabelDocument[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const contentWidth = contentWidthDots(paper);
    const viewport1 = page.getViewport({ scale: 1 });
    const scale = contentWidth / viewport1.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    documents.push(canvasPageDocument(canvas, file.name, i, pdf.numPages, paper));
  }
  return { sourceName: file.name, documents };
}

/* ------------------------------- Word docx ------------------------------ */

/**
 * Word 走自研解析排版管线（docxParser → flowTypeset），不依赖任何外部软件/服务：
 * 保留段落、标题、真实字号、上下标、有序/无序列表、表格（列宽比例/嵌套）、图片、
 * 分栏版式（sectPr/w:cols）、文本框（w:txbxContent）与常用公式（OMML 子集）。
 * 分栏栏带高度：标签纸 = 标签高（栏带与标签边界对齐），连续纸 = 内容宽 × 1.4。
 */
async function importDocx(file: File, paper: PaperSettings): Promise<ImportResult> {
  const flow = await parseDocx(await file.arrayBuffer());
  if (!flow.sections.length) throw new Error('Word 文档没有可打印内容');
  const contentWidth = contentWidthDots(paper);
  const bandHeight = paper.mode === 'label'
    ? Math.max(64, Math.round((paper.labelHeightMm / 25.4) * 203))
    : Math.round(contentWidth * 1.4);
  const canvas = await flowToCanvas(flow, contentWidth, bandHeight);
  const pages = sliceTallCanvas(canvas, paper).slice(0, MAX_PAGES);
  return {
    sourceName: file.name,
    documents: pages.map((c, i) => canvasPageDocument(c, file.name, i + 1, pages.length, paper)),
  };
}

/* ------------------------------- Excel ---------------------------------- */

async function importExcel(file: File, paper: PaperSettings): Promise<ImportResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const documents: LabelDocument[] = [];
  for (const sheetName of wb.SheetNames.slice(0, 3)) {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName], { header: 1, defval: '' }) as string[][];
    const trimmed = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (!trimmed.length) continue;
    const cols = Math.min(12, Math.max(...trimmed.map((r) => r.length)));
    const capped = trimmed.slice(0, 60);
    const doc = blankDocument(`${baseName(file.name)} · ${sheetName}`, paper);
    doc.category = '办公管理';
    const el = createElement('table', paper);
    el.x = printableStartX(paper);
    el.y = Math.round((paper.topPaddingMm / 25.4) * 203);
    el.width = contentWidthDots(paper);
    el.tableRows = capped.length;
    el.tableCols = cols;
    el.tableCells = capped.flatMap((r) => Array.from({ length: cols }, (_, c) => String(r[c] ?? '')));
    el.height = Math.min(MAX_DOCUMENT_HEIGHT_DOTS - 32, capped.length * 44);
    el.fontSizeDots = 20;
    doc.elements = [el];
    documents.push(doc);
  }
  if (!documents.length) throw new Error('Excel 没有可打印的表格内容');
  return { sourceName: file.name, documents };
}

/* -------------------------------- PPT pptx ------------------------------- */

async function importPptx(file: File, paper: PaperSettings): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .slice(0, MAX_PAGES);
  if (!slideNames.length) throw new Error('PPT 中没有幻灯片');
  const contentWidth = contentWidthDots(paper);
  const documents: LabelDocument[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.files[slideNames[i]].async('text');
    const texts = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => m[1]).filter((s) => s.trim());
    const doc = blankDocument(`${baseName(file.name)} · 幻灯片 ${i + 1}/${slideNames.length}`, paper);
    doc.category = '办公管理';
    let y = Math.round((paper.topPaddingMm / 25.4) * 203);
    let first = true;
    for (const text of texts.slice(0, 40)) {
      const el = createElement('text', paper);
      el.text = text;
      el.x = printableStartX(paper) + 8;
      el.y = y;
      el.width = contentWidth - 16;
      el.fontSizeDots = first ? 32 : 24;
      el.fontWeight = first ? 700 : 400;
      el.height = first ? 44 : 34;
      el.lineSpacingDots = 4;
      doc.elements.push(el);
      y += el.height + 6;
      first = false;
    }
    // 幻灯片内嵌图片
    const relName = slideNames[i].replace('slides/', 'slides/_rels/') + '.rels';
    const rels = zip.files[relName] ? await zip.files[relName].async('text') : '';
    const mediaTargets = Array.from(rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)).map((m) => `ppt/media/${m[1]}`);
    for (const media of mediaTargets.slice(0, 4)) {
      const entry = zip.files[media];
      if (!entry) continue;
      try {
        const blob = await entry.async('blob');
        const dataUrl = await blobToDataUrl(blob);
        const img = await loadImageSize(dataUrl);
        const el = createElement('image', paper);
        el.src = dataUrl;
        el.x = printableStartX(paper) + 8;
        el.y = y;
        el.width = contentWidth - 16;
        el.height = Math.min(600, Math.round((el.width * img.h) / Math.max(1, img.w)));
        doc.elements.push(el);
        y += el.height + 8;
      } catch (e) {
        logWarn('docs', `PPT 图片 ${media} 提取失败：${String(e)}`);
      }
    }
    documents.push(doc);
  }
  return { sourceName: file.name, documents };
}

/* --------------------------------- TXT ---------------------------------- */

async function importText(file: File, paper: PaperSettings): Promise<ImportResult> {
  if (file.size > MAX_TEXT_BYTES) throw new Error('文本超过 8 MB 限制');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = decodeText(bytes).replace(/\0/g, '').trim();
  if (!text) throw new Error('文本文件为空');
  const contentWidth = contentWidthDots(paper);
  const unitsPerLine = Math.max(4, Math.floor(contentWidth / (TEXT_FONT_DOTS * 0.5)));
  const lines = wrapText(text, unitsPerLine);
  const padding = Math.round(((paper.topPaddingMm + paper.bottomPaddingMm) / 25.4) * 203);
  const available = (paper.mode === 'label'
    ? Math.round((paper.labelHeightMm / 25.4) * 203)
    : MAX_DOCUMENT_HEIGHT_DOTS) - padding;
  const linesPerPage = Math.min(240, Math.max(1, Math.floor(available / TEXT_LINE_DOTS)));
  const chunks: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) chunks.push(lines.slice(i, i + linesPerPage));
  if (chunks.length > MAX_PAGES) throw new Error(`文本分页超过 ${MAX_PAGES} 页，请拆分文件`);
  return {
    sourceName: file.name,
    documents: chunks.map((pageLines, i) => {
      const doc = blankDocument(`${baseName(file.name)} · ${i + 1}/${chunks.length}`, paper);
      doc.category = '办公管理';
      const el = createElement('text', paper);
      el.text = pageLines.join('\n');
      el.x = printableStartX(paper);
      el.y = Math.round((paper.topPaddingMm / 25.4) * 203);
      el.width = contentWidth;
      el.height = Math.max(TEXT_LINE_DOTS, pageLines.length * TEXT_LINE_DOTS);
      el.fontSizeDots = TEXT_FONT_DOTS;
      el.lineSpacingDots = TEXT_LINE_DOTS - TEXT_FONT_DOTS;
      doc.elements = [el];
      return doc;
    }),
  };
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const bad = (utf8.match(/\uFFFD/g) ?? []).length;
  if (bad > utf8.length / 100) {
    try { return new TextDecoder('gb18030').decode(bytes); } catch { return utf8; }
  }
  return utf8;
}

/** 与安卓版一致：ASCII 计 1，其余计 2，超宽换行 */
function wrapText(text: string, maxUnits: number): string[] {
  const out: string[] = [];
  let line = '';
  let units = 0;
  const flush = () => { out.push(line.trimEnd()); line = ''; units = 0; };
  for (const ch of text) {
    if (ch === '\r') continue;
    if (ch === '\n') { flush(); continue; }
    const u = (ch.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
    if (units + u > maxUnits && line) flush();
    line += ch;
    units += u;
  }
  if (line || !out.length) flush();
  return out;
}

function loadImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}
