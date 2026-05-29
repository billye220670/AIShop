import type { Conversation } from '../types';

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
  } catch {}
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
  } catch {}
}

export function loadWebSearchEnabled(): boolean {
  try {
    return localStorage.getItem(WEB_SEARCH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
