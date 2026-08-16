/** 模板页：我的模板（本地收藏）+ 内置行业模板目录（494 套，移植自安卓参考版）。
 *  套用任何模板前都先弹窗确认纸宽，再按「模板纸宽 → 确认纸宽」等比缩放（模型层 scaleDocumentToPaper）。 */
import { useMemo, useState } from 'react';
import { LabelDocument, clamp, documentToJson, paperWidthDots, scaleDocumentToPaper, uid } from '../model/document';
import { loadTemplates, paperFromPrefs, saveTemplates } from '../store/local';
import { BuiltinTemplate, TEMPLATE_CATEGORIES, builtinInCategory } from '../data/builtinTemplates';
import { NumberField } from '../components/NumberField';

interface Props {
  onOpen: (doc: LabelDocument) => void;
  onToast: (msg: string) => void;
}

/** 待套用的模板：先填纸宽再缩放 */
interface PendingTemplate { doc: LabelDocument; title: string }

export function TemplatesPage({ onOpen, onToast }: Props) {
  const [tab, setTab] = useState<'mine' | 'builtin'>('builtin');
  const [templates, setTemplates] = useState(loadTemplates());
  const [cat, setCat] = useState('全部');
  const builtin = useMemo(() => builtinInCategory(cat), [cat]);
  const [pending, setPending] = useState<PendingTemplate | null>(null);
  const [widthMm, setWidthMm] = useState(57);

  /** 点「使用模板」：先弹窗填纸宽（默认取设备校准里的当前纸宽） */
  const beginUse = (doc: LabelDocument, title: string) => {
    setWidthMm(clamp(paperFromPrefs().widthMm, 10, 57));
    setPending({ doc, title });
  };

  /** 确认纸宽 → 按比例缩放 → 进编辑器 */
  const confirmUse = () => {
    if (!pending) return;
    const target = { ...paperFromPrefs(), widthMm: clamp(widthMm, 10, 57) };
    const ratio = paperWidthDots(target) / paperWidthDots(pending.doc.paper);
    onOpen(scaleDocumentToPaper(pending.doc, target));
    onToast(
      Math.abs(ratio - 1) < 0.005
        ? `已套用模板「${pending.title}」`
        : `已套用模板「${pending.title}」，并按 ${target.widthMm}mm 纸宽等比缩放`,
    );
    setPending(null);
  };

  const rename = (id: string) => {
    const name = window.prompt('模板名称');
    if (!name?.trim()) return;
    const next = templates.map((t) => (t.id === id ? { ...t, title: name.trim() } : t));
    saveTemplates(next);
    setTemplates(next);
  };

  const remove = (id: string) => {
    const next = templates.filter((t) => t.id !== id);
    saveTemplates(next);
    setTemplates(next);
    onToast('已删除模板');
  };

  const exportJson = (doc: LabelDocument) => {
    const blob = new Blob([documentToJson(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title}.qrint.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 套用内置模板：整文档重新分配 id，避免与已存文档/元素冲突 */
  const useBuiltin = (t: BuiltinTemplate) => {
    const now = Date.now();
    const fresh: LabelDocument = {
      ...t.document,
      id: uid(),
      createdAt: now,
      updatedAt: now,
      elements: t.document.elements.map((e) => ({ ...e, id: uid() })),
    };
    beginUse(fresh, t.title);
  };

  return (
    <div className="page">
      <div className="tpl-tabs">
        <button className={`chip ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>我的模板</button>
        <button className={`chip ${tab === 'builtin' ? 'active' : ''}`} onClick={() => setTab('builtin')}>内置模板</button>
      </div>
      <div className="hint-text tpl-scale-hint">使用模板时会先确认纸宽，再按模板纸宽到确认纸宽的比例等比缩放，版式不变形。</div>

      {tab === 'mine' ? (
        templates.length ? (
          <div className="doc-list">
            {templates.map((t) => (
              <div key={t.id} className="card doc-item">
                <div className="doc-main" onClick={() => beginUse(t, t.title)} role="button">
                  <div className="doc-title">{t.title}</div>
                  <div className="doc-sub">
                    {t.paper.mode === 'label' ? `标签 ${t.paper.widthMm}×${t.paper.labelHeightMm}mm` : `连续纸 ${t.paper.widthMm}mm`}
                    · {t.elements.length} 个元素 · {new Date(t.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className="doc-actions">
                  <button className="chip" onClick={() => rename(t.id)}>重命名</button>
                  <button className="chip" onClick={() => exportJson(t)}>导出</button>
                  <button className="chip danger" onClick={() => remove(t.id)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">还没有模板。在画布编辑器里点「存为模板」即可收藏排版。</div>
        )
      ) : (
        <>
          <div className="tpl-cats">
            {TEMPLATE_CATEGORIES.map((c) => (
              <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          <div className="tpl-grid">
            {builtin.map((t) => (
              <div key={t.id} className="card tpl-card">
                {t.thumbUrl ? (
                  <img className="tpl-thumb" src={t.thumbUrl} loading="lazy" alt={t.title} />
                ) : (
                  <div className="tpl-thumb tpl-thumb-empty">纯元素模板</div>
                )}
                <div className="tpl-meta">
                  <div className="doc-title">{t.title}</div>
                  <div className="doc-sub">{t.widthMm}×{t.heightMm}mm · {t.document.elements.length} 个可编辑元素</div>
                </div>
                <button className="btn primary tpl-use" onClick={() => useBuiltin(t)}>使用模板</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 套用模板前的纸宽确认弹窗：填写的纸宽决定缩放比例 */}
      {pending && (
        <div className="modal-mask" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">套用「{pending.title}」</div>
            <div className="hint-text" style={{ marginBottom: 10 }}>
              模板设计尺寸 {pending.doc.paper.widthMm}mm 宽
              {pending.doc.paper.mode === 'label' ? ` × ${pending.doc.paper.labelHeightMm}mm 高` : ''}
              。填写你实际要用的纸宽，模板内容将长宽等比缩放，版式不变形。
            </div>
            <label className="num-field">
              <span>纸宽 mm</span>
              <NumberField
                className="panel-input" min={10} max={57} step={0.1} digits={1}
                value={widthMm} onCommit={setWidthMm}
              />
            </label>
            <div className="hint-text" style={{ marginTop: 8 }}>
              缩放比例 ≈ {(paperWidthDots({ ...paperFromPrefs(), widthMm: clamp(widthMm, 10, 57) }) / paperWidthDots(pending.doc.paper) * 100).toFixed(0)}%
              ；装纸方向、打印头点数等硬件设置沿用「设置 → 设备校准」。
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPending(null)}>取消</button>
              <button className="btn primary" onClick={confirmUse}>使用模板</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
