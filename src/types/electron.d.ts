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
  startDrag: (localPath: string, fileName: string) => void;
  saveImageLocal: (url: string, fileName: string) => Promise<string | null>;
  getLocalImagePath: (fileName: string) => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
