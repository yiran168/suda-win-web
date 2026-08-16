/**
 * 应用外壳：页面导航、主题应用、全局 Toast、启动日志。
 */
import { useEffect, useRef, useState } from 'react';
import { applyTheme } from './theme/themes';
import { loadPrefs } from './store/local';
import { installGlobalErrorHooks, logInfo } from './logging/logger';
import { registerAllUserFonts } from './data/fonts';
import { printerManager } from './transport/manager';
import { isElectron } from './platform';
import { LabelDocument } from './model/document';
import { setPrinterConfig } from './model/document';
import { HomePage, DocBatch } from './pages/HomePage';
import { EditorPage } from './pages/EditorPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';
import { HelpPage } from './pages/HelpPage';
import { LogsPage } from './pages/LogsPage';

type Page = 'home' | 'editor' | 'templates' | 'history' | 'settings' | 'about' | 'help' | 'logs';

const NAV: Array<{ id: Page; label: string; icon: string }> = [
  { id: 'home', label: '首页', icon: '🏠' },
  { id: 'templates', label: '模板', icon: '🗂️' },
  { id: 'history', label: '历史', icon: '🕘' },
  { id: 'settings', label: '设置', icon: '⚙️' },
];

export function App() {
  const [page, setPage] = useState<Page>('home');
  const [editorDoc, setEditorDoc] = useState<LabelDocument | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [editorBack, setEditorBack] = useState<Page>('home'); // 编辑器返回时回到来源页
  const editorDoneRef = useRef<((doc: LabelDocument) => void) | null>(null); // 编辑器返回时的回传（文档直印改页用）
  const [batch, setBatch] = useState<DocBatch | null>(null); // 文档直印批次：放这里，进编辑器再回来不丢
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [theme, setTheme] = useState(loadPrefs().theme);

  useEffect(() => {
    installGlobalErrorHooks();
    applyTheme(loadPrefs().theme);
    const p = loadPrefs();
    setPrinterConfig(p.headDots, p.dpi);
    void registerAllUserFonts();
    logInfo('system', `素打启动（${isElectron() ? 'Electron 客户端' : '浏览器网页版'}）`);
    void printerManager.autoReconnect();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  };

  const openDocument = (doc: LabelDocument, from: Page = 'home', onDone?: (edited: LabelDocument) => void) => {
    setEditorDoc(doc);
    setEditorKey((k) => k + 1);
    setEditorBack(from);
    editorDoneRef.current = onDone ?? null;
    setPage('editor');
  };

  /** 编辑器返回：先回传最新文档（有回传方时），再回到来源页 */
  const closeEditor = (doc: LabelDocument) => {
    const done = editorDoneRef.current;
    editorDoneRef.current = null;
    setPage(editorBack);
    done?.(doc);
  };

  const navigate = (p: Page) => setPage(p);

  const inEditor = page === 'editor' && editorDoc;

  return (
    <div className="app-shell">
      {!inEditor && (
        <header className="app-header">
          <div className="app-brand">
            <img src="./assets/app-icon.png" alt="素打" className="app-logo" />
            <span className="app-name">素打</span>
            <span className="app-tag">热敏打印创作工具</span>
          </div>
          <nav className="app-nav">
            {NAV.map((n) => (
              <button key={n.id} className={`nav-item${page === n.id ? ' active' : ''}`} onClick={() => navigate(n.id)}>
                <span>{n.icon}</span> {n.label}
              </button>
            ))}
          </nav>
        </header>
      )}

      <main className="app-main">
        {page === 'home' && (
          <HomePage
            onOpenDocument={openDocument}
            batch={batch}
            onBatchChange={setBatch}
            onGoSettings={() => navigate('settings')}
            onGoTemplates={() => navigate('templates')}
            onGoHistory={() => navigate('history')}
            onToast={showToast}
          />
        )}
        {inEditor && (
          <EditorPage key={editorKey} initial={editorDoc} onBack={closeEditor} onToast={showToast} />
        )}
        {page === 'templates' && <TemplatesPage onOpen={(doc) => openDocument(doc, 'templates')} onToast={showToast} />}
        {page === 'history' && <HistoryPage onOpen={(doc) => openDocument(doc, 'history')} onToast={showToast} />}
        {page === 'settings' && <SettingsPage onNavigate={(p: 'about' | 'help' | 'logs') => setPage(p)} onThemeChange={(id: string) => { setTheme(id); applyTheme(id); }} />}
        {page === 'about' && <SubPageShell title="关于素打" onBack={() => setPage('settings')}><AboutPage /></SubPageShell>}
        {page === 'help' && <SubPageShell title="使用方法" onBack={() => setPage('settings')}><HelpPage /></SubPageShell>}
        {page === 'logs' && <SubPageShell title="运行日志" onBack={() => setPage('settings')}><LogsPage /></SubPageShell>}
      </main>

      {toast && <div className="toast">{toast}</div>}
      <span hidden>{theme}</span>
    </div>
  );
}

function SubPageShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="subpage">
      <header className="subpage-header">
        <button className="btn" onClick={onBack}>← 返回设置</button>
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  );
}
