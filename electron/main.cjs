/**
 * Electron 主进程：
 * - 窗口与图标
 * - SPP 串口 IPC（serialport，N-API 免重编译）
 * - 运行日志落盘（userData/logs/qrint-YYYY-MM-DD.log）
 * - app:// 自定义协议加载页面：file:// 是不透明源，blob SVG 图片会污染 canvas
 *   （toDataURL 抛 SecurityError，Word 导入/模板底图打印都会踩雷），
 *   换成标准安全 scheme 后渲染层拿到正常源，画布不再被污染
 */
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:7100';
const isPackaged = app.isPackaged;

// 必须在 app ready 之前注册为特权 scheme
const APP_SCHEME = 'app';
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** app://qrint/<path> → resources/app/dist/<path>，带路径逃逸防护 */
function installAppProtocol() {
  const distDir = path.join(__dirname, '..', 'dist');
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    const file = path.join(distDir, rel || 'index.html');
    if (file !== distDir && !file.startsWith(distDir + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

/* --------------------------------- 日志 --------------------------------- */

let logStream = null;
function logFilePath() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `qrint-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.log`);
}
ipcMain.on('log:append', (_e, line) => {
  try {
    if (!logStream) logStream = fs.createWriteStream(logFilePath(), { flags: 'a' });
    logStream.write(line + '\n');
  } catch { /* 日志永不抛出 */ }
});

/* --------------------------------- 串口 --------------------------------- */

/** @type {any|null} */
let port = null;
let rxBuffer = Buffer.alloc(0);

async function closePort() {
  if (port) {
    const p = port;
    port = null;
    await new Promise((resolve) => { try { p.close(() => resolve()); } catch { resolve(); } });
  }
}

ipcMain.handle('serial:list', async () => {
  try {
    const { SerialPort } = require('serialport');
    const list = await SerialPort.list();
    return list.map((p) => ({ path: p.path, friendlyName: p.friendlyName || p.path }));
  } catch (e) {
    return [];
  }
});

ipcMain.handle('serial:open', async (_e, pathName, baud) => {
  await closePort();
  const { SerialPort } = require('serialport');
  port = new SerialPort({ path: pathName, baudRate: baud || 115200, dataBits: 8, stopBits: 1, parity: 'none' });
  await new Promise((resolve, reject) => {
    port.once('open', resolve);
    port.once('error', reject);
  });
  rxBuffer = Buffer.alloc(0);
  port.on('data', (chunk) => { rxBuffer = Buffer.concat([rxBuffer, chunk]); });
  port.on('error', () => {});
  return true;
});

ipcMain.handle('serial:write', async (_e, data) => {
  if (!port) throw new Error('串口未打开');
  const buf = Buffer.from(data);
  await new Promise((resolve, reject) => {
    port.write(buf, (err) => (err ? reject(err) : resolve()));
  });
  return true;
});

ipcMain.handle('serial:read', async (_e, n, timeoutMs) => {
  const deadline = Date.now() + (timeoutMs || 1000);
  while (Date.now() < deadline) {
    if (rxBuffer.length >= n) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const take = rxBuffer.subarray(0, n);
  rxBuffer = rxBuffer.subarray(take.length);
  return take.buffer.slice(take.byteOffset, take.byteOffset + take.byteLength);
});

ipcMain.handle('serial:flush', async () => { rxBuffer = Buffer.alloc(0); return true; });
ipcMain.handle('serial:isOpen', async () => !!(port && port.isOpen));
ipcMain.handle('serial:close', async () => { await closePort(); return true; });

/* --------------------------------- 窗口 --------------------------------- */

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: '素打',
    icon: path.join(__dirname, '..', 'assets', 'app-icon.png'),
    backgroundColor: '#f5f4f0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 渲染层控制台错误也记入日志文件，方便排障
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) { // warning / error
      try {
        if (!logStream) logStream = fs.createWriteStream(logFilePath(), { flags: 'a' });
        logStream.write(`[renderer-${level === 3 ? 'ERROR' : 'WARN'}] ${message}\n`);
      } catch {}
    }
  });

  if (isPackaged) {
    win.loadURL(`${APP_SCHEME}://qrint/index.html`);
  } else {
    win.loadURL(DEV_URL);
  }
}

/* ------------------------------ 单实例与退出 ------------------------------ */

// 单实例锁：重复双击启动时激活已有窗口，避免多个实例各自残留进程树
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  installAppProtocol();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 所有窗口关闭后立即退出（任何平台），退出前释放串口与日志流，
// 保证应用退出后不残留任何素打进程
app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', (event) => {
  event.preventDefault(); // 等串口与日志流真正释放后再退
  const done = () => app.exit(0); // 强制结束主进程，Electron 会带走渲染/GPU/工具进程
  const guard = setTimeout(done, 1500); // 兜底：清理卡住也必须按时退出
  void (async () => {
    await closePort();
    try { logStream?.end(); } catch {}
    clearTimeout(guard);
    done();
  })();
});
