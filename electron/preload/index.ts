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
});
