export interface ElectronAPI {
  startDrag: (imageUrl: string) => void;
  openExternal: (url: string) => Promise<void>;
  updateTitleBarColor: (bgColor: string, symbolColor: string) => Promise<void>;
  // 自动更新
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateAvailable: (callback: (...args: unknown[]) => void) => void;
  onUpdateDownloaded: (callback: (...args: unknown[]) => void) => void;
  // 主进程转发的 Escape 按键（iframe 内部焦点也能收到），返回取消订阅函数
  onAppEscape: (callback: () => void) => () => void;
  // 主进程转发的 Ctrl+F（激活对话查找），返回取消订阅函数
  onFindRequested: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
