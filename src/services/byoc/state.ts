/**
 * BYOC 同步状态：deviceId、云端清单缓存、最近同步时刻，存于 IndexedDB 的 kv store。
 *
 * 与用户配置（localStorage）分离：配置属于"设置"，随时可改；这里的状态
 * 描述"同步这件事进行到哪里了"，改配置不应当动它。
 */
import { withDB } from '../../db/open';
import { listConversations, countMessages, listStoredRoles } from '../../db';
import type { SyncManifestV1 } from './types';

const KV_PREFIX = 'byoc:';

async function kvGet<T>(key: string): Promise<T | undefined> {
  const rec = await withDB(db => db.get('kv', KV_PREFIX + key));
  return rec?.value as T | undefined;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  await withDB(db => db.put('kv', { key: KV_PREFIX + key, value }));
}

/** 设备唯一标识：本机生成后持久化，用于清单里的"最后推送方"标记 */
export async function getDeviceId(): Promise<string> {
  const existing = await kvGet<string>('deviceId');
  if (existing) return existing;
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  await kvSet('deviceId', id);
  return id;
}

/** 最近一次从云端读到的清单（本地缓存的副本） */
export async function getCloudManifest(): Promise<SyncManifestV1 | undefined> {
  return kvGet<SyncManifestV1>('manifest');
}

export async function setCloudManifest(manifest: SyncManifestV1): Promise<void> {
  await kvSet('manifest', manifest);
}

/**
 * 本机删除记录（本地 tombstone）。
 *
 * 与云端 tombstone 分离：云端那份负责"删除跨设备传播"，这份负责"防止
 * 先拉后推时把刚删的又拉回来"——pullRemote 需要区分"本地删了"与
 * "从未拉过"，没有这份记录会把本地删除过的会话/历史/收藏重新拉回。
 */
export interface LocalTombstones {
  convs: string[];
  history: string[];
  favs: string[];
  roles: string[];
}

export async function getLocalTombstones(): Promise<LocalTombstones> {
  return (
    (await kvGet<LocalTombstones>('localTombstones')) ?? { convs: [], history: [], favs: [], roles: [] }
  );
}

export async function setLocalTombstones(t: LocalTombstones): Promise<void> {
  await kvSet('localTombstones', t);
}

/** 最近一次成功同步时刻（UI 展示用） */
export async function getLastSyncAt(): Promise<number | null> {
  return (await kvGet<number>('lastSyncAt')) ?? null;
}

export async function setLastSyncAt(time: number): Promise<void> {
  await kvSet('lastSyncAt', time);
}

/**
 * 统计待同步数量：updatedAt 晚于 syncedAt 的会话/消息/角色 + 未传播的本地删除。
 *
 * 注意不能只按 syncedAt == null 判断——流式覆盖写（putMessage）会保留旧的
 * syncedAt，但 updatedAt 已经前移，那也算待同步。
 *
 * 删除也必须计入：被删的会话/角色不在列表里，只按 updatedAt 统计
 * 会永远看不到删除。本地 tombstone 记录在云端确认删除后由 pullRemote 清除，
 * 所以「还有记录」= 删除尚未传播，必须让 60 秒轮询兜底触发同步。
 */
export async function countPending(): Promise<{ convs: number; messages: number; roles: number }> {
  const [tombstones, list, roles] = await Promise.all([
    getLocalTombstones(),
    listConversations(),
    listStoredRoles(),
  ]);
  const deleted =
    tombstones.convs.length +
    tombstones.history.length +
    tombstones.favs.length +
    tombstones.roles.length;
  const convs = list.filter(c => c.updatedAt > (c.syncedAt ?? 0));
  let messages = 0;
  for (const c of convs) messages += await countMessages(c.id);
  const pendingRoles = roles.filter(r => r.updatedAt > (r.syncedAt ?? 0)).length;
  return { convs: convs.length + deleted, messages, roles: pendingRoles };
}
