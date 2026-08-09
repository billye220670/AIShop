/**
 * 用户自定义角色（系统提示词预设）。
 *
 * 本质是把一段系统提示词存成可复用、可切换的"角色"：选中角色后，
 * 发给模型的 system prompt 完全由该角色决定（再按功能开关动态拼接
 * artifact / 全网搜索提示词，见 useChat 的 buildSystemPrompt）。
 * 记录带 updatedAt/syncedAt，随 BYOC 增量同步跨设备。
 */
import { withDB, enqueue } from './open';
import type { StoredRole } from './schema';

const QUEUE = 'roles';

export interface RoleData {
  id: string;
  name: string;
  systemPrompt: string;
  createdAt: number;
}

function fromStored(rec: StoredRole): RoleData {
  return {
    id: rec.id,
    name: rec.name,
    systemPrompt: rec.systemPrompt,
    createdAt: rec.createdAt,
  };
}

export function newRoleId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** 按创建时间升序列出所有角色 */
export async function listRoles(): Promise<RoleData[]> {
  const recs = await withDB(db => db.getAllFromIndex('roles', 'by_createdAt'));
  return recs.map(fromStored);
}

/** 读取原始存盘记录（云同步用），字段保持原样 */
export async function listStoredRoles(): Promise<StoredRole[]> {
  return withDB(db => db.getAllFromIndex('roles', 'by_createdAt'));
}

/** 创建角色：名字从提示词首行自动提取（截断到 20 字），空提示词不创建 */
export function createRole(systemPrompt: string): Promise<StoredRole> {
  const trimmed = systemPrompt.trim();
  if (!trimmed) return Promise.reject(new Error('提示词不能为空'));
  const firstLine =
    trimmed
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 0) ?? '';
  const name = firstLine.length > 20 ? firstLine.slice(0, 20) + '…' : firstLine || '未命名角色';
  const now = Date.now();
  const rec: StoredRole = {
    id: newRoleId(),
    name,
    systemPrompt: trimmed,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
  };
  return enqueue(QUEUE, () => withDB(db => db.put('roles', rec))).then(() => rec);
}

export function deleteRole(id: string): Promise<void> {
  return enqueue(QUEUE, () => withDB(db => db.delete('roles', id)));
}
