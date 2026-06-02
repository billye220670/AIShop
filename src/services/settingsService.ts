/**
 * 设置服务 - 前端侧封装
 * 在 Electron 环境通过 IPC 调用主进程
 * 非 Electron 环境 fallback 到 localStorage
 */

export interface ProviderConfig {
  llm: string;
  image: string;
  video: string;
}

export interface AppSettings {
  providers: ProviderConfig;
  apiKeys: Record<string, string>;
}

const STORAGE_KEY = 'aishop_settings';
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

// localStorage fallback（开发/调试用）
function getLocalSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    providers: { llm: 'fastapi', image: 'fastapi', video: 'fastapi' },
    apiKeys: {},
  };
}

function saveLocalSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// 统一接口
export const settingsService = {
  async getProvider(category: keyof ProviderConfig): Promise<string> {
    if (isElectron) {
      return window.electronAPI!.settings.getProvider(category);
    }
    return getLocalSettings().providers[category] || 'fastapi';
  },

  async setProvider(category: keyof ProviderConfig, provider: string): Promise<void> {
    if (isElectron) {
      await window.electronAPI!.settings.setProvider(category, provider);
      return;
    }
    const settings = getLocalSettings();
    settings.providers[category] = provider;
    saveLocalSettings(settings);
  },

  async getApiKey(provider: string): Promise<string> {
    if (isElectron) {
      return window.electronAPI!.settings.getApiKey(provider);
    }
    return getLocalSettings().apiKeys[provider] || '';
  },

  async setApiKey(provider: string, key: string): Promise<void> {
    if (isElectron) {
      await window.electronAPI!.settings.setApiKey(provider, key);
      return;
    }
    const settings = getLocalSettings();
    if (key) {
      settings.apiKeys[provider] = key;
    } else {
      delete settings.apiKeys[provider];
    }
    saveLocalSettings(settings);
  },

  async getAllSettings(): Promise<AppSettings> {
    if (isElectron) {
      return window.electronAPI!.settings.getAllSettings();
    }
    return getLocalSettings();
  },
};
