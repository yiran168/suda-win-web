/**
 * 本地持久化：偏好设置 / 模板 / 历史记录（localStorage，JSON）。
 * 文档中的图片走 dataURL 内嵌，保证模板导出/导入自洽。
 */
import { LabelDocument, PaperSettings, defaultPaper, documentFromJson, documentToJson, mmToDots, setPrinterConfig } from '../model/document';

const KEY_PREFS = 'qrint.prefs.v1';
const KEY_TEMPLATES = 'qrint.templates.v1';
const KEY_HISTORY = 'qrint.history.v1';

export interface AppPreferences {
  theme: string;
  /** 打印协议：Qring 私有握手 / 通用 ESC/POS */
  protocol: 'qring' | 'escpos';
  baud: number;
  density: number;       // 打印浓度 0–7
  feedDots: number;      // 打印后走纸（新建画布的默认值）
  lastDevice: string;    // SPP 端口名（Web Serial 通道存 'webserial' 占位）
  lastChannel: 'spp' | 'webserial' | ''; // 上次成功连接的通道（自动重连用）
  /** 启动时自动重连上次设备 */
  autoReconnect: boolean;
  /** 打印完成提示音（音效 id，off = 关闭） */
  printSound: string;
  /* 设备校准（新建画布与文档直印的默认纸张来源） */
  paperWidthMm: number;
  paperAnchor: 'left' | 'center' | 'right';
  offsetXMm: number;
  offsetYMm: number;
  /** 打印头点数（一行最大加热点数，58mm 机型典型 384） */
  headDots: number;
  /** 打印头分辨率 dpi（典型 203） */
  dpi: number;
}

export function defaultPrefs(): AppPreferences {
  return {
    theme: 'mist', protocol: 'qring', baud: 115200, density: 1,
    feedDots: mmToDots(5), lastDevice: '', lastChannel: '', autoReconnect: true,
    printSound: 'paperTick',
    paperWidthMm: 57, paperAnchor: 'left', offsetXMm: 0, offsetYMm: 0,
    headDots: 384, dpi: 203,
  };
}

/** 校准偏好 → 默认纸张设置 */
export function paperFromPrefs(): PaperSettings {
  const p = loadPrefs();
  return {
    ...defaultPaper(),
    widthMm: p.paperWidthMm,
    anchor: p.paperAnchor,
    offsetXMm: p.offsetXMm,
    offsetYMm: p.offsetYMm,
    tailFeedDots: p.feedDots,
  };
}

export function loadPrefs(): AppPreferences {
  try {
    const raw = localStorage.getItem(KEY_PREFS);
    if (!raw) return defaultPrefs();
    const prefs = { ...defaultPrefs(), ...JSON.parse(raw) } as AppPreferences;
    // 迁移：旧版本默认走纸是 100 点，现默认改为 5mm；仍停留在旧默认值的跟随新默认
    if (prefs.feedDots === 100) prefs.feedDots = defaultPrefs().feedDots;
    return prefs;
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(p: AppPreferences): void {
  localStorage.setItem(KEY_PREFS, JSON.stringify(p));
  // 打印头点数 / 分辨率立即生效：画布、预览、打印位图共用 printerConfig
  setPrinterConfig(p.headDots, p.dpi);
}

/* --------------------------------- 模板 --------------------------------- */

export function loadTemplates(): LabelDocument[] {
  try {
    const raw = localStorage.getItem(KEY_TEMPLATES);
    if (!raw) return [];
    const list = JSON.parse(raw) as string[];
    return list.map((s) => { try { return documentFromJson(s); } catch { return null; } })
      .filter((d): d is LabelDocument => !!d);
  } catch { return []; }
}

export function saveTemplates(docs: LabelDocument[]): void {
  try {
    localStorage.setItem(KEY_TEMPLATES, JSON.stringify(docs.map(documentToJson)));
  } catch (e) {
    throw new Error('模板保存失败：本地存储空间不足（图片过大）');
  }
}

/* --------------------------------- 历史 --------------------------------- */

export interface HistoryRecord {
  id: string;
  time: number;
  title: string;
  ok: boolean;
  detail: string;
  documentJson: string; // 可一键重新编辑/重打
}

export function loadHistory(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(KEY_HISTORY);
    return raw ? (JSON.parse(raw) as HistoryRecord[]) : [];
  } catch { return []; }
}

export function appendHistory(rec: HistoryRecord): void {
  const list = [rec, ...loadHistory()].slice(0, 100);
  try {
    localStorage.setItem(KEY_HISTORY, JSON.stringify(list));
  } catch {
    list.pop();
    try { localStorage.setItem(KEY_HISTORY, JSON.stringify(list)); } catch { /* 放弃落盘 */ }
  }
}

export function clearHistory(): void {
  localStorage.removeItem(KEY_HISTORY);
}
