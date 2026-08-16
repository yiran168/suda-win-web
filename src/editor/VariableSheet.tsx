/**
 * 变量数据弹窗（对齐安卓 VariableDataSheet）：
 * 粘贴 CSV/TSV 或选择 xlsx/csv 文件 → 识别列 → 选定行范围 →
 * 逐行替换 {{字段}} 占位符批量打印（文字 / 表格 / 码内容都支持占位符）。
 */
import { useRef, useState } from 'react';
import { VariableDataTable, fieldsUsedIn, parseDelimited, parseWorkbook, substituteVariables } from '../data/variableData';
import { EditorSession } from './session';
import { sharedImageCache } from '../render/imageCache';
import { printDocument } from '../print/printJob';
import { printerManager } from '../transport/manager';
import { loadPrefs } from '../store/local';
import { logInfo } from '../logging/logger';

interface Props {
  session: EditorSession;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export function VariableDataSheet({ session, onClose, onToast }: Props) {
  const [table, setTable] = useState<VariableDataTable | null>(null);
  const [pasted, setPasted] = useState('');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doc = session.getSnapshot().document;
  const usedFields = fieldsUsedIn([
    ...doc.elements.map((e) => e.text),
    ...doc.elements.map((e) => e.codeValue),
    ...doc.elements.flatMap((e) => e.tableCells),
  ]);
  const missing = table ? usedFields.filter((f) => !table.columns.includes(f)) : [];

  const load = async (t: VariableDataTable) => {
    setTable(t);
    setFrom(1);
    setTo(t.rows.length);
    logInfo('docs', `变量数据解析：${t.sourceName}，${t.columns.length} 列 × ${t.rows.length} 行`);
  };

  const onFile = async (file: File) => {
    try { await load(await parseWorkbook(file)); } catch (e) { onToast(String(e)); }
  };

  const onPaste = () => {
    try {
      if (!pasted.trim()) { onToast('请先粘贴 CSV / 表格文本'); return; }
      void load(parseDelimited('粘贴的数据', pasted));
    } catch (e) { onToast(String(e)); }
  };

  const batchPrint = async () => {
    if (!table) return;
    const prefs = loadPrefs();
    const lo = Math.max(1, Math.min(from, to));
    const hi = Math.min(table.rows.length, Math.max(from, to));
    const rows = table.rows.slice(lo - 1, hi);
    let ok = 0;
    for (let i = 0; i < rows.length; i++) {
      setBusy(`正在打印第 ${i + 1}/${rows.length} 行…`);
      const row = rows[i];
      const current = session.getSnapshot().document;
      const substituted = {
        ...current,
        title: `${current.title}（第 ${lo + i} 行）`,
        elements: current.elements.map((el) => ({
          ...el,
          text: substituteVariables(el.text, row),
          codeValue: substituteVariables(el.codeValue, row),
          tableCells: el.tableCells.map((c) => substituteVariables(c, row)),
        })),
      };
      const r = await printDocument(substituted, sharedImageCache, { density: prefs.density, seqIndex: i });
      if (!r.ok) { onToast(`第 ${lo + i} 行失败：${r.message}`); break; }
      ok++;
    }
    setBusy('');
    if (ok === rows.length) {
      onToast(`变量批量打印完成（${ok} 张）`);
      onClose();
    }
  };

  return (
    <div className="modal-mask" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: 'min(720px, 96vw)' }}>
        <div className="modal-title">变量数据 · 批量打印</div>
        <p className="hint-text">
          在文字、表格或码内容里写 <code>{'{{字段名}}'}</code> 作为占位符；这里提供的数据表每一行生成一张打印内容。
          第一行必须是表头。
        </p>

        <div className="panel-row">
          <button className="btn" onClick={() => fileRef.current?.click()}>选择文件（xlsx / csv / txt）</button>
          <input
            ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv,.tsv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }}
          />
          <span className="hint-text">或：</span>
        </div>
        <textarea
          className="panel-textarea" rows={4} value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={'粘贴 CSV / 制表符文本，例如：\n品名,价格,条码\n苹果,5.00,6901234567890\n香蕉,3.50,6901234567891'}
        />
        <div className="panel-row">
          <button className="btn" onClick={onPaste}>解析粘贴内容</button>
        </div>

        {table && (
          <>
            <div className="panel-section" style={{ marginTop: 8 }}>
              <div className="panel-section-title">{table.sourceName}：{table.columns.length} 列 × {table.rows.length} 行</div>
              <div className="panel-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {table.columns.map((c) => (
                  <span key={c} className={`chip${usedFields.includes(c) ? ' active' : ''}`}>{c}</span>
                ))}
              </div>
              {missing.length > 0 && (
                <div className="hint-text" style={{ color: 'var(--danger)' }}>
                  画布中用到的 {missing.map((f) => `{{${f}}}`).join('、')} 在数据表里没有对应列，将原样打印。
                </div>
              )}
              {usedFields.length === 0 && (
                <div className="hint-text">画布中还没有 {'{{字段}}'} 占位符——回到画布，在文字 / 表格 / 码内容里写上如 {'{{品名}}'}。</div>
              )}
              <div className="panel-row" style={{ marginTop: 8 }}>
                <label className="num-field"><span>从第</span>
                  <input type="number" min={1} max={table.rows.length} value={from}
                    onChange={(e) => setFrom(Number(e.target.value) || 1)} /></label>
                <label className="num-field"><span>行到第</span>
                  <input type="number" min={1} max={table.rows.length} value={to}
                    onChange={(e) => setTo(Number(e.target.value) || 1)} /></label>
                <span className="hint-text">行（共 {table.rows.length} 行）</span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" disabled={!!busy} onClick={onClose}>关闭</button>
              <span style={{ flex: 1 }} />
              <button
                className="btn primary"
                disabled={!!busy || !printerManager.isReady()}
                onClick={() => void batchPrint()}
                title={printerManager.isReady() ? '' : '请先在首页连接打印机'}
              >
                {busy || (printerManager.isReady() ? `批量打印（${Math.abs(to - from) + 1} 张）` : '未连接打印机')}
              </button>
            </div>
          </>
        )}
        {!table && (
          <div className="modal-actions">
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={onClose}>关闭</button>
          </div>
        )}
      </div>
    </div>
  );
}
