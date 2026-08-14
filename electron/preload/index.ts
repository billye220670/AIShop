import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 启动原生拖拽：同步 IPC（sendSync），确保主进程在 dragstart 事件上下文结束前
  // 就调用 event.sender.startDrag()。若用异步 send，等 IPC 到达时 Chromium
  // 的拖拽时间窗口已经关闭，导致拖拽立即失效。
  startDrag: (imageUrl: string) =>
    ipcRenderer.sendSync('image:native-drag', imageUrl),
  // 使用系统默认浏览器打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  // 更新标题栏颜色（主题切换）
  updateTitleBarColor: (bgColor: string, symbolColor: string) => ipcRenderer.invoke('update-titlebar-color', bgColor, symbolColor),
  // 自动更新相关 API
  checkForUpdate: () => ipcRenderer.invoke('app:check-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateAvailable: (callback: (...args: unknown[]) => void) => ipcRenderer.on('update-available', callback),
  onUpdateDownloaded: (callback: (...args: unknown[]) => void) => ipcRenderer.on('update-downloaded', callback),
  // 主进程转发的 Escape 按键（iframe 内部焦点也能收到），返回取消订阅函数
  onAppEscape: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:escape', listener);
    return () => ipcRenderer.removeListener('app:escape', listener);
  },
});
