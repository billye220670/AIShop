import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  settings: {
    getProvider: (category: string) => ipcRenderer.invoke('settings:getProvider', category),
    setProvider: (category: string, provider: string) => ipcRenderer.invoke('settings:setProvider', category, provider),
    getApiKey: (provider: string) => ipcRenderer.invoke('settings:getApiKey', provider),
    setApiKey: (provider: string, key: string) => ipcRenderer.invoke('settings:setApiKey', provider, key),
    getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  },
  // 图片生成通过主进程发起，绕过 CORS 和浏览器网络限制
  imageGenerate: (url: string, body: string, apiKey: string) =>
    ipcRenderer.invoke('image:generate', url, body, apiKey),
  // 启动原生拖拽：同步 IPC（sendSync），确保主进程在 dragstart 事件上下文结束前
  // 就调用 event.sender.startDrag()。若用异步 send，等 IPC 到达时 Chromium
  // 的拖拽时间窗口已经关闭，导致拖拽立即失效。
  startDrag: (imageUrl: string) =>
    ipcRenderer.sendSync('image:native-drag', imageUrl),
  // 保存图片到本地磁盘
  saveImageLocal: (url: string, fileName: string) =>
    ipcRenderer.invoke('image:save-local', url, fileName),
  // 获取本地图片绝对路径
  getLocalImagePath: (fileName: string) =>
    ipcRenderer.invoke('image:get-local-path', fileName),
  // 保存 Markdown 文件
  saveMarkdown: (content: string, defaultName: string) =>
    ipcRenderer.invoke('file:save-markdown', content, defaultName),
  // 使用系统默认浏览器打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  // 更新标题栏颜色（主题切换）
  updateTitleBarColor: (bgColor: string, symbolColor: string) => ipcRenderer.invoke('update-titlebar-color', bgColor, symbolColor),
  // 自动更新相关 API
  checkForUpdate: () => ipcRenderer.invoke('app:check-update'),
  startDownload: () => ipcRenderer.invoke('app:start-download'),
  onUpdateAvailable: (callback: (...args: unknown[]) => void) => ipcRenderer.on('update-available', callback),
});
