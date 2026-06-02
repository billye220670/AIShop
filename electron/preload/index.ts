import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  settings: {
    getProvider: (category: string) => ipcRenderer.invoke('settings:getProvider', category),
    setProvider: (category: string, provider: string) => ipcRenderer.invoke('settings:setProvider', category, provider),
    getApiKey: (provider: string) => ipcRenderer.invoke('settings:getApiKey', provider),
    setApiKey: (provider: string, key: string) => ipcRenderer.invoke('settings:setApiKey', provider, key),
    getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  },
});
