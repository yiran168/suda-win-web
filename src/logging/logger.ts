/**
 * 运行日志：环形缓冲 + 可选落盘（Electron 主进程写文件）。
 * 打印异常时在「设置 → 运行日志」一键导出，发回即可定位问题。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'ui' | 'transport' | 'protocol' | 'render' | 'docs' | 'print' | 'system';

export interface LogEntry {
  time: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
}

const MAX_ENTRIES = 2000;
const buffer: LogEntry[] = [];
const listeners = new Set<() => void>();

export function log(level: LogLevel, category: LogCategory, message: string): void {
  const entry: LogEntry = { time: Date.now(), level, category, message };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  // Electron 环境落盘；纯网页环境只留在内存，导出时生成文件
  try {
    window.qrintLog?.append(formatLine(entry));
  } catch { /* 日志永不抛出 */ }
  listeners.forEach((fn) => fn());
}

export const logDebug = (c: LogCategory, m: string) => log('debug', c, m);
export const logInfo = (c: LogCategory, m: string) => log('info', c, m);
export const logWarn = (c: LogCategory, m: string) => log('warn', c, m);
export const logError = (c: LogCategory, m: string) => log('error', c, m);

export function getLogs(): readonly LogEntry[] {
  return buffer;
}

export function clearLogs(): void {
  buffer.length = 0;
  listeners.forEach((fn) => fn());
}

export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function formatLine(e: LogEntry): string {
  const t = new Date(e.time);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${p(t.getMilliseconds(), 3)}`;
  return `[${ts}] [${e.level.toUpperCase().padEnd(5)}] [${e.category}] ${e.message}`;
}

/** 导出全部日志为文本（触发浏览器下载）。 */
export function exportLogs(): void {
  const header = [
    '素打桌面端 运行日志导出',
    `导出时间: ${new Date().toLocaleString()}`,
    `平台: ${navigator.userAgent}`,
    `条目数: ${buffer.length}`,
    '─'.repeat(60),
    '',
  ].join('\n');
  const body = buffer.map(formatLine).join('\n');
  const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qrint-log-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 捕获未处理异常进日志（不拦截默认行为）。 */
export function installGlobalErrorHooks(): void {
  window.addEventListener('error', (ev) => {
    logError('system', `未捕获异常: ${ev.message} @ ${ev.filename}:${ev.lineno}`);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    logError('system', `未处理的 Promise 拒绝: ${String(ev.reason)}`);
  });
}
