/** 运行日志页：查看 / 过滤 / 导出 / 清空，主题跟随。 */
import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import {
  LogCategory, LogLevel, clearLogs, exportLogs, getLogs, subscribeLogs,
} from '../logging/logger';

const LEVELS: Array<{ id: LogLevel | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'debug', label: '调试' },
  { id: 'info', label: '信息' },
  { id: 'warn', label: '警告' },
  { id: 'error', label: '错误' },
];

const CATEGORIES: Array<{ id: LogCategory | 'all'; label: string }> = [
  { id: 'all', label: '全部模块' },
  { id: 'transport', label: '连接' },
  { id: 'protocol', label: '协议' },
  { id: 'print', label: '打印' },
  { id: 'render', label: '渲染' },
  { id: 'docs', label: '文档' },
  { id: 'ui', label: '界面' },
  { id: 'system', label: '系统' },
];

export function LogsPage() {
  useSyncExternalStore(subscribeLogs, () => `${getLogs().length}-${getLogs().at(-1)?.time ?? 0}`);
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [category, setCategory] = useState<LogCategory | 'all'>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  const logs = getLogs().filter((l) =>
    (level === 'all' || l.level === level) && (category === 'all' || l.category === category));

  useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  });

  return (
    <div className="page logs-page">
      <div className="card logs-card">
        <div className="logs-toolbar">
          <span className="btn-group">
            {LEVELS.map((l) => (
              <button key={l.id} className={`chip${level === l.id ? ' active' : ''}`} onClick={() => setLevel(l.id)}>{l.label}</button>
            ))}
          </span>
          <select className="panel-select" value={category} onChange={(e) => setCategory(e.target.value as LogCategory | 'all')}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <label className="check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> 跟随最新</label>
          <button className="btn" onClick={exportLogs}>导出日志</button>
          <button className="btn danger" onClick={clearLogs}>清空</button>
        </div>
        <div className="hint-text" style={{ margin: '4px 0 8px' }}>
          打印异常时：保持现场 → 点「导出日志」→ 把生成的 .log 文件发给开发者。
        </div>
        <div ref={listRef} className="logs-list">
          {logs.length === 0 && <div className="empty-state">暂无日志。连接打印机或打印一次后这里会有记录。</div>}
          {logs.map((l, i) => {
            const t = new Date(l.time);
            const p = (n: number) => String(n).padStart(2, '0');
            return (
              <div key={i} className={`log-line level-${l.level}`}>
                <span className="log-time">{p(t.getHours())}:{p(t.getMinutes())}:{p(t.getSeconds())}</span>
                <span className={`log-badge badge-${l.level}`}>{l.level}</span>
                <span className="log-cat">{l.category}</span>
                <span className="log-msg">{l.message}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
