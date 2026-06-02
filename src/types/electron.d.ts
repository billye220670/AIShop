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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
