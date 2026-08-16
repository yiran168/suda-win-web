/**
 * 首页：打印机连接卡（蓝牙 SPP）+ 功能宫格 + 文档直印导入 + 新建设置。
 */
import { useEffect, useRef, useState, Dispatch, SetStateAction } from 'react';
import { useSyncExternalStore } from 'react';
import { printerManager } from '../transport/manager';
import { SppTransport } from '../transport/spp';
import { WebSerialTransport } from '../transport/webSerial';
import { SerialPortInfo } from '../platform';
import { LabelDocument, PaperSettings, mmToDots, clamp } from '../model/document';
import { NOTE_STYLES, NoteStyle, blankDocument, noteDocument } from '../model/presets';
import { importDocumentFile, ImportResult, acceptForFile } from '../docs/importer';
import { printDocument } from '../print/printJob';
import { sharedImageCache } from '../render/imageCache';
import { renderPreview } from '../render/rasterize';
import { loadPrefs, savePrefs, paperFromPrefs } from '../store/local';
import { NumberField } from '../components/NumberField';
import { PaperSettingsFields } from '../components/PaperSettingsFields';
import { logError } from '../logging/logger';

/** 文档直印批次：原始文件 + 本批纸张设置 + 解析结果 + 勾选状态。放 App 层持有，进编辑器改页再回来不丢 */
export interface DocBatch {
  /** 原始文件：批次内改纸张后重新排版用 */
  file: File;
  /** 本批次纸张设置（独立于全局「设备校准」，只影响这批文档） */
  paper: PaperSettings;
  result: ImportResult;
  /** 勾选的页下标（升序） */
  selected: number[];
  /** 手动编辑过的页下标：重新排版会丢失这些页的编辑，需先确认 */
  edited: number[];
}

interface Props {
  /** 打开编辑器；onDone 在编辑器返回时拿到改后的文档（文档直印改页用） */
  onOpenDocument: (doc: LabelDocument, from?: 'home', onDone?: (edited: LabelDocument) => void) => void;
  batch: DocBatch | null;
  onBatchChange: Dispatch<SetStateAction<DocBatch | null>>;
  onGoSettings: () => void;
  onGoTemplates: () => void;
  onGoHistory: () => void;
  onToast: (msg: string) => void;
}

export function HomePage(props: Props) {
  const snap = useSyncExternalStore(
    (fn) => printerManager.subscribe(fn),
    () => printerManager.snapshot(),
  );
  const [prefs, setPrefs] = useState(loadPrefs());
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState(prefs.lastDevice);
  const [showNew, setShowNew] = useState(false);
  const batch = props.batch;
  const [batchDensity, setBatchDensity] = useState(() => loadPrefs().density); // 文档直印时的浓度选择
  /** 批次打印中状态：取消用 AbortController + 进度显示 */
  const [printCtl, setPrintCtl] = useState<{ abort: AbortController; done: number; total: number; title: string } | null>(null);
  /** 批次断点：中断（取消/失败）的页与页内份数；result 引用失效（重新排版/换文档）后断点作废 */
  const [resumePoint, setResumePoint] = useState<{
    docs: LabelDocument[]; pageIdx: number; copyIdx: number;
    density: number; closeWhenDone: boolean; result: ImportResult | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSppPicker, setShowSppPicker] = useState(false);
  const [showFeed, setShowFeed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshPorts = async () => {
    const list = await SppTransport.listPorts();
    setPorts(list);
    if (!selectedPort && list.length) setSelectedPort(list[0].path);
  };
  useEffect(() => { void refreshPorts(); }, []);

  /** SPP：先刷新串口列表再弹窗选择 */
  const openSppPicker = async () => {
    await refreshPorts();
    setShowSppPicker(true);
  };

  /** 连接入口按环境分流：桌面客户端走串口列表；Chrome/Edge 网页走 Web Serial 选择器 */
  const openConnect = async () => {
    if (SppTransport.isAvailable()) {
      await openSppPicker();
      return;
    }
    if (WebSerialTransport.isAvailable()) {
      setBusy(true);
      try {
        await printerManager.connectWebSerial();
        if (printerManager.isReady()) props.onToast('打印机已连接');
      } catch (e) {
        logError('transport', String(e));
        props.onToast(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    props.onToast('当前环境不支持串口连接：请使用桌面客户端，或用 Chrome / Edge 打开网页版');
  };

  const connectSppPort = async (path: string) => {
    setShowSppPicker(false);
    setBusy(true);
    try {
      await printerManager.connectSpp(path, prefs.baud);
      setSelectedPort(path);
      const next = { ...prefs, lastDevice: path };
      setPrefs(next);
      savePrefs(next);
      props.onToast('打印机已连接');
    } catch (e) {
      const msg = String(e);
      logError('transport', msg);
      props.onToast(msg);
    } finally {
      setBusy(false);
    }
  };

  const onPickDoc = async (file: File) => {
    if (!acceptForFile(file.name)) {
      props.onToast('支持 PDF / Word(docx) / PPT(pptx) / Excel(xlsx) / TXT');
      return;
    }
    setBusy(true);
    try {
      const paper = paperFromPrefs();
      const result = await importDocumentFile(file, paper);
      // 默认全选：打印选中 = 全部打印
      props.onBatchChange({ file, paper, result, selected: result.documents.map((_, i) => i), edited: [] });
    } catch (e) {
      logError('docs', String(e));
      props.onToast(String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 批次内改纸张：按新纸张重新导入排版——内容自动按新尺寸填充（标签纸按标签高切片/钳高，连续纸整长展开） */
  const reimportWithPaper = async (paper: PaperSettings) => {
    const b = props.batch;
    if (!b || busy) return;
    if (b.edited.length
      && !window.confirm(`已手动编辑过 ${b.edited.length} 页，按新纸张重新排版会丢失这些页的编辑内容。继续？`)) {
      return;
    }
    setBusy(true);
    try {
      const result = await importDocumentFile(b.file, paper);
      props.onBatchChange({ file: b.file, paper, result, selected: result.documents.map((_, i) => i), edited: [] });
      props.onToast(`已按 ${paper.mode === 'label' ? `标签 ${paper.widthMm}×${paper.labelHeightMm}mm` : `连续纸 ${paper.widthMm}mm`} 重新排版（${result.documents.length} 页）`);
    } catch (e) {
      logError('docs', String(e));
      props.onToast(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 逐页打印给定的页面序列；closeWhenDone 且全部成功时关掉批次。
   * 支持取消（AbortSignal，当前页打完或 ACK 等待中即中断）与断点续打（resume 指定起始页/份）：
   * 中断后记录断点，弹窗出现「从第 X 页续打」——与编辑器单文档打印同一套交互。
   */
  const printDocs = async (
    docs: LabelDocument[], density: number, closeWhenDone: boolean,
    resume?: { pageIdx: number; copyIdx: number },
  ) => {
    if (!docs.length || busy) return;
    setBusy(true);
    setResumePoint(null);
    const abort = new AbortController();
    const startPage = Math.min(resume?.pageIdx ?? 0, docs.length - 1);
    let stopped = false;
    for (let i = startPage; i < docs.length; i++) {
      setPrintCtl({ abort, done: i, total: docs.length, title: docs[i].title });
      const r = await printDocument(docs[i], sharedImageCache, {
        density,
        signal: abort.signal,
        startCopy: i === startPage ? resume?.copyIdx ?? 0 : 0,
      });
      if (!r.ok) {
        stopped = true;
        setResumePoint({
          docs, pageIdx: i, copyIdx: r.doneCopies ?? 0, density, closeWhenDone,
          result: props.batch?.result ?? null,
        });
        props.onToast(r.cancelled
          ? `已取消（完成 ${i}/${docs.length} 页，可从断点续打）`
          : `「${docs[i].title}」失败：${r.message}（完成 ${i}/${docs.length} 页，可从断点续打）`);
        break;
      }
    }
    setPrintCtl(null);
    setBusy(false);
    if (!stopped) {
      props.onToast(`打印完成（${docs.length} 页）`);
      if (closeWhenDone) props.onBatchChange(null);
    }
  };

  const toggleSel = (i: number) => {
    props.onBatchChange((b) => b && ({
      ...b,
      selected: b.selected.includes(i)
        ? b.selected.filter((x) => x !== i)
        : [...b.selected, i].sort((a, z) => a - z),
    }));
  };
  const toggleAll = () => {
    props.onBatchChange((b) => b && ({
      ...b,
      selected: b.selected.length === b.result.documents.length ? [] : b.result.documents.map((_, i) => i),
    }));
  };

  /** 编辑第 i 页：编辑器返回时用改后的文档替换这一页，批次与勾选保持；登记为已编辑（重新排版前会提示） */
  const editPage = (i: number) => {
    const b = props.batch;
    if (!b) return;
    props.onOpenDocument(b.result.documents[i], 'home', (edited) => {
      props.onBatchChange((cur) => cur && ({
        ...cur,
        result: { ...cur.result, documents: cur.result.documents.map((d, j) => (j === i ? edited : d)) },
        edited: cur.edited.includes(i) ? cur.edited : [...cur.edited, i],
      }));
    });
  };

  const statusParts = snap.state === 'connected'
    ? [
      'SPP',
      snap.status
        ? (snap.status.raw !== null && (snap.status.raw & 0x04) ? '⚠️ 缺纸' : '有纸')
        : '状态查询中…',
      snap.status?.ok ? '状态正常' : snap.status?.problems.filter((p) => p !== '缺纸').join('、') || '状态正常',
      snap.battery != null ? `电量 ${snap.battery}%` : '',
    ].filter(Boolean).join(' · ')
    : '';
  const statusLabel = statusParts || '未连接';

  return (
    <div className="home-page">
      <section className="card printer-card">
        <div className="printer-icon">🖨️</div>
        <div className="printer-info">
          <div className="printer-title">
            {snap.state === 'connected' ? snap.deviceLabel || '已连接' : '未连接打印机'}
          </div>
          <div className="printer-sub">
            {snap.state === 'connected'
              ? statusLabel
              : SppTransport.isAvailable()
                ? '经典蓝牙 SPP 连接：请先在 Windows 蓝牙设置中配对打印机'
                : WebSerialTransport.isAvailable()
                  ? '浏览器直连（Web Serial）：请先在系统蓝牙设置中配对打印机，再点连接选择其串口'
                  : '当前浏览器不支持串口连接——请用桌面客户端，或 Chrome / Edge 打开网页版'}
          </div>
          {snap.lastError && <div className="printer-error">{snap.lastError}</div>}
          {snap.status?.problems.includes('过热') && (
            <div className="printer-error">🌡️ 打印头过热：固件保护中，暂停打印，稍凉后会自动恢复</div>
          )}
        </div>
        <div className="printer-actions">
          {snap.state !== 'connected' ? (
            <button
              className="btn primary" disabled={busy}
              onClick={() => void openConnect()}
            >
              {busy ? '连接中…' : '连接打印机'}
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => void printerManager.pollOnce()}>刷新状态</button>
              <button className="btn" onClick={() => setShowFeed(true)}>走纸</button>
              <button className="btn danger" onClick={() => void printerManager.disconnect()}>断开</button>
            </>
          )}
        </div>
      </section>

      <section className="home-grid">
        <button className="home-tile" onClick={() => setShowNew(true)}>
          <span className="tile-icon">✏️</span><span>新建画布</span>
          <span className="tile-sub">文字 / 图片 / 条码 / 表格…</span>
        </button>
        <button className="home-tile" onClick={() => fileRef.current?.click()}>
          <span className="tile-icon">📄</span><span>文档直印</span>
          <span className="tile-sub">PDF / Word / PPT / Excel / TXT</span>
        </button>
        <button className="home-tile" onClick={props.onGoTemplates}>
          <span className="tile-icon">🗂️</span><span>模板</span>
          <span className="tile-sub">保存的排版一键复用</span>
        </button>
        <button className="home-tile" onClick={props.onGoHistory}>
          <span className="tile-icon">🕘</span><span>历史</span>
          <span className="tile-sub">打印记录与重新打印</span>
        </button>
      </section>
      <input
        ref={fileRef} type="file" hidden
        accept=".pdf,.docx,.pptx,.xlsx,.xls,.txt"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickDoc(f); e.target.value = ''; }}
      />

      <section className="card tip-card" onClick={props.onGoSettings} role="button">
        <div>
          <div className="tip-title">首次使用？先去设置完成设备校准</div>
          <div className="tip-sub">纸宽、靠左/靠右装纸、横纵偏移，都在「设置 → 设备校准」。使用方法见「设置 → 使用方法」。</div>
        </div>
        <span className="tip-arrow">→</span>
      </section>

      {showNew && (
        <NewDocumentDialog
          onCancel={() => setShowNew(false)}
          onCreate={(paper, noteStyle) => {
            setShowNew(false);
            props.onOpenDocument(
              noteStyle
                ? noteDocument('随手记', paper, noteStyle)
                : blankDocument('未命名标签', paper),
            );
          }}
        />
      )}

      {batch && (
        <div className="modal-mask" onPointerDown={(e) => e.target === e.currentTarget && !busy && props.onBatchChange(null)}>
          <div className="modal batch-modal">
            <div className="modal-title">文档已解析：{batch.result.sourceName}</div>
            <BatchPaperSection paper={batch.paper} busy={busy} onApply={(p) => void reimportWithPaper(p)} />
            <div className="panel-row" style={{ justifyContent: 'space-between', marginTop: 2 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={batch.selected.length === batch.result.documents.length && batch.result.documents.length > 0}
                  onChange={toggleAll}
                /> 全选
              </label>
              <span className="hint-text">共 {batch.result.documents.length} 页 · 已选 {batch.selected.length} 页</span>
            </div>
            <div className="batch-list">
              {batch.result.documents.map((d, i) => (
                <div key={d.id} className={`batch-row${batch.selected.includes(i) ? ' selected' : ''}`}>
                  <label className="check">
                    <input type="checkbox" checked={batch.selected.includes(i)} onChange={() => toggleSel(i)} />
                  </label>
                  {batch.result.documents.length <= 40 && <PageThumb doc={d} />}
                  <div className="batch-row-main">
                    <div className="batch-row-title">第 {i + 1} 页 · {d.title}</div>
                    <div className="hint-text">
                      {d.paper.mode === 'label' ? `标签 ${d.paper.widthMm}×${d.paper.labelHeightMm}mm` : '连续纸'} · {d.elements.length} 个元素
                    </div>
                  </div>
                  <button className="chip" disabled={busy} onClick={() => editPage(i)}>编辑</button>
                </div>
              ))}
            </div>
            <div className="panel-row" style={{ marginTop: 4 }}>
              <label className="num-field"><span>打印浓度</span>
                <select className="panel-select" value={batchDensity} onChange={(e) => setBatchDensity(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <span className="hint-text">点「编辑」进画布改这一页，返回后回到本列表继续选页打印</span>
            </div>
            {printCtl && (
              <div className="panel-row" style={{ marginTop: 4 }}>
                <span className="hint-text">正在打印：第 {printCtl.done + 1}/{printCtl.total} 页 · {printCtl.title}</span>
                <span style={{ flex: 1 }} />
                <button className="btn danger" onClick={() => printCtl.abort.abort()}>取消打印</button>
              </div>
            )}
            {!printCtl && resumePoint && resumePoint.result === batch.result && (
              <div className="panel-row" style={{ marginTop: 4 }}>
                <span className="hint-text">上次中断于第 {resumePoint.pageIdx + 1} 页（前面 {resumePoint.pageIdx} 页已完成）</span>
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={() => setResumePoint(null)}>清除断点</button>
                <button
                  className="btn primary" disabled={!printerManager.isReady()}
                  onClick={() => void printDocs(resumePoint.docs, resumePoint.density, resumePoint.closeWhenDone,
                    { pageIdx: resumePoint.pageIdx, copyIdx: resumePoint.copyIdx })}
                >
                  从第 {resumePoint.pageIdx + 1} 页续打（剩 {resumePoint.docs.length - resumePoint.pageIdx} 页）
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" disabled={busy} onClick={() => props.onBatchChange(null)}>取消</button>
              <span style={{ flex: 1 }} />
              <button
                className="btn" disabled={busy || !batch.selected.length || !printerManager.isReady()}
                onClick={() => void printDocs(batch.selected.map((i) => batch.result.documents[i]), batchDensity, false)}
              >
                打印选中（{batch.selected.length} 页）
              </button>
              <button
                className="btn primary" disabled={busy || !printerManager.isReady()}
                onClick={() => void printDocs(batch.result.documents, batchDensity, true)}
              >
                {printerManager.isReady() ? `全部打印（${batch.result.documents.length} 页）` : '未连接打印机'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSppPicker && (
        <SppChooserDialog
          ports={ports}
          onRefresh={refreshPorts}
          onPick={(path) => void connectSppPort(path)}
          onCancel={() => setShowSppPicker(false)}
        />
      )}

      {showFeed && (
        <FeedDialog
          onClose={() => setShowFeed(false)}
          onToast={props.onToast}
        />
      )}
    </div>
  );
}

/* ------------------------------ 批次页缩略图 ------------------------------ */

/** 页缩略图：预热图片后用彩色预览渲染，再缩放进 72px 宽的小画布 */
function PageThumb({ doc }: { doc: LabelDocument }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const srcs = doc.elements.filter((e) => e.kind === 'image' && e.src).map((e) => e.src);
      if (srcs.length) await sharedImageCache.preload(srcs);
      if (!alive || !ref.current) return;
      const full = renderPreview(doc, sharedImageCache, 0);
      const c = ref.current;
      c.width = 72;
      c.height = Math.max(24, Math.round((full.height * 72) / full.width));
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(full, 0, 0, c.width, c.height);
    })();
    return () => { alive = false; };
  }, [doc]);
  return (
    <div className="batch-thumb-wrap"><canvas ref={ref} className="batch-thumb" /></div>
  );
}

/* ------------------------------ 单独走纸对话框 ------------------------------ */

const FEED_QUICK_MM = [5, 10, 20, 30];

function FeedDialog({ onClose, onToast }: { onClose: () => void; onToast: (msg: string) => void }) {
  const [mm, setMm] = useState(10);
  const [feeding, setFeeding] = useState(false);

  const feed = async () => {
    const safe = clamp(mm, 0.1, 100);
    setFeeding(true);
    try {
      await printerManager.feedPaper(mmToDots(safe));
      onToast(`已走纸 ${safe} mm`);
      onClose();
    } catch (e) {
      logError('print', `走纸失败：${String(e)}`);
      onToast(`走纸失败：${String(e)}`);
    } finally {
      setFeeding(false);
    }
  };

  return (
    <div className="modal-mask" onPointerDown={(e) => { if (e.target === e.currentTarget && !feeding) onClose(); }}>
      <div className="modal" style={{ width: 'min(440px, 94vw)' }}>
        <div className="modal-title">单独走纸</div>
        <p className="hint-text">不打印内容，只让打印机按设定的毫米数向前送纸（0.1–100 mm）。</p>
        <div className="panel-row preset-row" style={{ marginTop: 12 }}>
          {FEED_QUICK_MM.map((v) => (
            <button key={v} className={`chip preset${mm === v ? ' active' : ''}`} onClick={() => setMm(v)}>{v} mm</button>
          ))}
        </div>
        <div className="panel-row" style={{ marginTop: 10 }}>
          <label className="num-field"><span>距离 mm</span>
            <NumberField step={0.5} min={0.1} max={100} value={mm} onCommit={setMm} />
          </label>
          <span className="hint-text">≈ {mmToDots(clamp(mm, 0.1, 100))} 点</span>
        </div>
        <div className="modal-actions">
          <button className="btn" disabled={feeding} onClick={onClose}>取消</button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" disabled={feeding} onClick={() => void feed()}>
            {feeding ? '走纸中…' : '开始走纸'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- SPP 串口选择对话框 ---------------------------- */

/** 友好名里带蓝牙/打印关键词的排前面 */
function rankSppPort(p: SerialPortInfo): number {
  const name = p.friendlyName ?? '';
  return /bluetooth|蓝牙|print|qring|beeprt/i.test(name) ? 0 : 1;
}

function SppChooserDialog({ ports, onRefresh, onPick, onCancel }: {
  ports: SerialPortInfo[];
  onRefresh: () => Promise<void>;
  onPick: (path: string) => void;
  onCancel: () => void;
}) {
  const sorted = [...ports].sort((a, b) => rankSppPort(a) - rankSppPort(b) || a.path.localeCompare(b.path));
  return (
    <div className="modal-mask" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal">
        <div className="modal-title">选择串口设备</div>
        <p className="hint-text">
          经典蓝牙 SPP 打印机会以串口形式出现（名称常含「蓝牙串行 / Bluetooth」）。请确认打印机已开机并已与电脑配对。
        </p>
        <div className="ble-list">
          {sorted.length === 0 && (
            <div className="ble-empty">未发现串口设备——请先在系统蓝牙里配对打印机，再点下方「刷新」。</div>
          )}
          {sorted.map((p) => (
            <button key={p.path} className="ble-row" onClick={() => onPick(p.path)}>
              <span className="ble-row-icon">🖨️</span>
              <span className="ble-row-name">{p.friendlyName ?? p.path}</span>
              {rankSppPort(p) === 0 && <span className="ble-row-badge">可能是打印机</span>}
              <span className="ble-row-go">连接 →</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => void onRefresh()}>刷新列表</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- 批次纸张设置区 ---------------------------- */

/** 文档直印批次内的纸张设置：草稿式修改 + 「重新排版」应用，避免大文件每次改动都重排 */
function BatchPaperSection({ paper, busy, onApply }: {
  paper: PaperSettings;
  busy: boolean;
  onApply: (p: PaperSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(paper);
  useEffect(() => { setDraft(paper); }, [paper]); // 重新排版完成后同步草稿
  const dirty = JSON.stringify(draft) !== JSON.stringify(paper);
  const summary = paper.mode === 'label'
    ? `标签纸 ${paper.widthMm}×${paper.labelHeightMm}mm`
    : `连续纸 ${paper.widthMm}mm`;
  return (
    <div className="panel-section">
      <div className="panel-row" style={{ justifyContent: 'space-between' }}>
        <span className="hint-text">纸张：{summary}（仅本批次，不改全局设置）</span>
        <button className="chip" disabled={busy} onClick={() => setOpen(!open)}>{open ? '收起 ▴' : '修改纸张 ▾'}</button>
      </div>
      {open && (
        <>
          <PaperSettingsFields paper={draft} onChange={setDraft} />
          <div className="panel-row" style={{ marginTop: 4 }}>
            <button className="btn primary" disabled={busy || !dirty} onClick={() => onApply(draft)}>
              {busy ? '重新排版中…' : '按此纸张重新排版'}
            </button>
            <span className="hint-text">内容会按新纸张尺寸自动重新填充与分页</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------ 新建文档对话框 ------------------------------ */

function NewDocumentDialog({ onCreate, onCancel }: {
  onCreate: (paper: PaperSettings, noteStyle: NoteStyle | null) => void; onCancel: () => void;
}) {
  const [paper, setPaper] = useState<PaperSettings>(paperFromPrefs());
  const [noteStyle, setNoteStyle] = useState<NoteStyle | null>(null);
  return (
    <div className="modal-mask" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <div className="modal-title">新建画布</div>
        <PaperSettingsFields paper={paper} onChange={setPaper} />
        <div className="panel-section">
          <div className="panel-section-title">便签底纹</div>
          <div className="panel-row preset-row">
            <button className={`chip preset${noteStyle === null ? ' active' : ''}`} onClick={() => setNoteStyle(null)}>无</button>
            {NOTE_STYLES.map((s) => (
              <button key={s.value} className={`chip preset${noteStyle === s.value ? ' active' : ''}`}
                onClick={() => setNoteStyle(s.value)}>{s.label}</button>
            ))}
          </div>
          {noteStyle && <div className="hint-text">底纹按当前纸张高度生成（连续纸默认 65 mm，标签纸按标签长度），生成后每条线都可单独再编辑。</div>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => onCreate(paper, noteStyle)}>创建</button>
        </div>
      </div>
    </div>
  );
}
