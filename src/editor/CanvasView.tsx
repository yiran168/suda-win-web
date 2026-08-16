/**
 * 可交互画布：
 * - 渲染 = 打印位图：直接渲染 renderPrintBits 的 0/1 黑白点阵（热敏机只有黑/白），
 *   CSS 放大用 pixelated 不插值 —— 屏幕上看到的就是打印出来的每一个点
 * - 选中覆盖层全部走旋转几何：单元素框沿旋转四角画虚线，【八向手柄与旋转手柄也随
 *   元素一起旋转】，始终贴在框的四条边上；组合框取旋转视觉外接框
 * - 手势：点选 / Ctrl+点击多选 / 拖动整体移动（带磁吸）/ 八向手柄缩放（旋转元素
 *   在本地坐标系内缩放）/ 顶部旋转手柄（全选也能转，无极连续）
 * - 连续纸：白纸视觉高度自动填满视口，打印长度仍按内容自动计算
 * - 双击文字类元素行内编辑
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LabelElement, PaperShape, elementCorners, fixedHeightDots, groupBounds,
  hitTestElement, offsetXDots, offsetYDots, printableStartX, paperWidthDots, visualBounds,
} from '../model/document';
import { documentHeightDots, renderPrintBits } from '../render/rasterize';
import { sharedImageCache } from '../render/imageCache';
import { EditorSession, ResizeEdges, noEdges } from './session';
import { AxisSnap } from './snap';
import { useSyncExternalStore } from 'react';

interface Props {
  session: EditorSession;
  /** 画布可视宽度（px） */
  viewportWidth: number;
  /** 画布可视高度（px）：连续纸时白纸至少填满这么高 */
  minViewportPx?: number;
  /** 视图缩放倍率（等比例，1 = 纸宽铺满可视区；只影响屏幕显示，不影响打印点阵） */
  zoom?: number;
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'move'; startX: number; startY: number }
  | { kind: 'resize'; edges: ResizeEdges; startX: number; startY: number }
  | { kind: 'rotate'; centerX: number; centerY: number; startAngle: number };

const HANDLE_HIT_PX = 12;

interface HandlePoint { x: number; y: number; edges: ResizeEdges }
interface HandleLayout { rotate: { x: number; y: number }; points: HandlePoint[] }

export function CanvasView({ session, viewportWidth, minViewportPx = 0, zoom = 1 }: Props) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const doc = snap.document;
  const [frame, setFrame] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode>({ kind: 'none' });
  const downInfoRef = useRef<{ x: number; y: number; id: string | null; moved: boolean } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const snapXRef = useRef(new AxisSnap());
  const snapYRef = useRef(new AxisSnap());
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  useEffect(() => sharedImageCache.subscribe(() => setFrame((f) => f + 1)), []);

  const scale = (viewportWidth / paperWidthDots(doc.paper)) * zoom;
  const docHeight = documentHeightDots(doc);
  const contentW = paperWidthDots(doc.paper);
  const paperRadius = doc.paper.shape === 'oval' ? '50%' : doc.paper.shape === 'rounded' ? 18 : 4;
  // 连续纸：视觉高度至少填满视口（打印长度不受影响，仍按内容自动算）
  const visDotsH = Math.max(64, docHeight, doc.paper.mode === 'continuous' ? Math.ceil(minViewportPx / scale) : 0);

  /* 打印同源渲染：屏幕像素 = 打印点阵（黑/白，无灰度无彩色） */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = contentW;
    canvas.height = visDotsH;
    const { bits, width: bw, height: bh } = renderPrintBits(doc, sharedImageCache, 0);
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(contentW, visDotsH);
    const data = img.data;
    data.fill(255); // 先铺不透明的白底（createImageData 初始为全 0 = 黑色，必须 RGBA 全填）
    const startX = printableStartX(doc.paper);
    const rows = Math.min(visDotsH, bh);
    for (let y = 0; y < rows; y++) {
      const rowBits = y * bw;
      const rowImg = y * contentW;
      for (let x = 0; x < contentW; x++) {
        const sx = x + startX;
        if (sx < 0 || sx >= bw) continue;
        if (bits[rowBits + sx]) {
          const i = (rowImg + x) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [doc, contentW, docHeight, visDotsH, snap, frame]);

  const toDoc = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scale + printableStartX(doc.paper) - offsetXDots(doc.paper),
      y: (clientY - rect.top) / scale - offsetYDots(doc.paper),
    };
  };

  const hitTest = (x: number, y: number): LabelElement | null => {
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const el = doc.elements[i];
      if (hitTestElement(el, x, y)) return el;
    }
    return null;
  };

  /** 组合外框（屏幕像素坐标，AABB） */
  const groupBox = useMemo(() => {
    if (!snap.selectedElements.length) return null;
    const b = groupBounds(snap.selectedElements);
    return {
      left: (b.left - printableStartX(doc.paper) + offsetXDots(doc.paper)) * scale,
      top: (b.top + offsetYDots(doc.paper)) * scale,
      right: (b.right - printableStartX(doc.paper) + offsetXDots(doc.paper)) * scale,
      bottom: (b.bottom + offsetYDots(doc.paper)) * scale,
    };
  }, [snap.selectedElements, doc.paper, scale]);

  /**
   * 手柄布局：
   * - 单选（无论是否旋转）：八个手柄钉在元素旋转后的四角 + 四边中点，
   *   旋转手柄在顶边中点沿旋转法线外 26px —— 永远在框上
   * - 多选：退化为组合 AABB 的八向手柄
   */
  const handleLayout = useMemo<HandleLayout | null>(() => {
    const toPx = (x: number, y: number) => ({
      x: (x - printableStartX(doc.paper) + offsetXDots(doc.paper)) * scale,
      y: (y + offsetYDots(doc.paper)) * scale,
    });
    const single = snap.selectedElements.length === 1 ? snap.selectedElements[0] : null;
    if (single) {
      const cs = elementCorners(single).map((c) => toPx(c.x, c.y));
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const m01 = mid(cs[0], cs[1]);
      const m12 = mid(cs[1], cs[2]);
      const m23 = mid(cs[2], cs[3]);
      const m30 = mid(cs[3], cs[0]);
      const cx = (cs[0].x + cs[2].x) / 2;
      const cy = (cs[0].y + cs[2].y) / 2;
      const upLen = Math.max(1, Math.hypot(m01.x - cx, m01.y - cy));
      const up = { x: (m01.x - cx) / upLen, y: (m01.y - cy) / upLen };
      const E = (l: boolean, t: boolean, r: boolean, b: boolean): ResizeEdges => ({ left: l, top: t, right: r, bottom: b });
      return {
        rotate: { x: m01.x + up.x * 26, y: m01.y + up.y * 26 },
        points: [
          { ...cs[0], edges: E(true, true, false, false) },
          { ...m01, edges: E(false, true, false, false) },
          { ...cs[1], edges: E(false, true, true, false) },
          { ...m12, edges: E(false, false, true, false) },
          { ...cs[2], edges: E(false, false, true, true) },
          { ...m23, edges: E(false, false, false, true) },
          { ...cs[3], edges: E(true, false, false, true) },
          { ...m30, edges: E(true, false, false, false) },
        ],
      };
    }
    if (groupBox) {
      const { left, top, right, bottom } = groupBox;
      const mx = (left + right) / 2;
      const my = (top + bottom) / 2;
      const E = (l: boolean, t: boolean, r: boolean, b: boolean): ResizeEdges => ({ left: l, top: t, right: r, bottom: b });
      return {
        rotate: { x: mx, y: top - 26 },
        points: [
          { x: left, y: top, edges: E(true, true, false, false) },
          { x: mx, y: top, edges: E(false, true, false, false) },
          { x: right, y: top, edges: E(false, true, true, false) },
          { x: right, y: my, edges: E(false, false, true, false) },
          { x: right, y: bottom, edges: E(false, false, true, true) },
          { x: mx, y: bottom, edges: E(false, false, false, true) },
          { x: left, y: bottom, edges: E(true, false, false, true) },
          { x: left, y: my, edges: E(true, false, false, false) },
        ],
      };
    }
    return null;
  }, [snap.selectedElements, groupBox, doc.paper, scale]);

  const handleAt = (px: number, py: number): ResizeEdges | 'rotate' | null => {
    if (!handleLayout) return null;
    const r = handleLayout.rotate;
    if (Math.hypot(px - r.x, py - r.y) <= HANDLE_HIT_PX) return 'rotate';
    for (const p of handleLayout.points) {
      if (Math.hypot(px - p.x, py - p.y) <= HANDLE_HIT_PX) return p.edges;
    }
    return null;
  };

  const onPointerDown = (ev: React.PointerEvent) => {
    if (editing) return;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const p = toDoc(ev.clientX, ev.clientY);

    // 1. 手柄优先
    const handle = handleAt(px, py);
    if (handle === 'rotate' && groupBox) {
      const cx = (groupBox.left + groupBox.right) / 2;
      const cy = (groupBox.top + groupBox.bottom) / 2;
      session.beginTransform();
      dragRef.current = { kind: 'rotate', centerX: cx, centerY: cy, startAngle: Math.atan2(py - cy, px - cx) };
      return;
    }
    if (handle && handle !== 'rotate') {
      session.beginTransform();
      dragRef.current = { kind: 'resize', edges: handle, startX: px, startY: py };
      return;
    }
    // 2. 元素命中（旋转感知）
    const hit = hitTest(p.x, p.y);
    downInfoRef.current = { x: px, y: py, id: hit?.id ?? null, moved: false };
    if (hit) {
      if (ev.ctrlKey || ev.metaKey) {
        session.toggleSelection(hit.id);
      } else if (!snap.selectedIds.has(hit.id)) {
        session.select(hit.id);
      }
      if (!hit.locked) {
        session.beginTransform();
        dragRef.current = { kind: 'move', startX: px, startY: py };
      }
    } else {
      session.select(null);
    }
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const drag = dragRef.current;
    if (drag.kind === 'none') return;
    if (downInfoRef.current) downInfoRef.current.moved = true;

    if (drag.kind === 'move') {
      const dx = (px - drag.startX) / scale;
      const dy = (py - drag.startY) / scale;
      // 磁吸：纸边 / 纸中心 / 其他元素的边与中线（带滞后，轻拖可精确停靠）
      const sel = snap.selectedElements;
      let corrX = 0;
      let corrY = 0;
      let guideX: number | null = null;
      let guideY: number | null = null;
      if (sel.length) {
        const b = groupBounds(sel);
        const startX = printableStartX(doc.paper);
        const xTargets = [startX, startX + contentW / 2, startX + contentW];
        const yTargets: number[] = [0];
        if (doc.paper.mode === 'label') {
          yTargets.push(fixedHeightDots(doc.paper) / 2, fixedHeightDots(doc.paper));
        }
        for (const o of doc.elements) {
          if (snap.selectedIds.has(o.id)) continue;
          const ob = visualBounds(o);
          xTargets.push(ob.left, (ob.left + ob.right) / 2, ob.right);
          yTargets.push(ob.top, (ob.top + ob.bottom) / 2, ob.bottom);
        }
        const rx = snapXRef.current.apply(
          [b.left + dx, (b.left + b.right) / 2 + dx, b.right + dx], xTargets, dx);
        const ry = snapYRef.current.apply(
          [b.top + dy, (b.top + b.bottom) / 2 + dy, b.bottom + dy], yTargets, dy);
        corrX = rx.correction; corrY = ry.correction;
        guideX = rx.guide; guideY = ry.guide;
      }
      session.transformSelected(dx + corrX, dy + corrY, 1);
      setGuides({ x: guideX, y: guideY });
      dragRef.current = { ...drag, startX: px, startY: py };
    } else if (drag.kind === 'resize') {
      const single = snap.selectedElements.length === 1 ? snap.selectedElements[0] : null;
      if (single) {
        // 旋转元素：把屏幕位移换算进元素本地坐标系，缩放沿元素自身宽/高方向
        const r = (single.rotation * Math.PI) / 180;
        const dx = (px - drag.startX) / scale;
        const dy = (py - drag.startY) / scale;
        const dlx = dx * Math.cos(r) + dy * Math.sin(r);
        const dly = -dx * Math.sin(r) + dy * Math.cos(r);
        session.resizeSingleLocal(single.id, dlx, dly, drag.edges);
      } else {
        session.resizeSelected((px - drag.startX) / scale, (py - drag.startY) / scale, drag.edges);
      }
      dragRef.current = { ...drag, startX: px, startY: py };
    } else if (drag.kind === 'rotate') {
      const angle = Math.atan2(py - drag.centerY, px - drag.centerX);
      let delta = ((angle - drag.startAngle) * 180) / Math.PI;
      if (ev.shiftKey) delta = Math.round(delta / 15) * 15; // Shift 吸附 15°，默认无极连续
      if (Math.abs(delta) > 0.01) {
        session.rotateSelected(delta);
        dragRef.current = { ...drag, startAngle: angle };
      }
    }
  };

  const onPointerUp = (ev: React.PointerEvent) => {
    const down = downInfoRef.current;
    dragRef.current = { kind: 'none' };
    snapXRef.current.reset();
    snapYRef.current.reset();
    setGuides({ x: null, y: null });
    session.endTransform();
    // 双击文字类元素 → 行内编辑
    if (down && !down.moved && down.id && ev.detail >= 2) {
      const el = doc.elements.find((e) => e.id === down.id);
      if (el && (el.kind === 'text' || el.kind === 'datetime' || el.kind === 'sequence')) {
        setEditing({ id: el.id, text: el.text });
      }
    }
    downInfoRef.current = null;
  };

  const commitEditing = () => {
    if (!editing) return;
    const el = doc.elements.find((e) => e.id === editing.id);
    if (el && el.text !== editing.text) session.update({ ...el, text: editing.text });
    setEditing(null);
  };

  const editingEl = editing ? doc.elements.find((e) => e.id === editing.id) : null;

  return (
    <div
      ref={wrapRef}
      className="canvas-paper"
      style={{
        width: viewportWidth * zoom, // 纸面像素宽 = 点数 × scale（含 zoom），等比例放大
        height: visDotsH * scale,
        borderRadius: paperRadius,
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: paperRadius, imageRendering: 'pixelated' }}
      />

      {/* 选中覆盖层：与内容共用同一变换几何 */}
      <svg className="canvas-overlay" style={{ width: '100%', height: '100%' }}>
        {/* 磁吸参考线 */}
        {guides.x !== null && (
          <line
            x1={(guides.x - printableStartX(doc.paper) + offsetXDots(doc.paper)) * scale}
            x2={(guides.x - printableStartX(doc.paper) + offsetXDots(doc.paper)) * scale}
            y1={0} y2="100%" stroke="var(--primary)" strokeWidth={1} strokeDasharray="5 4" opacity={0.9}
          />
        )}
        {guides.y !== null && (
          <line
            y1={(guides.y + offsetYDots(doc.paper)) * scale}
            y2={(guides.y + offsetYDots(doc.paper)) * scale}
            x1={0} x2="100%" stroke="var(--primary)" strokeWidth={1} strokeDasharray="5 4" opacity={0.9}
          />
        )}
        {snap.selectedElements.map((el) => {
          const corners = elementCorners(el).map((c) => ({
            x: (c.x - printableStartX(doc.paper) + offsetXDots(doc.paper)) * scale,
            y: (c.y + offsetYDots(doc.paper)) * scale,
          }));
          const points = corners.map((c) => `${c.x},${c.y}`).join(' ');
          return (
            <polygon
              key={el.id}
              points={points}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={snap.selectedElements.length > 1 ? 1.2 : 2}
              strokeDasharray="7 5"
              opacity={snap.selectedElements.length > 1 ? 0.75 : 1}
            />
          );
        })}
        {groupBox && snap.selectedElements.length > 1 && (
          <rect
            x={groupBox.left} y={groupBox.top}
            width={groupBox.right - groupBox.left} height={groupBox.bottom - groupBox.top}
            fill="none" stroke="var(--primary)" strokeWidth={2}
          />
        )}
        {handleLayout && (
          <>
            {(() => {
              const topMid = handleLayout.points[1];
              const rot = handleLayout.rotate;
              return (
                <line
                  x1={topMid.x} y1={topMid.y} x2={rot.x} y2={rot.y}
                  stroke="var(--primary)" strokeWidth={1.5}
                />
              );
            })()}
            <circle
              cx={handleLayout.rotate.x} cy={handleLayout.rotate.y} r={7}
              fill="var(--surface)" stroke="var(--primary)" strokeWidth={2}
              style={{ cursor: 'grab' }}
            />
            {handleLayout.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5.5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={2} />
            ))}
          </>
        )}
      </svg>

      {editingEl && editing && (
        <textarea
          className="inline-text-editor"
          autoFocus
          value={editing.text}
          onChange={(e) => setEditing({ id: editing.id, text: e.target.value })}
          onBlur={commitEditing}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEditing(); if (e.key === 'Escape') setEditing(null); }}
          style={{
            left: (editingEl.x - printableStartX(doc.paper) + offsetXDots(doc.paper)) * scale,
            top: (editingEl.y + offsetYDots(doc.paper)) * scale,
            width: Math.max(120, editingEl.width * scale),
            height: Math.max(60, editingEl.height * scale),
          }}
        />
      )}
    </div>
  );
}
