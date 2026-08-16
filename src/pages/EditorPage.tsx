/**
 * 编辑器页面：画布 + 侧边长条滚动条 + 属性区。
 * - 画布可视高度可拖动底边调整，可整体收起/展开；长条随之收缩展开
 * - 底部为单元素属性面板或多选操作面板
 */
import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { ElementKind, LabelDocument, dotsToMm, mmToDots, paperWidthDots } from '../model/document';
import { documentHeightDots } from '../render/rasterize';
import { NumberField } from '../components/NumberField';
import { createElement } from '../model/presets';
import { EditorSession } from '../editor/session';
import { CanvasView } from '../editor/CanvasView';
import { SideScrollStrip, BottomScrollStrip } from '../editor/SideScrollStrip';
import { AddElementBar, ElementPanel, MultiPanel } from '../editor/panels';
import { ProductLibrarySheet } from '../editor/ProductSheet';
import { VariableDataSheet } from '../editor/VariableSheet';
import { sharedImageCache } from '../render/imageCache';
import { printDocument } from '../print/printJob';
import { printerManager } from '../transport/manager';
import { loadPrefs, saveTemplates, loadTemplates } from '../store/local';
import { logInfo } from '../logging/logger';

interface Props {
  initial: LabelDocument;
  /** 返回时回传编辑后的最新文档（文档直印改页等场景用） */
  onBack: (doc: LabelDocument) => void;
  onToast: (msg: string) => void;
}

const COLLAPSED_HEIGHT = 44;
const DEFAULT_HEIGHT = 520;
/* 画布视图缩放：等比例（横纵同倍率，标签纸不会被拉伸变形），只影响屏幕显示不影响打印点阵 */
const ZOOM_KEY = 'qrint.editor.zoom';
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
function loadZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1;
  } catch { return 1; }
}

export function EditorPage({ initial, onBack, onToast }: Props) {
  const [session] = useState(() => new EditorSession(initial));
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const printerSnap = useSyncExternalStore(
    (fn) => printerManager.subscribe(fn),
    () => printerManager.snapshot(),
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(360);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_HEIGHT);
  const [collapsed, setCollapsed] = useState(false);
  const [copies, setCopies] = useState(1);
  const [density, setDensity] = useState(() => loadPrefs().density); // 打印时可选，默认取设置里的值
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resumeFrom, setResumeFrom] = useState<number | null>(null); // 断点：下一份的下标
  const abortRef = useRef<AbortController | null>(null);
  const [showProducts, setShowProducts] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [zoom, setZoomState] = useState(loadZoom);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  /** 缩放画布视图（等比例）：更新状态并持久化，下次打开保持 */
  const applyZoom = (updater: (z: number) => number) => {
    setZoomState((prev) => {
      const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(updater(prev) * 100) / 100));
      try { localStorage.setItem(ZOOM_KEY, String(v)); } catch { /* 忽略 */ }
      return v;
    });
  };

  /* Ctrl + 滚轮缩放（原生监听：React 合成事件在 Chromium 下是 passive，preventDefault 无效） */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      applyZoom((z) => z * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* 画布宽度 = 可视区宽度 - 内边距 */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewportWidth(Math.max(160, el.clientWidth - 28));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const addElement = (kind: ElementKind) => {
    const el = createElement(kind, snap.document.paper);
    if (kind === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          el.src = String(reader.result);
          session.add(el);
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }
    session.add(el);
    logInfo('ui', `添加元素：${kind}`);
  };

  const doPrint = async (startCopy = 0) => {
    if (printing) return;
    setPrinting(true);
    setProgress({ done: startCopy, total: copies });
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const result = await printDocument(snap.document, sharedImageCache, {
        copies, density,
        startCopy,
        signal: abort.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      // 取消或中途失败且还有剩余份数 → 提供断点续打
      if (!result.ok && result.doneCopies != null && result.doneCopies < copies) {
        setResumeFrom(result.doneCopies);
      } else {
        setResumeFrom(null);
      }
      onToast(result.message);
    } finally {
      abortRef.current = null;
      setPrinting(false);
      setProgress(null);
    }
  };

  const saveAsTemplate = () => {
    try {
      const templates = loadTemplates().filter((t) => t.id !== snap.document.id);
      saveTemplates([snap.document, ...templates]);
      onToast('已保存到模板');
      logInfo('ui', `模板已保存：${snap.document.title}`);
    } catch (e) {
      onToast(String(e));
    }
  };

  const onResizeStart = (ev: React.PointerEvent) => {
    (ev.target as Element).setPointerCapture(ev.pointerId);
    resizeRef.current = { startY: ev.clientY, startH: collapsed ? DEFAULT_HEIGHT : viewportHeight };
  };
  const onResizeMove = (ev: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const h = Math.min(900, Math.max(120, r.startH + (ev.clientY - r.startY)));
    setViewportHeight(h);
    setCollapsed(false);
  };
  const onResizeEnd = () => { resizeRef.current = null; };

  const paperLabel = snap.document.paper.mode === 'label'
    ? `标签纸 ${snap.document.paper.widthMm}×${snap.document.paper.labelHeightMm} mm`
    : `连续纸 ${snap.document.paper.widthMm} mm · 内容长 ≈ ${dotsToMm(documentHeightDots(snap.document))} mm（自动）`;

  /* 底边拖条必须贴着纸面下边缘：
     标签纸（固定尺寸）→ 视口高度收缩到纸面实际像素高，纸短于视口时不留空档；
     连续纸 → 视口即纸卷窗口，画布始终填满用户拖动的高度。 */
  const paperScale = (viewportWidth / paperWidthDots(snap.document.paper)) * zoom;
  const paperPixelH = documentHeightDots(snap.document) * paperScale + 28; // 28 = 视口上下内边距
  const wrapHeight = collapsed
    ? COLLAPSED_HEIGHT
    : snap.document.paper.mode === 'label'
      ? Math.min(viewportHeight, Math.max(120, paperPixelH))
      : viewportHeight;

  return (
    <div className="editor-page">
      <header className="editor-toolbar">
        <button className="btn" onClick={() => onBack(session.getSnapshot().document)}>← 返回</button>
        <input
          className="title-input" value={snap.document.title}
          onChange={(e) => session.rename(e.target.value)}
        />
        <button className="chip" disabled={!snap.canUndo} onClick={() => session.undo()}>撤销</button>
        <button className="chip" disabled={!snap.canRedo} onClick={() => session.redo()}>重做</button>
        <button className="chip" onClick={() => session.selectAll()}>全选</button>
        <button className="chip" onClick={() => session.duplicateSelected()} disabled={!snap.selectedElements.length}>复制</button>
        <button className="chip" onClick={() => session.bringForward()} disabled={!snap.selectedElements.length}>上移层</button>
        <button className="chip" onClick={() => session.sendBackward()} disabled={!snap.selectedElements.length}>下移层</button>
        <button className="chip danger" onClick={() => session.deleteSelected()} disabled={!snap.selectedElements.length}>删除</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={saveAsTemplate}>存为模板</button>
        <label className="copies-field">浓度
          <select className="panel-select" value={density} onChange={(e) => setDensity(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="copies-field">份数
          <NumberField min={1} max={99} value={copies} onCommit={(v) => { setCopies(Math.round(v)); setResumeFrom(null); }} />
        </label>
        {printing ? (
          <>
            <button className="btn primary" disabled>
              打印中{progress && progress.total > 1 ? ` ${progress.done}/${progress.total}` : '…'}
            </button>
            <button className="btn danger" onClick={() => abortRef.current?.abort()} title="打完当前这一份后停止">
              取消
            </button>
          </>
        ) : (
          <>
            {resumeFrom !== null && resumeFrom < copies && (
              <button
                className="btn"
                disabled={!printerManager.isReady()}
                onClick={() => void doPrint(resumeFrom)}
                title={`跳过已完成的 ${resumeFrom} 份，从第 ${resumeFrom + 1} 份接着打`}
              >
                续打剩余 {copies - resumeFrom} 份
              </button>
            )}
            <button
              className="btn primary"
              disabled={!printerManager.isReady()}
              onClick={() => void doPrint(0)}
              title={printerManager.isReady() ? '' : '请先在首页连接打印机'}
            >
              {printerSnap.state === 'connected' ? '打印' : '未连接打印机'}
            </button>
          </>
        )}
      </header>

      <div className="editor-subbar">
        <span className="paper-badge">{paperLabel}</span>
        <AddElementBar onAdd={addElement} />
        <span style={{ flex: 1 }} />
        <button className="chip" onClick={() => applyZoom((z) => z / 1.25)} disabled={zoom <= ZOOM_MIN} title="缩小画布视图">−</button>
        <span className="zoom-field" title="画布视图缩放（等比例，不影响打印内容）；可直接输入 40–400，画布上 Ctrl+滚轮也可缩放">
          <NumberField
            className="panel-input zoom-input" min={ZOOM_MIN * 100} max={ZOOM_MAX * 100} step={10}
            value={Math.round(zoom * 100)}
            onCommit={(v) => applyZoom(() => v / 100)}
          />
          %
        </span>
        <button className="chip" onClick={() => applyZoom(() => 1)} title="恢复 100%">1:1</button>
        <button className="chip" onClick={() => applyZoom((z) => z * 1.25)} disabled={zoom >= ZOOM_MAX} title="放大画布视图">＋</button>
        <button className="chip" onClick={() => setShowProducts(true)}>商品资料</button>
        <button className="chip" onClick={() => setShowVariables(true)}>变量数据</button>
      </div>

      <div className="editor-main">
        <div className="canvas-column">
          {/* 两条划条都在画布外：竖条与画布并排为兄弟列，横条在画布正下方独占一行 */}
          <div className="canvas-wrap-row">
            <div className="canvas-viewport-wrap" style={{ height: wrapHeight }}>
              <div ref={viewportRef} className="canvas-viewport" style={{ height: '100%' }}>
                <CanvasView
                  session={session}
                  viewportWidth={viewportWidth}
                  minViewportPx={collapsed ? 0 : wrapHeight - 28}
                  zoom={zoom}
                />
              </div>
            </div>
            {/* 侧边长条：滑动它 = 滚动画布；收起时同步收起 */}
            <SideScrollStrip targetRef={viewportRef} collapsed={collapsed} />
          </div>
          {/* 底部长条：画布放大内容超宽时左右拖动 */}
          <BottomScrollStrip targetRef={viewportRef} />
          {/* 底边拖条：画布区域最下方的整宽横条，按住拖动调整画布高度 */}
          <div
            className="canvas-bottom-bar"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            title="按住拖动调整画布高度"
          >
            <span className="canvas-grip" aria-hidden />
            <span className="canvas-hint">{collapsed ? '画布已收起' : '按住此条上下拖动调整画布高度'}</span>
            <button
              className="chip"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (collapsed) { setCollapsed(false); setViewportHeight(DEFAULT_HEIGHT); }
                else setCollapsed(true);
              }}
            >
              {collapsed ? '展开画布' : '收起画布'}
            </button>
          </div>
        </div>

        <aside className="editor-side">
          {snap.selectedElements.length > 1
            ? <MultiPanel session={session} />
            : snap.anchor
              ? <ElementPanel session={session} />
              : <div className="hint-block">点击画布元素进行选择；<br />Ctrl+点击可多选；双击文字行内编辑；<br />选中后拖动顶部圆点旋转。</div>}
        </aside>
      </div>

      {showProducts && (
        <ProductLibrarySheet session={session} onClose={() => setShowProducts(false)} onToast={onToast} />
      )}
      {showVariables && (
        <VariableDataSheet session={session} onClose={() => setShowVariables(false)} onToast={onToast} />
      )}
    </div>
  );
}
