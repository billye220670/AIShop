/**
 * 设置服务 - 基于 localStorage 存储
 */

export interface ProviderConfig {
  llm: string;
  image: string;
  video: string;
  search: string;
}

export interface AppSettings {
  providers: ProviderConfig;
  apiKeys: Record<string, string>;
}

const STORAGE_KEY = 'aishop_settings';

const DEFAULT_PROVIDERS: ProviderConfig = {
  llm: 'fastapi',
  image: 'fastapi',
  video: 'fastapi',
  search: 'bocha',
};

function getLocalSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    providers: { llm: 'fastapi', image: 'fastapi', video: 'fastapi', search: 'bocha' },
    apiKeys: {},
  };
}

function saveLocalSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const settingsService = {
  async getProvider(category: keyof ProviderConfig): Promise<string> {
    const settings = getLocalSettings();
    return settings.providers[category] || DEFAULT_PROVIDERS[category];
  },

  async setProvider(category: keyof ProviderConfig, provider: string): Promise<void> {
    const settings = getLocalSettings();
    settings.providers[category] = provider;
    saveLocalSettings(settings);
  },

  async getApiKey(provider: string): Promise<string> {
    const key = getLocalSettings().apiKeys[provider] || '';
    return key;
  },

  async setApiKey(provider: string, key: string): Promise<void> {
    const settings = getLocalSettings();
    if (key) {
      settings.apiKeys[provider] = key;
    } else {
      delete settings.apiKeys[provider];
    }
    saveLocalSettings(settings);
  },

  async getAllSettings(): Promise<AppSettings> {
    return getLocalSettings();
  },
};
