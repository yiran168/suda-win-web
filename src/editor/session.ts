/**
 * 编辑器会话：文档状态 + 选择 + 撤销/重做 + 变换。
 *
 * 相对安卓参考版的三处修复：
 *  1. rotateSelected() —— 新增多选旋转：整体绕组合视觉中心旋转（安卓版只有单元素旋转滑杆）。
 *  2. 所有包围盒计算改用 visualBounds()/elementCorners()（旋转感知），
 *     选中框、组合外框、吸附、边界钳制与渲染共用同一套几何 —— 框永远跟着内容走。
 *  3. 全选后拖动/缩放/旋转都基于同一 transform 快照，框随内容实时变化。
 */
import {
  AABB, LabelDocument, LabelElement, MAX_DOCUMENT_HEIGHT_DOTS,
  MIN_ELEMENT_DOTS, clamp, elementCenter, groupBounds, isTextLikeKind, mmToDots, normalizeDocument,
  printableEndX, printableStartX, uid, visualBounds,
} from '../model/document';
import { textContentHeightDots } from '../render/draw';

export interface ResizeEdges { left: boolean; top: boolean; right: boolean; bottom: boolean }
export const noEdges: ResizeEdges = { left: false, top: false, right: false, bottom: false };
export function edgesActive(e: ResizeEdges): boolean { return e.left || e.top || e.right || e.bottom; }

export type SelectionAlignment = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

interface ActiveTransform {
  ids: Set<string>;
  startDocument: LabelDocument;
}

type Listener = () => void;
const UNDO_LIMIT = 50;

export class EditorSession {
  private doc: LabelDocument;
  private selectedIds = new Set<string>();
  private anchorId: string | null = null;
  private undoStack: LabelDocument[] = [];
  private redoStack: LabelDocument[] = [];
  private transform: ActiveTransform | null = null;
  private listeners = new Set<Listener>();
  private cachedSnapshot: Snapshot | null = null;

  constructor(initial: LabelDocument) {
    this.doc = normalizeDocument(initial);
  }

  /* ------------------------------ 响应式 ------------------------------ */

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        document: this.doc,
        selectedIds: this.selectedIds,
        selectedElements: this.doc.elements.filter((e) => this.selectedIds.has(e.id)),
        anchor: this.doc.elements.find((e) => e.id === this.anchorId) ?? null,
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
        transforming: this.transform !== null,
      };
    }
    return this.cachedSnapshot;
  };

  private emit(): void {
    this.cachedSnapshot = null;
    this.listeners.forEach((fn) => fn());
  }

  /* ------------------------------ 选择 ------------------------------ */

  select(id: string | null): void {
    if (id !== this.anchorId) this.endTransform();
    this.anchorId = id;
    this.selectedIds = id ? this.groupSelection(id) : new Set();
    this.emit();
  }

  toggleSelection(id: string): void {
    this.endTransform();
    const toggled = this.groupSelection(id);
    const next = new Set(this.selectedIds);
    const allIn = [...toggled].every((t) => next.has(t));
    if (allIn) toggled.forEach((t) => next.delete(t)); else toggled.forEach((t) => next.add(t));
    this.selectedIds = next;
    this.anchorId = next.has(id) ? id : [...next].pop() ?? null;
    this.emit();
  }

  selectAll(): void {
    this.endTransform();
    this.selectedIds = new Set(this.doc.elements.map((e) => e.id));
    this.anchorId = this.doc.elements.at(-1)?.id ?? null;
    this.emit();
  }

  private groupSelection(id: string): Set<string> {
    const el = this.doc.elements.find((e) => e.id === id);
    if (!el) return new Set();
    if (!el.groupId) return new Set([id]);
    return new Set(this.doc.elements.filter((e) => e.groupId === el.groupId).map((e) => e.id));
  }

  /* ------------------------------ 增删 ------------------------------ */

  add(element: LabelElement): void {
    this.commit({ ...this.doc, elements: [...this.doc.elements, element] });
    this.anchorId = element.id;
    this.selectedIds = new Set([element.id]);
    this.emit();
  }

  addAll(elements: LabelElement[]): void {
    if (!elements.length) return;
    this.commit({ ...this.doc, elements: [...this.doc.elements, ...elements] });
    this.selectedIds = new Set(elements.map((e) => e.id));
    this.anchorId = elements.at(-1)!.id;
    this.emit();
  }

  update(element: LabelElement, recordUndo = true): void {
    // 文字类元素：字号/文本/间距/对齐变化后框高自动跟随内容重排结果，
    // 不再出现「字号改了框不变、文字被裁或大段留白」
    const next = isTextLikeKind(element.kind)
      ? { ...element, height: Math.max(MIN_ELEMENT_DOTS, textContentHeightDots(element)) }
      : element;
    this.commit({
      ...this.doc,
      elements: this.doc.elements.map((e) => (e.id === next.id ? next : e)),
    }, recordUndo);
  }

  deleteSelected(): void {
    if (!this.selectedIds.size) return;
    this.commit({ ...this.doc, elements: this.doc.elements.filter((e) => !this.selectedIds.has(e.id)) });
    this.selectedIds = new Set();
    this.anchorId = null;
    this.emit();
  }

  duplicateSelected(): void {
    const originals = this.doc.elements.filter((e) => this.selectedIds.has(e.id));
    if (!originals.length) return;
    const groupMap = new Map<string, string>();
    const copies = originals.map((el) => ({
      ...el,
      id: uid(),
      groupId: el.groupId ? (groupMap.get(el.groupId) ?? (() => { const g = uid(); groupMap.set(el.groupId, g); return g; })()) : '',
      x: el.x + 10,
      y: el.y + 10,
      locked: false,
    }));
    this.commit({ ...this.doc, elements: [...this.doc.elements, ...copies] });
    this.selectedIds = new Set(copies.map((c) => c.id));
    this.anchorId = copies.at(-1)!.id;
    this.emit();
  }

  groupSelected(): void {
    if (this.selectedIds.size < 2) return;
    const group = uid();
    this.commit({
      ...this.doc,
      elements: this.doc.elements.map((e) => (this.selectedIds.has(e.id) ? { ...e, groupId: group } : e)),
    });
  }

  ungroupSelected(): void {
    if (!this.selectedIds.size) return;
    this.commit({
      ...this.doc,
      elements: this.doc.elements.map((e) => (this.selectedIds.has(e.id) ? { ...e, groupId: '' } : e)),
    });
  }

  /* ------------------------------ 图层 ------------------------------ */

  bringForward(): void { this.reorder(1); }
  sendBackward(): void { this.reorder(-1); }

  private reorder(direction: 1 | -1): void {
    const ids = this.selectedIds;
    if (!ids.size) return;
    const list = [...this.doc.elements];
    if (direction > 0) {
      for (let i = list.length - 2; i >= 0; i--) {
        if (ids.has(list[i].id) && !ids.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      }
    } else {
      for (let i = 1; i < list.length; i++) {
        if (ids.has(list[i].id) && !ids.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
    }
    this.commit({ ...this.doc, elements: list });
  }

  /* ------------------------------ 变换 ------------------------------ */

  beginTransform(): void {
    const ids = new Set([...this.selectedIds].filter((id) => {
      const el = this.doc.elements.find((e) => e.id === id);
      return el && !el.locked;
    }));
    if (!ids.size) return;
    if (this.transform) return;
    this.transform = { ids, startDocument: this.doc };
    this.emit();
  }

  /** 整体移动 + 缩放（双指/手柄）：以组合视觉外框中心为基准 */
  transformSelected(deltaX: number, deltaY: number, zoom: number): void {
    if (!this.transform) this.beginTransform();
    const t = this.transform;
    if (!t) return;
    const current = this.doc.elements.filter((e) => t.ids.has(e.id));
    if (!current.length) return;
    const bounds = groupBounds(current);
    const contentStart = printableStartX(this.doc.paper);
    const contentEnd = printableEndX(this.doc.paper);
    const heightLimit = this.heightLimit();
    const bw = Math.max(1, bounds.right - bounds.left);
    const bh = Math.max(1, bounds.bottom - bounds.top);
    const maxScale = Math.min((contentEnd - contentStart) / bw, heightLimit / bh);
    const scale = clamp(zoom, 0.2, Math.max(0.2, maxScale));
    const centerX = (bounds.left + bounds.right) / 2 + deltaX;
    const centerY = (bounds.top + bounds.bottom) / 2 + deltaY;

    const moved = current.map((el) => {
      const vb = visualBounds(el);
      const ecx = (vb.left + vb.right) / 2;
      const ecy = (vb.top + vb.bottom) / 2;
      const ncx = centerX + (ecx - (bounds.left + bounds.right) / 2) * scale;
      const ncy = centerY + (ecy - (bounds.top + bounds.bottom) / 2) * scale;
      const width = Math.max(MIN_ELEMENT_DOTS, Math.round(el.width * scale));
      const height = Math.max(MIN_ELEMENT_DOTS, Math.round(el.height * scale));
      return { ...el, x: Math.round(ncx - width / 2), y: Math.round(ncy - height / 2), width, height };
    });
    this.applyBounded(t, moved);
  }

  /** 八向手柄缩放：保持对边固定，整组按比例改宽高 */
  resizeSelected(deltaX: number, deltaY: number, edges: ResizeEdges): void {
    if (!edgesActive(edges)) return;
    if (!this.transform) this.beginTransform();
    const t = this.transform;
    if (!t) return;
    const current = this.doc.elements.filter((e) => t.ids.has(e.id));
    if (!current.length) return;
    const old = groupBounds(current);
    const contentStart = printableStartX(this.doc.paper);
    const contentEnd = printableEndX(this.doc.paper);
    const heightLimit = this.heightLimit();

    const left = edges.left ? clamp(old.left + deltaX, contentStart, old.right - MIN_ELEMENT_DOTS) : old.left;
    const right = edges.right ? clamp(old.right + deltaX, old.left + MIN_ELEMENT_DOTS, contentEnd) : old.right;
    const top = edges.top ? clamp(old.top + deltaY, 0, old.bottom - MIN_ELEMENT_DOTS) : old.top;
    const bottom = edges.bottom ? clamp(old.bottom + deltaY, old.top + MIN_ELEMENT_DOTS, heightLimit) : old.bottom;

    const sx = (right - left) / Math.max(1, old.right - old.left);
    const sy = (bottom - top) / Math.max(1, old.bottom - old.top);
    // 文字类元素（普通文字/日期/流水号）：内容大小 = 字号，拖框必须同步改字号，
    // 否则框变了字不变（普通文字原本漏了这条联动，拉伸宽度后文字大小不跟手）
    const fontScale = (edges.top || edges.bottom) ? sy : sx;
    const resized = current.map((el) => {
      const next = {
        ...el,
        x: Math.round(left + (el.x - old.left) * sx),
        y: Math.round(top + (el.y - old.top) * sy),
        width: Math.max(MIN_ELEMENT_DOTS, Math.round(el.width * sx)),
        height: Math.max(MIN_ELEMENT_DOTS, Math.round(el.height * sy)),
      };
      if (isTextLikeKind(el.kind)) {
        next.fontSizeDots = clamp(Math.round(el.fontSizeDots * fontScale), 8, 240);
      }
      return next;
    });
    this.applyBounded(t, resized);
  }

  /** 单元素（可能旋转）手柄缩放：在元素本地坐标系内调整，对边在世界坐标中保持固定 */
  resizeSingleLocal(id: string, dlx: number, dly: number, edges: ResizeEdges): void {
    if (!edgesActive(edges)) return;
    if (!this.transform) this.beginTransform();
    const t = this.transform;
    if (!t) return;
    const el = this.doc.elements.find((e) => e.id === id);
    if (!el || el.locked) return;
    const r = (el.rotation * Math.PI) / 180;
    const hw = el.width / 2;
    const hh = el.height / 2;
    let nl = -hw; let nr = hw; let nt = -hh; let nb = hh;
    if (edges.left) nl = Math.min(nr - MIN_ELEMENT_DOTS, nl + dlx);
    if (edges.right) nr = Math.max(nl + MIN_ELEMENT_DOTS, nr + dlx);
    if (edges.top) nt = Math.min(nb - MIN_ELEMENT_DOTS, nt + dly);
    if (edges.bottom) nb = Math.max(nt + MIN_ELEMENT_DOTS, nb + dly);
    const width = nr - nl;
    const height = nb - nt;
    const lcx = (nl + nr) / 2;
    const lcy = (nt + nb) / 2;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const { cx, cy } = elementCenter(el);
    const wcx = cx + lcx * cos - lcy * sin;
    const wcy = cy + lcx * sin + lcy * cos;
    const next = {
      ...el,
      x: Math.round(wcx - width / 2),
      y: Math.round(wcy - height / 2),
      width: Math.round(width),
      height: Math.round(height),
    };
    // 文字类元素字号联动：垂直方向拖动用高度比，纯水平拖动用宽度比（与整组缩放同规则）
    if (isTextLikeKind(el.kind)) {
      const s = (edges.top || edges.bottom) ? height / el.height : width / el.width;
      next.fontSizeDots = clamp(Math.round(el.fontSizeDots * s), 8, 240);
    }
    this.applyBounded(t, [next]);
  }

  /**
   * 多选旋转：所有选中元素绕组合视觉中心整体旋转 deltaDeg 度（单元素时等价于自转）。
   * 旋转中心取【手势开始时】的包围盒中心并全程固定 —— 不再每帧重算，
   * 否则中心随元素转动漂移，全选旋转会越走越歪（无法无极旋转的根因）。
   */
  rotateSelected(deltaDeg: number): void {
    if (!this.selectedIds.size) return;
    if (!this.transform) this.beginTransform();
    const t = this.transform!;
    const current = this.doc.elements.filter((e) => t.ids.has(e.id));
    if (!current.length) return;
    const startEls = t.startDocument.elements.filter((e) => t.ids.has(e.id));
    const bounds = groupBounds(startEls.length ? startEls : current);
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    const rad = (deltaDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotated = current.map((el) => {
      const { cx: ecx, cy: ecy } = elementCenter(el);
      const dx = ecx - cx;
      const dy = ecy - cy;
      const ncx = cx + dx * cos - dy * sin;
      const ncy = cy + dx * sin + dy * cos;
      return {
        ...el,
        x: Math.round(ncx - el.width / 2),
        y: Math.round(ncy - el.height / 2),
        rotation: el.rotation + deltaDeg,
      };
    });
    this.applyBounded(t, rotated);
  }

  /** 设置绝对角度（属性面板滑杆用）：单选直接设，多选按差量整体转 */
  setRotationAbsolute(deg: number): void {
    const anchor = this.doc.elements.find((e) => e.id === this.anchorId);
    if (!anchor) return;
    this.rotateSelected(deg - anchor.rotation);
  }

  /** 变换落盘：边界钳制 + 应用（不记撤销，手势结束时统一记一次） */
  private applyBounded(t: ActiveTransform, next: LabelElement[]): void {
    const contentStart = printableStartX(this.doc.paper);
    const contentEnd = printableEndX(this.doc.paper);
    const heightLimit = this.heightLimit();
    const bounds = groupBounds(next);
    let shiftX = 0;
    let shiftY = 0;
    if (bounds.left < contentStart) shiftX = contentStart - bounds.left;
    else if (bounds.right > contentEnd) shiftX = contentEnd - bounds.right;
    if (bounds.top < 0) shiftY = -bounds.top;
    else if (bounds.bottom > heightLimit) shiftY = heightLimit - bounds.bottom;
    const byId = new Map(next.map((e) => [e.id, {
      ...e, x: Math.round(e.x + shiftX), y: Math.round(e.y + shiftY),
    }]));
    this.doc = {
      ...this.doc,
      elements: this.doc.elements.map((e) => byId.get(e.id) ?? e),
      updatedAt: Date.now(),
    };
    this.emit();
  }

  endTransform(): void {
    if (!this.transform) return;
    const t = this.transform;
    this.transform = null;
    if (t.startDocument !== this.doc) {
      this.pushUndo(t.startDocument);
      this.doc = normalizeDocument(this.doc);
    }
    this.emit();
  }

  /* ------------------------------ 对齐/分布 ------------------------------ */

  /**
   * 对齐：多选（含全选）时把【整组包围盒】对齐到纸面 —— 整组一起动，
   * 元素之间的相对位置保持不变。
   */
  alignSelected(alignment: SelectionAlignment): void {
    const items = this.doc.elements.filter((e) => this.selectedIds.has(e.id) && !e.locked);
    if (items.length < 2) return;
    const bounds = groupBounds(items);
    const start = printableStartX(this.doc.paper);
    const end = printableEndX(this.doc.paper);
    const limit = this.heightLimit();
    let dx = 0;
    let dy = 0;
    switch (alignment) {
      case 'left': dx = start - bounds.left; break;
      case 'right': dx = end - bounds.right; break;
      case 'hcenter': dx = (start + end) / 2 - (bounds.left + bounds.right) / 2; break;
      case 'top': dy = -bounds.top; break;
      case 'bottom': dy = limit - bounds.bottom; break;
      case 'vcenter': dy = limit / 2 - (bounds.top + bounds.bottom) / 2; break;
    }
    const updated = items.map((el) => ({ ...el, x: el.x + Math.round(dx), y: el.y + Math.round(dy) }));
    this.applyNow(updated);
  }

  distributeSelected(horizontal: boolean): void {
    const items = this.doc.elements.filter((e) => this.selectedIds.has(e.id) && !e.locked);
    if (items.length < 3) return;
    const sorted = [...items].sort((a, b) => (horizontal ? visualBounds(a).left - visualBounds(b).left : visualBounds(a).top - visualBounds(b).top));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const fb = visualBounds(first);
    const lb = visualBounds(last);
    const total = sorted.reduce((s, e) => {
      const vb = visualBounds(e);
      return s + (horizontal ? vb.right - vb.left : vb.bottom - vb.top);
    }, 0);
    const span = horizontal ? lb.right - fb.left : lb.bottom - fb.top;
    const gap = (span - total) / (sorted.length - 1);
    let cursor = horizontal ? fb.left : fb.top;
    const updated = sorted.map((el) => {
      const vb = visualBounds(el);
      const shift = cursor - (horizontal ? vb.left : vb.top);
      cursor += (horizontal ? vb.right - vb.left : vb.bottom - vb.top) + gap;
      return horizontal ? { ...el, x: el.x + Math.round(shift) } : { ...el, y: el.y + Math.round(shift) };
    });
    this.applyNow(updated);
  }

  private applyNow(updated: LabelElement[]): void {
    const byId = new Map(updated.map((e) => [e.id, e]));
    this.commit({ ...this.doc, elements: this.doc.elements.map((e) => byId.get(e.id) ?? e) });
  }

  /* ------------------------------ 文档操作 ------------------------------ */

  rename(title: string): void {
    this.commit({ ...this.doc, title: title.trim() || '未命名标签' });
  }

  setDocument(next: LabelDocument): void {
    this.commit(normalizeDocument(next));
  }

  undo(): void {
    this.endTransform();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.doc);
    this.doc = prev;
    this.sanitizeSelection();
    this.emit();
  }

  redo(): void {
    this.endTransform();
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.doc);
    this.doc = next;
    this.sanitizeSelection();
    this.emit();
  }

  private commit(next: LabelDocument, recordUndo = true): void {
    if (next === this.doc) return;
    if (recordUndo) {
      if (this.transform) this.endTransform();
      this.pushUndo(this.doc);
    }
    this.doc = normalizeDocument({ ...next, updatedAt: Date.now() });
    this.sanitizeSelection();
    this.emit();
  }

  private pushUndo(snapshot: LabelDocument): void {
    if (this.undoStack.at(-1) === snapshot) return;
    this.undoStack.push(snapshot);
    while (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private sanitizeSelection(): void {
    const valid = new Set(this.doc.elements.map((e) => e.id));
    this.selectedIds = new Set([...this.selectedIds].filter((id) => valid.has(id)));
    if (this.anchorId && !valid.has(this.anchorId)) this.anchorId = [...this.selectedIds].pop() ?? null;
  }

  private heightLimit(): number {
    return this.doc.paper.mode === 'label'
      ? Math.max(64, mmToDots(this.doc.paper.labelHeightMm))
      : MAX_DOCUMENT_HEIGHT_DOTS;
  }
}

export interface Snapshot {
  document: LabelDocument;
  selectedIds: Set<string>;
  selectedElements: LabelElement[];
  anchor: LabelElement | null;
  canUndo: boolean;
  canRedo: boolean;
  transforming: boolean;
}
