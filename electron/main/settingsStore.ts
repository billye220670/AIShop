import { safeStorage } from 'electron';
import Store from 'electron-store';

export interface ProviderConfig {
  llm: string;      // 'fastapi' | 其他（预留扩展）
  image: string;    // 'fastapi' | 其他
  video: string;    // 'fastapi' | 其他
  search: string;   // 'bocha' | 其他
}

export interface StoredSettings {
  providers: ProviderConfig;
  apiKeys: Record<string, string>; // provider id -> encrypted base64 string
}

const DEFAULT_SETTINGS: StoredSettings = {
  providers: {
    llm: 'fastapi',
    image: 'fastapi',
    video: 'fastapi',
    search: 'bocha',
  },
  apiKeys: {},
};

const store = new Store<StoredSettings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
});

// 加密 API Key
function encryptKey(plainText: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = safeStorage.encryptString(plainText);
    return buffer.toString('base64');
  }
  // fallback: 明文存储（不推荐，但在某些 Linux 环境无 libsecret 时需要）
  console.warn('[settingsStore] Encryption not available, storing key in plain text');
  return `plain:${plainText}`;
}

// 解密 API Key
function decryptKey(stored: string): string {
  if (stored.startsWith('plain:')) {
    return stored.slice(6);
  }
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(stored, 'base64');
    return safeStorage.decryptString(buffer);
  }
  // 无法解密
  console.warn('[settingsStore] Cannot decrypt key, encryption not available');
  return '';
}

// 获取提供商配置
export function getProvider(category: keyof ProviderConfig): string {
  const providers = store.get('providers', DEFAULT_SETTINGS.providers);
  return providers[category] || 'fastapi';
}

// 设置提供商
export function setProvider(category: keyof ProviderConfig, provider: string): void {
  const providers = store.get('providers', DEFAULT_SETTINGS.providers);
  providers[category] = provider;
  store.set('providers', providers);
}

// 获取 API Key（解密后返回）
export function getApiKey(provider: string): string {
  const apiKeys = store.get('apiKeys', {});
  const encrypted = apiKeys[provider];
  if (!encrypted) return '';
  return decryptKey(encrypted);
}

// 设置 API Key（加密后存储）
export function setApiKey(provider: string, key: string): void {
  const apiKeys = store.get('apiKeys', {});
  if (key) {
    apiKeys[provider] = encryptKey(key);
  } else {
    delete apiKeys[provider];
  }
  store.set('apiKeys', apiKeys);
}

// 获取所有设置（API Key 解密后返回）
export function getAllSettings(): { providers: ProviderConfig; apiKeys: Record<string, string> } {
  const providers = store.get('providers', DEFAULT_SETTINGS.providers);
  const encryptedKeys = store.get('apiKeys', {});
  const decryptedKeys: Record<string, string> = {};

  for (const [provider, encrypted] of Object.entries(encryptedKeys)) {
    decryptedKeys[provider] = decryptKey(encrypted);
  }

  return { providers, apiKeys: decryptedKeys };
}
