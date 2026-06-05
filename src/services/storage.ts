import type { Conversation, ArtifactBlock } from '../types';

const STORAGE_KEY = 'aishop_conversations';
const MODEL_STORAGE_KEY = 'aishop_last_model';
const WEB_SEARCH_STORAGE_KEY = 'aishop_web_search_enabled';

export function loadConversations(): Conversation[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data) as Conversation[];
    // 兼容旧数据：缺失 isRenamed 字段则补默认值 false
    return parsed.map(c => ({ ...c, isRenamed: c.isRenamed ?? false }));
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (e) {
    console.error('Failed to save conversations:', e);
  }
}

export function createConversation(modelId: string): Conversation {
  return {
    id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
    title: '新对话',
    messages: [],
    selectedModel: modelId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isRenamed: false,
  };
}

export function saveLastModel(modelId: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  } catch { /* ignore */ }
}

export function loadLastModel(): string | null {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveWebSearchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(WEB_SEARCH_STORAGE_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
}

export function loadWebSearchEnabled(): boolean {
  try {
    return localStorage.getItem(WEB_SEARCH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function loadTheme(): string {
  return localStorage.getItem('aishop_theme') || 'green';
}

export function saveTheme(themeId: string): void {
  localStorage.setItem('aishop_theme', themeId);
}

const FAVORITE_ARTIFACTS_KEY = 'aishop_favorite_artifacts';

export interface FavoriteArtifactData {
  artifact: ArtifactBlock;
  thumbnail: string; // base64 data URL (1:1 正方形 JPEG)
  favoritedAt: number;
}

export function loadFavoriteArtifacts(): FavoriteArtifactData[] {
  try {
    const data = localStorage.getItem(FAVORITE_ARTIFACTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveFavoriteArtifacts(artifacts: FavoriteArtifactData[]): void {
  try {
    localStorage.setItem(FAVORITE_ARTIFACTS_KEY, JSON.stringify(artifacts));
  } catch (e) {
    console.error('Failed to save favorite artifacts:', e);
  }
}
