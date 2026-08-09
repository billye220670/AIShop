/**
 * 小体积、需要同步读取的设置项。
 *
 * 会话与消息已迁到 IndexedDB（见 services/conversationStore 与 db/），
 * 这里只留首屏绘制期间就要读的东西——改成异步会闪一下。
 */
const MODEL_STORAGE_KEY = 'aishop_last_model';
const WEB_SEARCH_STORAGE_KEY = 'aishop_web_search_enabled';
const LAST_ACTIVE_CONVERSATION_KEY = 'aishop_last_active_conversation_id';

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

/** 记住最后一次停留的会话 id，方便切后台/被系统杀进程后重新打开时能恢复原样 */
export function saveLastActiveConversationId(id: string): void {
  try {
    localStorage.setItem(LAST_ACTIVE_CONVERSATION_KEY, id);
  } catch { /* ignore */ }
}

export function loadLastActiveConversationId(): string | null {
  try {
    return localStorage.getItem(LAST_ACTIVE_CONVERSATION_KEY);
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

const SELECTED_ROLE_ID_KEY = 'aishop_selected_role_id';

/** 当前选中的自定义角色 id；空串表示使用默认角色（PortAI） */
export function saveSelectedRoleId(roleId: string): void {
  try {
    localStorage.setItem(SELECTED_ROLE_ID_KEY, roleId);
  } catch { /* ignore */ }
}

export function loadSelectedRoleId(): string {
  try {
    return localStorage.getItem(SELECTED_ROLE_ID_KEY) || '';
  } catch {
    return '';
  }
}

export function loadTheme(): string {
  try {
    return localStorage.getItem('aishop_theme') || 'green';
  } catch {
    return 'green';
  }
}

export function saveTheme(themeId: string): void {
  try {
    localStorage.setItem('aishop_theme', themeId);
  } catch { /* ignore */ }
}

export type ColorMode = 'light' | 'dark';

export function loadMode(): ColorMode {
  try {
    const v = localStorage.getItem('aishop_mode');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return 'dark'; // 向后兼容：旧版无此 key 默认暗色
}

export function saveMode(mode: ColorMode): void {
  try {
    localStorage.setItem('aishop_mode', mode);
  } catch { /* ignore */ }
}

// Artifact 收藏已迁到 IndexedDB，见 db/favoriteRepo。
