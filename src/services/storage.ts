/**
 * 小体积、需要同步读取的设置项。
 *
 * 会话与消息已迁到 IndexedDB（见 services/conversationStore 与 db/），
 * 这里只留首屏绘制期间就要读的东西——改成异步会闪一下。
 */
import type { ArtifactBlock } from '../types';

const MODEL_STORAGE_KEY = 'aishop_last_model';
const WEB_SEARCH_STORAGE_KEY = 'aishop_web_search_enabled';

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
