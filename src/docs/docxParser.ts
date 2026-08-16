/**
 * docx 自研解析层：OOXML → FlowDoc AST。
 * 为什么绕过 mammoth：它丢弃分栏（w:cols）、文本框（w:txbxContent）、公式（OMML），
 * 嵌套表格被拍平、真实字号/上下标/有序列表编号也丢失。本层保留这些版式信息：
 * - 节与分栏：sectPr/w:cols（含栏距），段落级 sectPr 正确分节
 * - 段落：标题（样式表 outlineLvl/名称识别）、对齐、左缩进、有序/无序列表（numbering.xml 编号模板）
 * - 字符：粗/斜/下划线/删除线、真实字号（w:sz 半磅→点）、上下标
 * - 图片：a:blip/VML 双通道 + wp:extent 真实尺寸（EMU→点），rels 解析
 * - 表格：递归（嵌套表格）、tblGrid 列宽比例、gridSpan、tblHeader 表头
 * - 文本框：w:txbxContent 就近提升为 box 块（含嵌套文本框）
 * - 公式：m:oMath/m:oMathPara → MathNode 子集
 * 全部用命名空间 URI 匹配，不依赖 w:/m: 前缀写法（兼容 WPS 等生成器）。
 */
import JSZip from 'jszip';
import {
  Block, CharStyle, DocSection, FlowDoc, Inline, MathNode, ParaStyle, TableCell,
  defaultCharStyle, defaultParaStyle,
} from './docxModel';
import { logWarn } from '../logging/logger';
import { blobToDataUrl } from './docUtil';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const V = 'urn:schemas-microsoft-com:vml';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const HALF_PT = 203 / 144;  // w:sz 半磅 → 光栅点
const TWIPS = 203 / 1440;   // 1/20 磅 → 光栅点
const EMU = 203 / 914400;   // EMU → 光栅点
const FONT_MIN = 14;
const FONT_MAX = 64;
const MAX_COLS = 4;         // 58mm 纸超过 4 栏没有可读性

function kids(el: Element | null, ns: string, local: string): Element[] {
  if (!el) return [];
  return Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === local);
}
function kid(el: Element | null, ns: string, local: string): Element | null {
  return kids(el, ns, local)[0] ?? null;
}
function attr(el: Element | null, ns: string, local: string): string | null {
  return el ? el.getAttributeNS(ns, local) : null;
}
function desc(el: Element, ns: string, local: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(ns, local));
}
/** el 的祖先链（到 stop 为止，不含 stop）里是否有 ns:local */
function hasAncestor(el: Element, ns: string, local: string, stop: Element): boolean {
  let p = el.parentElement;
  while (p && p !== stop) {
    if (p.namespaceURI === ns && p.localName === local) return true;
    p = p.parentElement;
  }
  return false;
}

/** w:sym 字符映射：Symbol/Wingdings 私用区（F000–F0FF）映射到常用 Unicode */
function symChar(code: number): string {
  if (!Number.isFinite(code) || code <= 0) return '';
  const PUA: Record<number, string> = {
    0xf0b7: '•', 0xf0a7: '▪', 0xf06e: '■', 0xf0fc: '✓', 0xf0d8: '▲', 0xf02d: '–',
  };
  if (code >= 0xf000 && code <= 0xf0ff) return PUA[code] ?? '•';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

interface StyleInfo { heading: number; bold: boolean; italic: boolean; size: number }
interface NumInfo { fmt: string; lvlText: string }

class Parser {
  private rels = new Map<string, string>();
  private styles = new Map<string, StyleInfo>();
  private numAbs = new Map<string, string>();  // numId → abstractNumId
  private absLvl = new Map<string, NumInfo>(); // `${absId}:${ilvl}` → 格式
  private counters = new Map<string, number>(); // numId → 当前有序编号
  private mediaCache = new Map<string, Promise<string | null>>();

  constructor(private zip: JSZip) {}

  async parse(): Promise<FlowDoc> {
    await this.parseRels();
    await this.parseStyles();
    await this.parseNumbering();
    const docXml = await this.zip.file('word/document.xml')?.async('text');
    if (!docXml) throw new Error('不是有效的 Word 文档（缺少 word/document.xml）');
    const root = new DOMParser().parseFromString(docXml, 'text/xml');
    if (root.getElementsByTagName('parsererror').length) throw new Error('Word XML 解析失败（文件可能损坏）');
    const body = root.getElementsByTagNameNS(W, 'body')[0];
    if (!body) throw new Error('Word 文档正文为空');

    // sectPr 语义：属性属于它「结束」的那一节——段落级 sectPr 结束当前节，body 级结束末节
    const sections: DocSection[] = [];
    let pending: Block[] = [];
    const flush = (sectPr: Element | null) => {
      const { cols, colGapDots } = sectPr ? this.sectionProps(sectPr) : { cols: 1, colGapDots: 0 };
      sections.push({ blocks: pending, cols, colGapDots });
      pending = [];
    };
    for (const child of Array.from(body.children)) {
      if (child.namespaceURI !== W) continue;
      if (child.localName === 'p') {
        pending.push(...await this.paragraph(child));
        const sect = kid(kid(child, W, 'pPr'), W, 'sectPr');
        if (sect) flush(sect);
      } else if (child.localName === 'tbl') {
        pending.push(await this.table(child));
      } else if (child.localName === 'sectPr') {
        flush(child);
      } else if (child.localName === 'sdt') {
        const content = kid(child, W, 'sdtContent'); // 内容控件：透明展开
        if (content) pending.push(...await this.blocksOf(content));
      }
    }
    if (pending.length || !sections.length) flush(null);
    return { sections: sections.filter((s) => s.blocks.length) };
  }

  /* ------------------------------ 资源（rels/styles/numbering） ------------------------------ */

  private async parseRels(): Promise<void> {
    try {
      const xml = await this.zip.file('word/_rels/document.xml.rels')?.async('text');
      if (!xml) return;
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      for (const rel of desc(doc.documentElement, PKG_REL, 'Relationship')) {
        const id = rel.getAttribute('Id');
        const target = rel.getAttribute('Target');
        if (id && target) this.rels.set(id, target);
      }
    } catch (e) { logWarn('docs', `关系表解析失败：${String(e)}`); }
  }

  private async parseStyles(): Promise<void> {
    try {
      const xml = await this.zip.file('word/styles.xml')?.async('text');
      if (!xml) return;
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      for (const stEl of desc(doc.documentElement, W, 'style')) {
        const id = attr(stEl, W, 'styleId');
        if (!id) continue;
        const name = attr(kid(stEl, W, 'name'), W, 'val') ?? '';
        let heading = 0;
        const hm = /heading\s*([1-6])/i.exec(name) ?? /标题\s*([1-6])/.exec(name);
        if (hm) heading = parseInt(hm[1], 10);
        const ol = attr(kid(kid(stEl, W, 'pPr'), W, 'outlineLvl'), W, 'val');
        if (ol != null) {
          const v = parseInt(ol, 10);
          if (Number.isFinite(v) && v >= 0 && v < 6) heading = v + 1;
        }
        const rPr = kid(stEl, W, 'rPr');
        let size = 0;
        const sz = attr(kid(rPr, W, 'sz'), W, 'val');
        if (sz) {
          const hp = parseInt(sz, 10);
          if (Number.isFinite(hp) && hp > 0) size = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(hp * HALF_PT)));
        }
        this.styles.set(id, { heading, bold: !!kid(rPr, W, 'b'), italic: !!kid(rPr, W, 'i'), size });
      }
    } catch (e) { logWarn('docs', `样式表解析失败：${String(e)}`); }
  }

  private async parseNumbering(): Promise<void> {
    try {
      const xml = await this.zip.file('word/numbering.xml')?.async('text');
      if (!xml) return;
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      for (const num of desc(doc.documentElement, W, 'num')) {
        const numId = attr(num, W, 'numId');
        const absId = attr(kid(num, W, 'abstractNumId'), W, 'val');
        if (numId && absId) this.numAbs.set(numId, absId);
      }
      for (const abs of desc(doc.documentElement, W, 'abstractNum')) {
        const absId = attr(abs, W, 'abstractNumId');
        if (!absId) continue;
        for (const lvl of kids(abs, W, 'lvl')) {
          const ilvl = attr(lvl, W, 'ilvl') ?? '0';
          const fmt = attr(kid(lvl, W, 'numFmt'), W, 'val') ?? 'bullet';
          const lvlText = attr(kid(lvl, W, 'lvlText'), W, 'val') ?? '%1.';
          this.absLvl.set(`${absId}:${ilvl}`, { fmt, lvlText });
        }
      }
    } catch (e) { logWarn('docs', `编号表解析失败：${String(e)}`); }
  }

  private numInfo(numId: string, ilvl: number): NumInfo | undefined {
    const abs = this.numAbs.get(numId);
    if (abs == null) return undefined;
    return this.absLvl.get(`${abs}:${ilvl}`) ?? this.absLvl.get(`${abs}:0`);
  }

  /* --------------------------------- 块级 --------------------------------- */

  private sectionProps(sectPr: Element): { cols: number; colGapDots: number } {
    const colsEl = kid(sectPr, W, 'cols');
    const num = parseInt(attr(colsEl, W, 'num') ?? '1', 10);
    const cols = Math.max(1, Math.min(MAX_COLS, Number.isFinite(num) && num > 0 ? num : 1));
    const space = parseInt(attr(colsEl, W, 'space') ?? '0', 10);
    return { cols, colGapDots: space > 0 ? Math.round(space * TWIPS) : 0 };
  }

  private async blocksOf(container: Element): Promise<Block[]> {
    const out: Block[] = [];
    for (const child of Array.from(container.children)) {
      if (child.namespaceURI !== W) continue;
      if (child.localName === 'p') out.push(...await this.paragraph(child));
      else if (child.localName === 'tbl') out.push(await this.table(child));
      else if (child.localName === 'sdt') {
        const c = kid(child, W, 'sdtContent');
        if (c) out.push(...await this.blocksOf(c));
      }
    }
    return out;
  }

  private async paragraph(p: Element): Promise<Block[]> {
    const pPr = kid(p, W, 'pPr');
    const styleId = attr(kid(pPr, W, 'pStyle'), W, 'val');
    const style = this.paraStyle(pPr, styleId);
    const content: Inline[] = [];
    for (const node of Array.from(p.childNodes)) await this.inlineContainer(node, content, styleId);
    const out: Block[] = [{ t: 'para', style, content }];
    // 文本框就近放置：本段落内的 txbxContent 提升为紧随其后的 box 块（只取最外层，嵌套框由内层段落再提升）
    for (const tb of this.textBoxes(p)) {
      const inner = await this.blocksOf(tb);
      if (inner.length) out.push({ t: 'box', blocks: inner });
    }
    return out;
  }

  private textBoxes(scope: Element): Element[] {
    return desc(scope, W, 'txbxContent').filter((tb) => !hasAncestor(tb, W, 'txbxContent', scope));
  }

  private paraStyle(pPr: Element | null, styleId: string | null): ParaStyle {
    const st = defaultParaStyle();
    const si = styleId ? this.styles.get(styleId) : undefined;
    if (si?.heading) st.heading = si.heading;
    const ol = attr(kid(pPr, W, 'outlineLvl'), W, 'val');
    if (ol != null) {
      const v = parseInt(ol, 10);
      if (Number.isFinite(v) && v >= 0 && v < 9) st.heading = Math.min(6, v + 1);
    }
    const jc = attr(kid(pPr, W, 'jc'), W, 'val');
    st.align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left';
    const indLeft = parseInt(attr(kid(pPr, W, 'ind'), W, 'left') ?? '', 10);
    if (Number.isFinite(indLeft) && indLeft > 0) st.indentDots = Math.round(indLeft * TWIPS);
    const numPr = kid(pPr, W, 'numPr');
    if (numPr) {
      const numId = attr(kid(numPr, W, 'numId'), W, 'val') ?? '0';
      const ilvl = parseInt(attr(kid(numPr, W, 'ilvl'), W, 'val') ?? '0', 10) || 0;
      st.indentLevel = Math.max(0, Math.min(8, ilvl));
      const info = this.numInfo(numId, ilvl);
      if (info && info.fmt !== 'bullet') {
        const n = (this.counters.get(numId) ?? 0) + 1;
        this.counters.set(numId, n);
        st.list = n;
        st.listText = info.lvlText;
      } else {
        st.list = -1; // 无编号表信息时按无序列表降级
      }
    }
    return st;
  }

  private async table(tbl: Element): Promise<Block> {
    const grid = kid(tbl, W, 'tblGrid');
    const ws = grid ? kids(grid, W, 'gridCol').map((gc) => parseInt(attr(gc, W, 'w') ?? '0', 10) || 0) : [];
    const weights = ws.length && ws.every((w) => w > 0) ? ws : undefined;
    const rows: TableCell[][] = [];
    for (const tr of kids(tbl, W, 'tr')) {
      const head = !!kid(kid(tr, W, 'trPr'), W, 'tblHeader');
      const cells: TableCell[] = [];
      for (const tc of kids(tr, W, 'tc')) {
        const span = parseInt(attr(kid(kid(tc, W, 'tcPr'), W, 'gridSpan'), W, 'val') ?? '1', 10) || 1;
        const blocks = await this.blocksOf(tc);
        cells.push({
          blocks: blocks.length ? blocks : [{ t: 'para', style: defaultParaStyle(), content: [] }],
          head,
          span: Math.max(1, Math.min(8, span)),
        });
      }
      if (cells.length) rows.push(cells);
    }
    return { t: 'table', rows, weights };
  }

  /* --------------------------------- 行内 --------------------------------- */

  private async inlineContainer(node: Node, content: Inline[], styleId: string | null): Promise<void> {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.namespaceURI === M && (el.localName === 'oMath' || el.localName === 'oMathPara')) {
      const root = this.mathTop(el);
      if (root.length) content.push({ t: 'math', root });
      return;
    }
    if (el.namespaceURI === W) {
      switch (el.localName) {
        case 'r': await this.run(el, content, styleId); return;
        case 'txbxContent': return; // 文本框由段落级 textBoxes() 提升为 box 块，这里跳过防重复
        case 'pPr': case 'bookmarkStart': case 'bookmarkEnd': case 'proofErr': return;
        default: break; // hyperlink / smartTag / ins / sdt / fldSimple / AlternateContent… 透明下探
      }
    }
    for (const child of Array.from(el.childNodes)) await this.inlineContainer(child, content, styleId);
  }

  private charStyle(rPr: Element | null, styleId: string | null): CharStyle {
    const cs = defaultCharStyle();
    const si = styleId ? this.styles.get(styleId) : undefined;
    if (si) { cs.bold = si.bold; cs.italic = si.italic; cs.size = si.size; }
    if (!rPr) return cs;
    const on = (el: Element | null) => !!el && attr(el, W, 'val') !== '0' && attr(el, W, 'val') !== 'false';
    if (kid(rPr, W, 'b')) cs.bold = on(kid(rPr, W, 'b'));
    if (kid(rPr, W, 'i')) cs.italic = on(kid(rPr, W, 'i'));
    if (kid(rPr, W, 'strike')) cs.strike = on(kid(rPr, W, 'strike'));
    if (kid(rPr, W, 'u')) cs.underline = (attr(kid(rPr, W, 'u'), W, 'val') ?? 'single') !== 'none';
    const sz = parseInt(attr(kid(rPr, W, 'sz'), W, 'val') ?? '', 10);
    if (Number.isFinite(sz) && sz > 0) {
      cs.size = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(sz * HALF_PT)));
    }
    const va = attr(kid(rPr, W, 'vertAlign'), W, 'val');
    if (va === 'superscript' || va === 'subscript') cs.vertAlign = va;
    return cs;
  }

  private async run(r: Element, content: Inline[], styleId: string | null): Promise<void> {
    const cs = this.charStyle(kid(r, W, 'rPr'), styleId);
    for (const node of Array.from(r.childNodes)) {
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.namespaceURI === W) {
        switch (el.localName) {
          case 't': content.push({ t: 'text', text: el.textContent ?? '', style: cs }); break;
          case 'br': case 'cr': content.push({ t: 'br' }); break;
          case 'tab': content.push({ t: 'text', text: '    ', style: cs }); break;
          case 'noBreakHyphen': content.push({ t: 'text', text: '-', style: cs }); break;
          case 'sym': {
            const ch = symChar(parseInt(attr(el, W, 'char') ?? '', 16));
            if (ch) content.push({ t: 'text', text: ch, style: cs });
            break;
          }
          case 'drawing': case 'pict': case 'object':
            await this.drawing(el, content);
            break;
          default: break; // rPr 等属性节点忽略
        }
      } else if (el.namespaceURI === M) {
        const root = this.mathTop(el);
        if (root.length) content.push({ t: 'math', root });
      } else {
        // mc:AlternateContent 等外部命名空间容器：下探找 drawing（文本框内的图片由 box 块自行处理）
        for (const d of desc(el, W, 'drawing').filter((x) => !hasAncestor(x, W, 'txbxContent', el))) {
          await this.drawing(d, content);
        }
      }
    }
  }

  private async drawing(el: Element, content: Inline[]): Promise<void> {
    const blips = desc(el, A, 'blip').filter((b) => !hasAncestor(b, W, 'txbxContent', el));
    const rid = attr(blips[0] ?? null, R, 'embed') ?? attr(blips[0] ?? null, R, 'link');
    const vim = desc(el, V, 'imagedata')[0]; // VML 旧式图片
    const vRid = attr(vim ?? null, R, 'id');
    const target = (rid && this.rels.get(rid)) || (vRid && this.rels.get(vRid));
    if (!target) return;
    const dataUrl = await this.image(target);
    if (!dataUrl) return;
    const extent = desc(el, WP, 'extent').filter((e) => !hasAncestor(e, W, 'txbxContent', el))[0];
    let wDots = Math.round(parseInt(extent?.getAttribute('cx') ?? '0', 10) * EMU);
    let hDots = Math.round(parseInt(extent?.getAttribute('cy') ?? '0', 10) * EMU);
    if (wDots < 8 || hDots < 8) { wDots = 240; hDots = 180; } // 尺寸缺失占位，排版器按可用宽等比
    content.push({ t: 'img', dataUrl, wDots, hDots });
  }

  private image(target: string): Promise<string | null> {
    const norm = target.replace(/^\//, '');
    const path = norm.startsWith('word/') ? norm : `word/${norm}`;
    if (!this.mediaCache.has(path)) {
      this.mediaCache.set(path, (async () => {
        try {
          const entry = this.zip.file(path);
          if (!entry) return null;
          return await blobToDataUrl(await entry.async('blob'));
        } catch (e) {
          logWarn('docs', `图片 ${path} 提取失败：${String(e)}`);
          return null;
        }
      })());
    }
    return this.mediaCache.get(path)!;
  }

  /* --------------------------------- 公式 --------------------------------- */

  private mathTop(el: Element): MathNode[] {
    if (el.localName === 'oMathPara') {
      return kids(el, M, 'oMath').flatMap((m) => this.mathChildren(m));
    }
    return this.mathChildren(el);
  }

  private mathChildren(container: Element): MathNode[] {
    return Array.from(container.children)
      .filter((c) => c.namespaceURI === M)
      .flatMap((c) => this.mathNode(c));
  }

  private mathNode(el: Element): MathNode[] {
    const sub = (local: string): MathNode[] => {
      const c = kid(el, M, local);
      return c ? this.mathChildren(c) : [];
    };
    switch (el.localName) {
      case 'r': {
        const text = desc(el, M, 't').map((t) => t.textContent ?? '').join('');
        return text ? [{ t: 'run', text }] : [];
      }
      case 'f': return [{ t: 'frac', num: sub('num'), den: sub('den') }];
      case 'sSup': return [{ t: 'sup', base: sub('e'), sup: sub('sup') }];
      case 'sSub': return [{ t: 'sub', base: sub('e'), sub: sub('sub') }];
      case 'sSubSup': return [{ t: 'subsup', base: sub('e'), sub: sub('sub'), sup: sub('sup') }];
      case 'rad': {
        const degEl = kid(el, M, 'deg');
        return [{ t: 'rad', deg: degEl ? this.mathChildren(degEl) : null, body: sub('e') }];
      }
      case 'd': {
        const dPr = kid(el, M, 'dPr');
        return [{
          t: 'delim',
          beg: attr(kid(dPr, M, 'begChr'), M, 'val') ?? '(',
          end: attr(kid(dPr, M, 'endChr'), M, 'val') ?? ')',
          body: sub('e'),
        }];
      }
      case 'nary': {
        const pr = kid(el, M, 'naryPr');
        return [{
          t: 'nary',
          chr: attr(kid(pr, M, 'chr'), M, 'val') ?? '∑',
          sub: kid(pr, M, 'subHide') ? null : (kid(el, M, 'sub') ? sub('sub') : null),
          sup: kid(pr, M, 'supHide') ? null : (kid(el, M, 'sup') ? sub('sup') : null),
          body: sub('e'),
        }];
      }
      case 'bar': return [{ t: 'bar', body: sub('e') }];
      case 'm': return [{
        t: 'matrix',
        rows: kids(el, M, 'mr').map((mr) => kids(mr, M, 'e').map((e) => this.mathChildren(e))),
      }];
      case 'eqArr': return [{ t: 'matrix', rows: kids(el, M, 'e').map((e) => [this.mathChildren(e)]) }];
      case 'func': {
        const fName = kid(el, M, 'fName');
        return [...(fName ? this.mathChildren(fName) : []), ...sub('e')];
      }
      case 'limLow': return [{ t: 'sub', base: sub('e'), sub: sub('lim') }];
      case 'limUpper': return [{ t: 'sup', base: sub('e'), sup: sub('lim') }];
      case 'groupChr': return sub('e');
      default: return this.mathChildren(el); // 未知容器透明下探，内容不丢
    }
  }
}

/** docx 文件 → FlowDoc AST（交给 flowTypeset 排版成画布） */
export async function parseDocx(buf: ArrayBuffer): Promise<FlowDoc> {
  const zip = await JSZip.loadAsync(buf);
  return new Parser(zip).parse();
}
