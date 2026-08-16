/**
 * 设置页：打印机与连接 / 设备校准 / 视觉主题 / 关于素打 / 使用方法 / 运行日志。
 * 所有入口与卡片只用 CSS 变量着色 —— 切换主题时全部跟随变化。
 */
import { useState } from 'react';
import { THEMES } from '../theme/themes';
import { AppPreferences, loadPrefs, savePrefs, paperFromPrefs } from '../store/local';
import { SOUND_OPTIONS, playPrintSound } from '../audio/printSound';
import { mmToDots, dotsToMm } from '../model/document';
import { NumberField } from '../components/NumberField';
import { calibrationDocument } from '../model/presets';
import { printDocument } from '../print/printJob';
import { sharedImageCache } from '../render/imageCache';
import { printerManager } from '../transport/manager';

interface Props {
  onNavigate: (page: 'about' | 'help' | 'logs') => void;
  onThemeChange: (id: string) => void;
}

export function SettingsPage({ onNavigate, onThemeChange }: Props) {
  const [prefs, setPrefs] = useState<AppPreferences>(loadPrefs());
  const upd = (patch: Partial<AppPreferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  return (
    <div className="page settings-page">
      <section className="card settings-card">
        <div className="settings-card-title">🖨️ 打印机与连接</div>
        <div className="settings-row">
          <span>打印协议</span>
          <select className="panel-select" value={prefs.protocol} onChange={(e) => upd({ protocol: e.target.value as AppPreferences['protocol'] })}>
            <option value="qring">Qring（私有握手，推荐）</option>
            <option value="escpos">通用 ESC/POS</option>
          </select>
        </div>
        <div className="settings-row">
          <span>串口波特率</span>
          <select className="panel-select" value={prefs.baud} onChange={(e) => upd({ baud: Number(e.target.value) })}>
            {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <span>自动重连上次设备</span>
          <button
            className={`chip${prefs.autoReconnect ? ' active' : ''}`}
            onClick={() => upd({ autoReconnect: !prefs.autoReconnect })}
          >
            {prefs.autoReconnect ? '已开启' : '已关闭'}
          </button>
          <span className="hint-text">启动 App 时自动连接上一次使用的打印机</span>
        </div>
        <div className="settings-row">
          <span>打印浓度（0–7）</span>
          <input type="range" min={0} max={7} value={prefs.density} onChange={(e) => upd({ density: Number(e.target.value) })} />
          <b>{prefs.density}</b>
        </div>
        <div className="settings-row">
          <span>打印后走纸（点）</span>
          <NumberField className="panel-input" min={0} max={400} value={prefs.feedDots}
            onCommit={(v) => upd({ feedDots: Math.round(v) })} />
        </div>
        <div className="hint-text">
          连接方式：系统蓝牙先配对打印机，Windows 会生成虚拟串口（COM），在首页「连接打印机」里选择对应串口即可。
        </div>
      </section>

      <section className="card settings-card">
        <div className="settings-card-title">📏 设备校准</div>
        <CalibrationFields prefs={prefs} onChange={upd} />
        <CalibrationTestPrint prefs={prefs} />
        <div className="hint-text">
          纸宽 10.0–57.0 mm 无极可调；小于 55 mm 的纸请确认靠左 / 居中 / 靠右装入。边框整体左右偏移调「横向微调」，起印位置上下偏移调「纵向偏移」，步进 0.1 mm。
          点「打印校准测试页」会打出带毫米刻度尺的边框页：边框完整＝纸宽与装纸方向正确；用刻度尺量出偏差后调整横向微调再重打（对齐安卓版的偏移校准流程）。
        </div>
      </section>

      <section className="card settings-card">
        <div className="settings-card-title">🔔 打印提示音</div>
        <div className="settings-row">
          <span>完成提示音</span>
          <select className="panel-select" value={prefs.printSound} onChange={(e) => upd({ printSound: e.target.value })}>
            {SOUND_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="chip" disabled={prefs.printSound === 'off'} onClick={() => playPrintSound(prefs.printSound)}>试听</button>
        </div>
        <div className="hint-text">
          {SOUND_OPTIONS.find((s) => s.id === prefs.printSound)?.hint}。每次打印完成时播放，声音由本地算法即时合成，不联网。
        </div>
      </section>

      <section className="card settings-card">
        <div className="settings-card-title">🎨 视觉主题</div>
        <div className="hint-text">每套主题拥有独立的背景、表面、字体与层级，设置页所有入口随之变化。</div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-tile${prefs.theme === t.id ? ' active' : ''}`}
              onClick={() => { upd({ theme: t.id }); onThemeChange(t.id); }}
            >
              <span className="theme-swatch" style={{
                background: `linear-gradient(135deg, ${t.vars['--bg']} 0%, ${t.vars['--surface']} 55%, ${t.vars['--primary']} 100%)`,
              }} />
              <span className="theme-name">{t.name}</span>
              <span className="theme-desc">{t.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card settings-card">
        <div className="settings-card-title">ℹ️ 应用</div>
        <button className="settings-entry" onClick={() => onNavigate('about')}>
          <span className="entry-icon">🐾</span>
          <span className="entry-main"><b>关于素打</b><i>版本、开源致谢与协议说明</i></span>
          <span className="entry-arrow">›</span>
        </button>
        <button className="settings-entry" onClick={() => onNavigate('help')}>
          <span className="entry-icon">📖</span>
          <span className="entry-main"><b>使用方法</b><i>从连接到打印的完整图文指南</i></span>
          <span className="entry-arrow">›</span>
        </button>
        <button className="settings-entry" onClick={() => onNavigate('logs')}>
          <span className="entry-icon">🧾</span>
          <span className="entry-main"><b>运行日志</b><i>查看连接 / 协议 / 打印过程，异常时可导出发给开发者</i></span>
          <span className="entry-arrow">›</span>
        </button>
      </section>
    </div>
  );
}

function CalibrationFields({ prefs, onChange }: {
  prefs: AppPreferences; onChange: (p: Partial<AppPreferences>) => void;
}) {
  return (
    <>
      <div className="settings-row">
        <span>实际纸宽（mm）</span>
        <input type="range" min={10} max={57} step={0.1} value={prefs.paperWidthMm}
          onChange={(e) => onChange({ paperWidthMm: Number(e.target.value) })} />
        <b>{prefs.paperWidthMm.toFixed(1)}</b>
      </div>
      {prefs.paperWidthMm < 55 && (
        <div className="settings-row">
          <span>装纸方向</span>
          <span className="btn-group">
            <button className={`chip${prefs.paperAnchor === 'left' ? ' active' : ''}`} onClick={() => onChange({ paperAnchor: 'left' })}>靠左装入</button>
            <button className={`chip${prefs.paperAnchor === 'center' ? ' active' : ''}`} onClick={() => onChange({ paperAnchor: 'center' })}>居中装入</button>
            <button className={`chip${prefs.paperAnchor === 'right' ? ' active' : ''}`} onClick={() => onChange({ paperAnchor: 'right' })}>靠右装入</button>
          </span>
        </div>
      )}
      <div className="settings-row">
        <span>打印头点数</span>
        <span className="btn-group">
          {[384, 456, 576].map((d) => (
            <button key={d} className={`chip${prefs.headDots === d ? ' active' : ''}`} onClick={() => onChange({ headDots: d })}>{d}</button>
          ))}
        </span>
        <NumberField className="panel-input" value={prefs.headDots} min={96} max={1248}
          onCommit={(v) => onChange({ headDots: Math.round(v) })} />
      </div>
      <div className="settings-row">
        <span>分辨率（dpi）</span>
        <span className="btn-group">
          {[203, 300].map((d) => (
            <button key={d} className={`chip${prefs.dpi === d ? ' active' : ''}`} onClick={() => onChange({ dpi: d })}>{d}</button>
          ))}
        </span>
        <NumberField className="panel-input" value={prefs.dpi} min={100} max={600}
          onCommit={(v) => onChange({ dpi: Math.round(v) })} />
      </div>
      <div className="settings-row">
        <span>横向微调（mm）</span>
        <NumberField className="panel-input" step={0.1} digits={1} value={prefs.offsetXMm}
          onCommit={(v) => onChange({ offsetXMm: v })} />
        <span>纵向偏移（mm）</span>
        <NumberField className="panel-input" step={0.1} digits={1} value={prefs.offsetYMm}
          onCommit={(v) => onChange({ offsetYMm: v })} />
      </div>
      <div className="hint-text">
        当前纸宽 ≈ {mmToDots(prefs.paperWidthMm)} 点（{prefs.dpi} dpi），打印头 {prefs.headDots} 点。
        {mmToDots(prefs.paperWidthMm) > prefs.headDots
          ? `纸宽超出打印头，实际可打印 ${prefs.headDots} 点（≈ ${dotsToMm(prefs.headDots)} mm）。`
          : '新建画布与文档直印都会使用这里的纸张设置。'}
      </div>
    </>
  );
}

/** 设备校准 · 打印校准测试页（移植自安卓 PaperCalibrationSheet 的测试打印） */
function CalibrationTestPrint({ prefs }: { prefs: AppPreferences }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true);
    setMsg('');
    try {
      const doc = calibrationDocument(paperFromPrefs());
      const r = await printDocument(doc, sharedImageCache, { density: prefs.density });
      setMsg(r.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-row">
      <span>偏移校准</span>
      <button className="chip" disabled={busy || !printerManager.isReady()} onClick={() => void run()}>
        {busy ? '打印中…' : printerManager.isReady() ? '打印校准测试页' : '未连接打印机'}
      </button>
      {msg && <span className="hint-text">{msg}</span>}
    </div>
  );
}
