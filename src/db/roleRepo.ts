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

/** 提取角色名：优先用户自定义 title，留空回退提示词首行（截断到 20 字） */
export function resolveRoleName(systemPrompt: string, customTitle?: string): string {
  const title = customTitle?.trim();
  if (title) return title.length > 20 ? title.slice(0, 20) + '…' : title;
  const firstLine =
    systemPrompt
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 0) ?? '';
  return firstLine.length > 20 ? firstLine.slice(0, 20) + '…' : firstLine || '未命名角色';
}

/** 创建角色：title 可选（用户自定义，留空则从提示词首行自动提取），空提示词不创建 */
export function createRole(systemPrompt: string, title?: string): Promise<StoredRole> {
  const trimmed = systemPrompt.trim();
  if (!trimmed) return Promise.reject(new Error('提示词不能为空'));
  const now = Date.now();
  const rec: StoredRole = {
    id: newRoleId(),
    name: resolveRoleName(trimmed, title),
    systemPrompt: trimmed,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
  };
  return enqueue(QUEUE, () => withDB(db => db.put('roles', rec))).then(() => rec);
}

/**
 * 编辑角色：更新 title 与系统提示词，updatedAt 前移。
 *
 * syncedAt 保留旧值——countPending 按 updatedAt > syncedAt 判定待同步，
 * updatedAt 前移后编辑内容会自动进入下一轮 BYOC 增量同步，无需迁移 schema。
 */
export function updateRole(id: string, systemPrompt: string, title?: string): Promise<StoredRole> {
  const trimmed = systemPrompt.trim();
  if (!trimmed) return Promise.reject(new Error('提示词不能为空'));
  return enqueue(QUEUE, () =>
    withDB(async db => {
      const existing = await db.get('roles', id);
      if (!existing) throw new Error('角色不存在');
      const rec: StoredRole = {
        ...existing,
        name: resolveRoleName(trimmed, title),
        systemPrompt: trimmed,
        updatedAt: Date.now(),
      };
      await db.put('roles', rec);
      return rec;
    })
  );
}

export function deleteRole(id: string): Promise<void> {
  return enqueue(QUEUE, () => withDB(db => db.delete('roles', id)));
}
