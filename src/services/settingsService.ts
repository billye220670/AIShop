/**
 * 设置服务 - 前端侧封装
 * 在 Electron 环境通过 IPC 调用主进程
 * 非 Electron 环境 fallback 到 localStorage
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
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

// localStorage fallback（开发/调试用）
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

// 统一接口
export const settingsService = {
  async getProvider(category: keyof ProviderConfig): Promise<string> {
    if (isElectron) {
      return window.electronAPI!.settings.getProvider(category);
    }
    const settings = getLocalSettings();
    // 确保所有必填字段都存在
    const allProviders = {
      llm: 'fastapi',
      image: 'fastapi',
      video: 'fastapi',
      search: 'bocha',
      ...settings.providers,
    };
    return allProviders[category] || 'fastapi';
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
      const key = await window.electronAPI!.settings.getApiKey(provider);
      console.log(`[getApiKey] provider=${provider}, key=${key ? '存在' : '不存在'}`);
      return key;
    }
    const key = getLocalSettings().apiKeys[provider] || '';
    console.log(`[getApiKey] 浏览器模式 provider=${provider}, key=${key ? '存在' : '不存在'}`);
    return key;
  },

  async setApiKey(provider: string, key: string): Promise<void> {
    if (isElectron) {
      await window.electronAPI!.settings.setApiKey(provider, key);
      console.log(`[setApiKey] provider=${provider}, key=${key ? '已设置' : '已删除'}`);
      return;
    }
    const settings = getLocalSettings();
    if (key) {
      settings.apiKeys[provider] = key;
    } else {
      delete settings.apiKeys[provider];
    }
    saveLocalSettings(settings);
    console.log(`[setApiKey] 浏览器模式 provider=${provider}, key=${key ? '已保存' : '已删除'}`);
  },

  async getAllSettings(): Promise<AppSettings> {
    if (isElectron) {
      const settings = await window.electronAPI!.settings.getAllSettings();
      console.log(`[getAllSettings] providers=`, settings.providers);
      console.log(`[getAllSettings] apiKeys=`, settings.apiKeys);
      
      // 补全默认的 search 字段
      const completeProviders = {
        llm: 'fastapi',
        image: 'fastapi',
        video: 'fastapi',
        search: 'bocha',
        ...settings.providers,
      };
      
      return {
        providers: completeProviders as ProviderConfig,
        apiKeys: settings.apiKeys,
      };
    }
    return getLocalSettings();
  },
};
