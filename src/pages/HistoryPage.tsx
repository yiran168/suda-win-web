/** 历史页：打印记录，一键重新编辑 / 重新打印。 */
import { useState } from 'react';
import { documentFromJson, LabelDocument } from '../model/document';
import { clearHistory, loadHistory } from '../store/local';
import { printDocument } from '../print/printJob';
import { sharedImageCache } from '../render/imageCache';
import { printerManager } from '../transport/manager';

interface Props {
  onOpen: (doc: LabelDocument) => void;
  onToast: (msg: string) => void;
}

export function HistoryPage({ onOpen, onToast }: Props) {
  const [records, setRecords] = useState(loadHistory());

  const reprint = async (json: string) => {
    try {
      const doc = documentFromJson(json);
      const result = await printDocument(doc, sharedImageCache, {});
      onToast(result.message);
    } catch (e) {
      onToast(String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-actions">
        <button className="chip danger" onClick={() => { clearHistory(); setRecords([]); }}>清空历史</button>
      </div>
      {!records.length && <div className="empty-state">暂无打印记录。</div>}
      <div className="doc-list">
        {records.map((r) => (
          <div key={r.id} className="card doc-item">
            <div className="doc-main">
              <div className="doc-title">
                <span className={r.ok ? 'status-dot ok' : 'status-dot bad'} />
                {r.title}
              </div>
              <div className="doc-sub">{new Date(r.time).toLocaleString()} · {r.detail}</div>
            </div>
            <div className="doc-actions">
              <button className="chip" onClick={() => { try { onOpen(documentFromJson(r.documentJson)); } catch (e) { onToast(String(e)); } }}>
                重新编辑
              </button>
              <button className="chip" disabled={!printerManager.isReady()} onClick={() => void reprint(r.documentJson)}>
                重新打印
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
