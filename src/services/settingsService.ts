/**
 * 设置服务 - 基于 localStorage 存储
 */
import type { ByocConfig, SyncedSettings } from './byoc/types';
import { DEFAULT_BYOC_CONFIG, BYOC_KEY_PREFIX, BYOC_SETTINGS_DIRTY_EVENT, SETTINGS_SYNCED_EVENT } from './byoc/types';
import { markSettingsDirty } from './byoc/state';

export interface ProviderConfig {
  llm: string;
  image: string;
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

/** 辅助模型分类：意图识别（生图前置判断）与生图优化（提示词扩写润色） */
export type AssistModelCategory = 'intentJudge' | 'promptOptimize';

/** 辅助模型设置；缺项回落 DEFAULT_ASSIST_MODEL */
export type AssistModels = Partial<Record<AssistModelCategory, string>>;

/** 辅助模型默认值：便宜快的小模型，判断/润色这类轻任务够用 */
export const DEFAULT_ASSIST_MODEL = 'doubao-1-5-pro-32k-250115';

export interface AppSettings {
  providers: ProviderConfig;
  apiKeys: Record<string, string>;
  /** 自建类提供商的服务地址覆盖（provider id → baseUrl）；未配置时用 config/providers 的内置默认值 */
  baseUrls?: Record<string, string>;
  compact?: CompactSettings;
  /** 辅助模型（意图识别 / 生图优化）；未配置的项回落 DEFAULT_ASSIST_MODEL */
  assistModels?: AssistModels;
  /** BYOC 云同步配置（自带 S3 兼容存储） */
  byoc?: ByocConfig;
  /** 是否随 BYOC 同步 API 设置（providers + apiKeys）；缺省视为开启 */
  syncApiSettings?: boolean;
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
  search: 'bocha',
};

function getLocalSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    providers: { llm: 'fastapi', image: 'fastapi', search: 'bocha' },
    apiKeys: {},
  };
}

function saveLocalSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * API 设置（providers / apiKeys）写入后标记 BYOC 待同步并通知调度侧。
 *
 * 标记用 kv store 的 updatedAt/syncedAt（与 IndexedDB 表同步同一套判断），
 * 事件触发立即同步（调度侧有防抖与 syncing 锁）；60 秒轮询兜底。
 */
function notifySettingsChanged(): void {
  void markSettingsDirty();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BYOC_SETTINGS_DIRTY_EVENT));
  }
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
    notifySettingsChanged();
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
    notifySettingsChanged();
  },

  /** 自建提供商的服务地址；未配置返回空串，由调用方回落内置默认值 */
  async getBaseUrl(provider: string): Promise<string> {
    return (getLocalSettings().baseUrls?.[provider] || '').trim();
  },

  async setBaseUrl(provider: string, baseUrl: string): Promise<void> {
    const settings = getLocalSettings();
    const next = { ...(settings.baseUrls || {}) };
    const trimmed = baseUrl.trim();
    if (trimmed) {
      next[provider] = trimmed;
    } else {
      delete next[provider];
    }
    settings.baseUrls = next;
    saveLocalSettings(settings);
    notifySettingsChanged();
  },

  async getAllSettings(): Promise<AppSettings> {
    return getLocalSettings();
  },

  /** 辅助模型；未配置回落 DEFAULT_ASSIST_MODEL */
  async getAssistModel(category: AssistModelCategory): Promise<string> {
    return getLocalSettings().assistModels?.[category] || DEFAULT_ASSIST_MODEL;
  },

  async setAssistModel(category: AssistModelCategory, model: string): Promise<void> {
    const settings = getLocalSettings();
    settings.assistModels = { ...(settings.assistModels || {}), [category]: model };
    saveLocalSettings(settings);
    notifySettingsChanged();
  },

  getCompactSettings(): CompactSettings {
    const stored = getLocalSettings().compact;
    // 触发阈值与热窗口已写死为推荐值（不再向用户暴露），仅压缩模型可配置
    return {
      ...DEFAULT_COMPACT_SETTINGS,
      model: stored?.model || DEFAULT_COMPACT_SETTINGS.model,
    };
  },

  setCompactSettings(patch: Partial<CompactSettings>): void {
    const settings = getLocalSettings();
    settings.compact = { ...DEFAULT_COMPACT_SETTINGS, ...(settings.compact || {}), ...patch };
    saveLocalSettings(settings);
  },

  getByocSettings(): ByocConfig {
    const stored = getLocalSettings().byoc;
    // 对象前缀写死为 PortAI（不向用户暴露），忽略存储中的旧值
    return { ...DEFAULT_BYOC_CONFIG, ...(stored ?? {}), prefix: BYOC_KEY_PREFIX };
  },

  setByocSettings(patch: Partial<ByocConfig>): void {
    const settings = getLocalSettings();
    settings.byoc = { ...DEFAULT_BYOC_CONFIG, ...(settings.byoc ?? {}), ...patch };
    saveLocalSettings(settings);
  },

  /** 是否随 BYOC 同步 API 设置；缺省视为开启（用户选择"默认开启"） */
  getSyncApiSettings(): boolean {
    return getLocalSettings().syncApiSettings !== false;
  },

  setSyncApiSettings(enabled: boolean): void {
    const settings = getLocalSettings();
    settings.syncApiSettings = enabled;
    saveLocalSettings(settings);
    if (enabled) notifySettingsChanged();
  },

  /** 取待同步的 API 设置子集（providers + apiKeys + assistModels，不含 byoc 配置/主题等） */
  getSyncedSettings(): SyncedSettings {
    const settings = getLocalSettings();
    return {
      providers: {
        llm: settings.providers.llm || DEFAULT_PROVIDERS.llm,
        image: settings.providers.image || DEFAULT_PROVIDERS.image,
        search: settings.providers.search || DEFAULT_PROVIDERS.search,
      },
      apiKeys: { ...settings.apiKeys },
      baseUrls: { ...(settings.baseUrls || {}) },
      assistModels: { ...(settings.assistModels || {}) },
    };
  },

  /**
   * 应用云端拉回的 API 设置：只覆盖 providers/apiKeys，保留本机其余设置；
   * 写回后发事件让设置面板重读（BYOC 同步完成事件由同步侧 dispatch）。
   */
  applySyncedSettings(synced: SyncedSettings): void {
    const settings = getLocalSettings();
    settings.providers = { ...DEFAULT_PROVIDERS, ...synced.providers };
    settings.apiKeys = { ...synced.apiKeys };
    // 旧版本云端数据没有 baseUrls/assistModels，保留本机已配值，避免同步把本地配置清空
    if (synced.baseUrls) settings.baseUrls = { ...synced.baseUrls };
    if (synced.assistModels) settings.assistModels = { ...synced.assistModels };
    saveLocalSettings(settings);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SETTINGS_SYNCED_EVENT));
    }
  },
};
