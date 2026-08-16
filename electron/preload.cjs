/** preload：向渲染层暴露串口与日志桥（contextIsolation 下的最小面）。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qrintSerial', {
  available: true,
  list: () => ipcRenderer.invoke('serial:list'),
  open: (path, baud) => ipcRenderer.invoke('serial:open', path, baud),
  write: (data) => ipcRenderer.invoke('serial:write', data),
  read: (n, timeoutMs) => ipcRenderer.invoke('serial:read', n, timeoutMs),
  flush: () => ipcRenderer.invoke('serial:flush'),
  close: () => ipcRenderer.invoke('serial:close'),
  isOpen: () => ipcRenderer.invoke('serial:isOpen'),
});

contextBridge.exposeInMainWorld('qrintLog', {
  append: (line) => ipcRenderer.send('log:append', line),
});
