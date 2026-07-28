export interface ElectronSettingsAPI {
  getProvider: (category: string) => Promise<string>;
  setProvider: (category: string, provider: string) => Promise<void>;
  getApiKey: (provider: string) => Promise<string>;
  setApiKey: (provider: string, key: string) => Promise<void>;
  getAllSettings: () => Promise<{
    providers: { llm: string; image: string; video: string };
    apiKeys: Record<string, string>;
  }>;
}

export interface ElectronAPI {
  settings: ElectronSettingsAPI;
  imageGenerate: (url: string, body: string, apiKey: string) => Promise<{
    error: boolean;
    status?: number;
    body?: string;
    data?: unknown;
  }>;
  startDrag: (imageUrl: string) => void;
  saveImageLocal: (url: string, fileName: string) => Promise<string | null>;
  getLocalImagePath: (fileName: string) => Promise<string>;
  readImageAsBase64: (imageUrl: string) => Promise<string | null>;
  saveImageToDesktop: (imageUrl: string) => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  fetchBilling: (url: string, apiKey: string) => Promise<{
    error: boolean;
    status?: number;
    body?: string;
    data?: unknown;
  }>;
  saveMarkdown: (content: string, defaultName: string) => Promise<{
    success: boolean;
    canceled?: boolean;
    filePath?: string;
    error?: string;
  }>;
  openExternal: (url: string) => Promise<void>;
  updateTitleBarColor: (bgColor: string, symbolColor: string) => Promise<void>;
  // 自动更新
  checkForUpdate: () => Promise<void>;
  startDownload: () => Promise<void>;
  onUpdateAvailable: (callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
