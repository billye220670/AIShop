/**
 * 设置服务 - 基于 localStorage 存储
 */

export interface ProviderConfig {
  llm: string;
  image: string;
  video: string;
  search: string;
}

export interface CompactSettings {
  /** 执行压缩的模型（可与聊天模型不同，通常选便宜的小模型） */
  model: string;
  /** 到达上下文上限的多少比例时自动压缩 */
  threshold: number;
  /** 永远逐字保留的最近消息条数 */
  hotWindowSize: number;
}

export interface AppSettings {
  providers: ProviderConfig;
  apiKeys: Record<string, string>;
  compact?: CompactSettings;
}

export const DEFAULT_COMPACT_SETTINGS: CompactSettings = {
  model: 'gpt-5.4-nano',
  // 0.7 是刻意保守的值：压缩会改写 prompt 前缀、摧毁 cached reads 折扣，
  // 所以宁可攒到较高水位一次压掉一大段，也不要频繁小压缩。
  threshold: 0.7,
  hotWindowSize: 16,
};

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

  getCompactSettings(): CompactSettings {
    const stored = getLocalSettings().compact;
    return { ...DEFAULT_COMPACT_SETTINGS, ...(stored || {}) };
  },

  setCompactSettings(patch: Partial<CompactSettings>): void {
    const settings = getLocalSettings();
    settings.compact = { ...DEFAULT_COMPACT_SETTINGS, ...(settings.compact || {}), ...patch };
    saveLocalSettings(settings);
  },
};
