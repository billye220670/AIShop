/**
 * BYOC 同步状态：deviceId、云端清单缓存、最近同步时刻，存于 IndexedDB 的 kv store。
 *
 * 与用户配置（localStorage）分离：配置属于"设置"，随时可改；这里的状态
 * 描述"同步这件事进行到哪里了"，改配置不应当动它。
 */
import { withDB } from '../../db/open';
import {
  listConversations,
  countMessages,
  listStoredRoles,
  listStoredAssets,
  listStoredImageHistory,
} from '../../db';
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

/** 会话删除记录：at 为删除时刻，用于判断"云端新数据是否晚于删除" */
export interface ConvTombstone {
  id: string;
  at: number;
}

export interface LocalTombstones {
  convs: ConvTombstone[];
  history: string[];
  favs: string[];
  roles: string[];
  /** 「我的库」资产删除记录（新版本；favs 记录对 artifact 资产同样生效） */
  assets: string[];
}

/** 兼容旧格式（convs 为 string[]）：at 用 0，撤销判定时退化为缓存清单对比 */
function normalizeTombstones(raw: LocalTombstones | undefined): LocalTombstones {
  const t = raw ?? { convs: [], history: [], favs: [], roles: [], assets: [] };
  const convs = Array.isArray(t.convs)
    ? (t.convs as unknown[]).map(item =>
        typeof item === 'string' ? { id: item, at: 0 } : (item as ConvTombstone)
      )
    : [];
  return {
    convs,
    history: t.history ?? [],
    favs: t.favs ?? [],
    roles: t.roles ?? [],
    assets: t.assets ?? [],
  };
}

export async function getLocalTombstones(): Promise<LocalTombstones> {
  return normalizeTombstones(await kvGet<LocalTombstones>('localTombstones'));
}

export async function setLocalTombstones(t: LocalTombstones): Promise<void> {
  await kvSet('localTombstones', t);
}

/**
 * 事务化更新本地 tombstone：读-改-写在同一个 IDB 事务内完成。
 *
 * 旧实现是"读快照 → 改 → 整体写回"，同步（启动拉取/60 秒轮询/回前台）
 * 与删除动作并发时，同步进程会用旧快照覆盖掉 recordLocalDeletions 刚写入
 * 的删除记录，导致 pullRemote 看不到 tombstone、把已删会话又拉回来。
 */
export async function updateLocalTombstones(
  fn: (t: LocalTombstones) => void
): Promise<LocalTombstones> {
  return withDB(async db => {
    const tx = db.transaction('kv', 'readwrite');
    const rec = await tx.store.get(KV_PREFIX + 'localTombstones');
    const t = normalizeTombstones(rec?.value as LocalTombstones | undefined);
    fn(t);
    await tx.store.put({ key: KV_PREFIX + 'localTombstones', value: t });
    await tx.done;
    return t;
  });
}

/** 最近一次成功同步时刻（UI 展示用） */
export async function getLastSyncAt(): Promise<number | null> {
  return (await kvGet<number>('lastSyncAt')) ?? null;
}

export async function setLastSyncAt(time: number): Promise<void> {
  await kvSet('lastSyncAt', time);
}

/**
 * 已应用的云端条目版本：`{ assets: { id: ver }, roles: {...}, history: {...} }`。
 *
 * 为什么需要它：assets/roles/imageHistory 的拉取以前是「本地已有就跳过」，
 * 结果另一端的**修改**（重命名资产、编辑角色提示词、回填图片尺寸）永远传不过来，
 * 只有新增能同步。有了这份记账，拉取方就能把清单里的版本号与「上次应用过的版本」
 * 比较，发现云端改过就重新拉。
 *
 * 记在本地而不是复用记录自身的 syncedAt：syncedAt 是本机推送的凭据，
 * 与「收下的是云端哪个版本」是两件事，混用会让 LWW 判断自相矛盾。
 */
export interface AppliedVersions {
  assets: Record<string, number>;
  roles: Record<string, number>;
  history: Record<string, number>;
}

function normalizeApplied(raw: Partial<AppliedVersions> | undefined): AppliedVersions {
  return {
    assets: raw?.assets ?? {},
    roles: raw?.roles ?? {},
    history: raw?.history ?? {},
  };
}

export async function getAppliedVersions(): Promise<AppliedVersions> {
  return normalizeApplied(await kvGet<AppliedVersions>('appliedVersions'));
}

/** 事务化更新（与 tombstone 同理：同步与本地写入可能并发，快照写回会互相覆盖） */
export async function updateAppliedVersions(
  fn: (v: AppliedVersions) => void
): Promise<AppliedVersions> {
  return withDB(async db => {
    const tx = db.transaction('kv', 'readwrite');
    const rec = await tx.store.get(KV_PREFIX + 'appliedVersions');
    const v = normalizeApplied(rec?.value as Partial<AppliedVersions> | undefined);
    fn(v);
    await tx.store.put({ key: KV_PREFIX + 'appliedVersions', value: v });
    await tx.done;
    return v;
  });
}

/**
 * API 设置（providers + apiKeys）同步元数据。
 *
 * settings 是 localStorage 的单一 JSON 对象，不走 IndexedDB 表的
 * updatedAt/syncedAt 体系，这里单独记一份：updatedAt = 本机最后变更时刻
 * （setApiKey/setProvider 时前移），syncedAt = 最近一次成功推/拉时刻。
 * 冲突策略 LWW：updatedAt 大者胜，与角色/会话元数据一致。
 */
export interface SettingsSyncMeta {
  updatedAt: number;
  syncedAt: number;
}

export async function getSettingsSyncMeta(): Promise<SettingsSyncMeta | undefined> {
  return kvGet<SettingsSyncMeta>('settingsSyncMeta');
}

export async function setSettingsSyncMeta(meta: SettingsSyncMeta): Promise<void> {
  await kvSet('settingsSyncMeta', meta);
}

/** 标记本机 API 设置已变更（保留 syncedAt，push 阶段据此判定待推送） */
export async function markSettingsDirty(): Promise<void> {
  const meta = await getSettingsSyncMeta();
  await setSettingsSyncMeta({ updatedAt: Date.now(), syncedAt: meta?.syncedAt ?? 0 });
}

/**
 * 统计待同步数量：updatedAt 晚于 syncedAt 的会话/消息/角色 + 未传播的本地删除
 * + API 设置（开关开启且标记过变更时计 1）。
 *
 * 注意不能只按 syncedAt == null 判断——流式覆盖写（putMessage）会保留旧的
 * syncedAt，但 updatedAt 已经前移，那也算待同步。
 *
 * 删除也必须计入：被删的会话/角色不在列表里，只按 updatedAt 统计
 * 会永远看不到删除。本地 tombstone 记录在云端确认删除后由 pullRemote 清除，
 * 所以「还有记录」= 删除尚未传播，必须让 60 秒轮询兜底触发同步。
 */
export async function countPending(): Promise<{
  convs: number;
  messages: number;
  roles: number;
  settings: number;
  assets: number;
}> {
  const [tombstones, list, roles, settingsMeta, assets, history] = await Promise.all([
    getLocalTombstones(),
    listConversations(),
    listStoredRoles(),
    getSettingsSyncMeta(),
    listStoredAssets(),
    listStoredImageHistory(),
  ]);
  const deleted =
    tombstones.convs.length +
    tombstones.history.length +
    tombstones.favs.length +
    tombstones.roles.length +
    tombstones.assets.length;
  const convs = list.filter(c => c.updatedAt > (c.syncedAt ?? 0));
  let messages = 0;
  for (const c of convs) messages += await countMessages(c.id);
  const pendingRoles = roles.filter(r => r.updatedAt > (r.syncedAt ?? 0)).length;
  // 开关缺省开启；本地直读 localStorage（与 settingsService.getSyncApiSettings
  // 保持一致），避免 state → settingsService → state 的循环依赖
  let settingsEnabled = true;
  try {
    const raw = localStorage.getItem('aishop_settings');
    if (raw) settingsEnabled = JSON.parse(raw).syncApiSettings !== false;
  } catch { /* 缺省开启 */ }
  const pendingSettings =
    settingsEnabled && settingsMeta && settingsMeta.updatedAt > settingsMeta.syncedAt ? 1 : 0;
  // 资产与图片历史也必须计入：它们的变更只靠各自 hook 里那一次 3 秒防抖同步，
  // 那次失败（网络抖动、撞锁）就再也没有兜底了——轮询看不到就永远不会补推。
  // 图片历史没有 syncedAt，用「已应用的云端版本」当基准：本地 updatedAt 更新
  // 说明这条还没推上去（拉取与推送都会把 applied 对齐到当前版本）。
  const applied = await getAppliedVersions();
  const pendingAssets =
    assets.filter(a => a.updatedAt > (a.syncedAt ?? 0)).length +
    history.filter(h => (h.updatedAt ?? h.timestamp) > (applied.history[h.id] ?? 0)).length;
  return {
    convs: convs.length + deleted,
    messages,
    roles: pendingRoles,
    settings: pendingSettings,
    assets: pendingAssets,
  };
}
