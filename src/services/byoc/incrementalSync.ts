/**
 * 增量双向同步引擎（BYOC 第二阶段能力）。
 *
 * 原理：schema 从设计之初就为同步预留了 updatedAt/syncedAt——
 * "推送 syncedAt 为空的记录，不需要 CRDT"。这里把判断收紧为
 * `updatedAt > syncedAt`：流式覆盖写会保留旧 syncedAt 但更新 updatedAt，
 * 只查 null 会漏掉这类变更。
 *
 * 桶内布局（prefix = 用户配置的 prefix，默认 aishop）：
 *   sync/v1/manifest.json                 云端"目录"，每轮推送整体重写
 *   sync/v1/convs/{convId}.json           会话元数据
 *   sync/v1/msgs/{convId}/{msgId}.json    单条消息（原样存盘格式）
 *   sync/v1/nodes/{convId}/{nodeId}.json  上下文节点（派生数据，可重建）
 *   sync/v1/blobs/{sha256}                二进制原样（内容寻址，全局去重）
 *   sync/v1/history/{id}.json + index.json 图片生成历史
 *   sync/v1/favs/{id}.json + index.json   收藏
 *   sync/v1/roles/{id}.json + index.json  角色（系统提示词预设）
 *
 * 冲突策略：消息追加式直接并入；会话元数据 last-write-wins（updatedAt 大者胜）；
 * 删除走 manifest 里的 tombstone（数据只增不减是安全方向）。
 */
import {
  withDB,
  enqueue,
} from '../../db/open';
import {
  listConversations,
  getConversation,
  getStoredMessages,
  countMessages,
  getBlob,
  putBlob,
  retainBlobs,
  listNodes,
  putNode,
  deleteNode,
  indexMessage,
  listStoredImageHistory,
  deleteImageHistoryItem,
  listStoredFavorites,
  removeFavorite,
  listStoredRoles,
  deleteRole,
} from '../../db';
import { collectMessageBlobIds } from '../../db/messageCodec';
import { deleteConversation } from '../../db/conversationRepo';
import type {
  StoredConversation,
  StoredMessage,
  StoredContextNode,
  StoredImageHistoryItem,
  StoredFavoriteArtifact,
  StoredRole,
} from '../../db/schema';
import { createS3Client, type S3Client } from './s3Client';
import type { ByocConfig, SyncManifestV1, SyncResult } from './types';
import {
  getDeviceId,
  setCloudManifest,
  getCloudManifest,
  getLocalTombstones,
  setLocalTombstones,
} from './state';

const SCHEMA = 'aishop-sync-v1';
const SYNC_DIR = 'sync/v1/';

function syncKey(prefix: string, ...parts: string[]): string {
  return `${prefix}/${SYNC_DIR}${parts.join('/')}`;
}

function emptyManifest(deviceId: string, now: number): SyncManifestV1 {
  return {
    schema: SCHEMA,
    deviceId,
    updatedAt: now,
    convs: {},
    tombstones: { convs: [], history: [], favs: [], roles: [] },
    historyIds: [],
    favIds: [],
    roleIds: [],
  };
}

function isManifest(value: unknown): value is SyncManifestV1 {
  const m = value as SyncManifestV1 | undefined;
  return !!m && m.schema === SCHEMA && !!m.convs && !!m.tombstones;
}

async function readManifest(client: S3Client, cfg: ByocConfig): Promise<SyncManifestV1 | null> {
  const raw = await client.getObject(syncKey(cfg.prefix, 'manifest.json'));
  if (!raw) return null;
  const parsed: unknown = JSON.parse(await raw.text());
  return isManifest(parsed) ? parsed : null;
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: 'application/json' });
}

/** 限并发地处理列表（S3 请求打多了会触发限流，图片多时尤其明显） */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function isRemoteUrl(id: string): boolean {
  return id.startsWith('http://') || id.startsWith('https://');
}

/** 消息里引用的真实 blobId（不含 http 链接，那是上游原图，不属于本地 blob 体系） */
function realBlobIdsOf(msgs: StoredMessage[]): string[] {
  const ids = new Set<string>();
  for (const m of msgs) {
    for (const id of collectMessageBlobIds(m)) {
      if (!isRemoteUrl(id)) ids.add(id);
    }
  }
  return [...ids];
}

// ---------------- 推送 ----------------

/**
 * 本地 → 云端。
 *
 * 步骤：删除检测（本地没有的会话写 tombstone 并清云端对象）→ 推送变更会话
 * （元数据 + 消息 + 引用 blob + 节点）→ 推送历史/收藏全量索引 → 重写清单 →
 * 标记本地 syncedAt。
 */
export async function pushLocal(
  cfg: ByocConfig,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult> {
  const client = createS3Client(cfg);
  const deviceId = await getDeviceId();
  const now = Date.now();
  const manifest = (await readManifest(client, cfg)) ?? emptyManifest(deviceId, now);
  manifest.deviceId = deviceId;

  const result: SyncResult = {
    pushedConvs: 0, pushedMessages: 0, pushedBlobs: 0,
    pulledConvs: 0, pulledMessages: 0, pulledBlobs: 0, deletedConvs: 0,
  };
  const localConvs = await listConversations();
  const localIds = new Set(localConvs.map(c => c.id));
  const syncedConvs: StoredConversation[] = [];
  const syncedMessages: Array<{ convId: string; msgs: StoredMessage[] }> = [];

  // 0. 删除回退清理：本地还存在的会话，说明别的设备恢复了它（或从未删过），
  //    旧 tombstone 不再有效——清掉，否则其他设备会"删了又拉"
  manifest.tombstones.convs = manifest.tombstones.convs.filter(id => !localIds.has(id));

  // 1. 删除检测：云端有而本地没有的会话 → tombstone，清理云端对象。
  //    只处理"之前同步过"或"本机明确删除过"的会话（缓存清单/本地 tombstone
  //    里有记录）：云端新增、本机还没拉过的不能当删除处理，否则 pull 失败时
  //    会把其他设备新建的会话误删。
  //    同步记本地 tombstone（pullRemote 靠它跳过拉取，防止删了又拉回来）。
  const cached = await getCloudManifest();
  const knownRemote = new Set(cached ? Object.keys(cached.convs) : []);
  const localTombstones = await getLocalTombstones();
  let tombstoneChanged = false;
  for (const convId of Object.keys(manifest.convs)) {
    if (localIds.has(convId)) continue;
    if (!knownRemote.has(convId) && !localTombstones.convs.includes(convId)) continue;
    if (manifest.tombstones.convs.includes(convId)) continue;
    manifest.tombstones.convs.push(convId);
    delete manifest.convs[convId];
    if (!localTombstones.convs.includes(convId)) {
      localTombstones.convs.push(convId);
      tombstoneChanged = true;
    }
    result.deletedConvs += 1;
    // 云端对象清理失败只警告、不阻塞 tombstone 写回——否则删除永远无法
    // 跨设备传播（manifest 不落盘，其他端收不到删除）；残留对象下轮再清。
    try {
      await client.deleteObject(syncKey(cfg.prefix, 'convs', `${convId}.json`));
      const msgs = await client.listObjects(syncKey(cfg.prefix, 'msgs', convId));
      await mapLimit(msgs, 8, m => client.deleteObject(m.key));
      const nodes = await client.listObjects(syncKey(cfg.prefix, 'nodes', convId));
      await mapLimit(nodes, 8, n => client.deleteObject(n.key));
    } catch (e) {
      console.warn(`[byoc] 会话 ${convId} 云端对象清理失败（下轮重试）`, e);
    }
  }
  if (tombstoneChanged) await setLocalTombstones(localTombstones);

  // 2. 变更会话
  const targets = localConvs.filter(c => c.updatedAt > (c.syncedAt ?? 0));
  onProgress?.(0, targets.length);
  for (let i = 0; i < targets.length; i++) {
    const conv = targets[i];
    const cloudUpdatedAt = manifest.convs[conv.id] ?? 0;
    const localNewer = conv.updatedAt > cloudUpdatedAt;
    const msgs = await getStoredMessages(conv.id);
    const dirtyMsgs = msgs.filter(m => m.updatedAt > (m.syncedAt ?? 0));

    // 元数据 LWW：本地较新才推（云端较新时保留云端版本，消息仍然照推）
    if (localNewer) {
      const meta: Record<string, unknown> = { ...conv };
      delete meta.syncedAt;
      await client.putObject(
        syncKey(cfg.prefix, 'convs', `${conv.id}.json`),
        jsonBlob(meta)
      );
      manifest.convs[conv.id] = conv.updatedAt;
      result.pushedConvs += 1;
    }

    // 消息：原样序列化（去掉本地 syncedAt）
    await mapLimit(dirtyMsgs, 8, async m => {
      const stored: Record<string, unknown> = { ...m };
      delete stored.syncedAt;
      await client.putObject(
        syncKey(cfg.prefix, 'msgs', conv.id, `${m.id}.json`),
        jsonBlob(stored)
      );
    });
    result.pushedMessages += dirtyMsgs.length;

    // 引用 blob：HEAD 探测，缺失才上传（内容寻址，重复图只传一次）
    const blobIds = realBlobIdsOf(dirtyMsgs);
    for (const blobId of blobIds) {
      if (await client.headObject(syncKey(cfg.prefix, 'blobs', blobId))) continue;
      const record = await getBlob(blobId);
      if (!record) continue;
      await client.putObject(syncKey(cfg.prefix, 'blobs', blobId), record.blob);
      result.pushedBlobs += 1;
    }

    // 节点：覆盖式推送（派生数据，云端以本地为准）
    const nodes = await listNodesFor(conv.id);
    await mapLimit(nodes, 8, n =>
      client.putObject(
        syncKey(cfg.prefix, 'nodes', conv.id, `${n.id}.json`),
        jsonBlob(n)
      )
    );
    const cloudNodeKeys = await client.listObjects(
      syncKey(cfg.prefix, 'nodes', conv.id)
    );
    const localNodeIds = new Set(nodes.map(n => n.id));
    await mapLimit(
      cloudNodeKeys.filter(k => !localNodeIds.has(fileBase(k.key))),
      8,
      k => client.deleteObject(k.key)
    );

    syncedConvs.push(conv);
    if (dirtyMsgs.length) syncedMessages.push({ convId: conv.id, msgs: dirtyMsgs });
    onProgress?.(i + 1, targets.length);
  }

  // 3. 图片历史：以本地为准推全量索引；云端有而本地没有的记 tombstone（不删对象）
  const history = await listStoredImageHistory();
  const historyIds = history.map(h => h.id);
  for (const item of history) {
    await client.putObject(
      syncKey(cfg.prefix, 'history', `${item.id}.json`),
      jsonBlob(item)
    );
  }
  for (const id of manifest.historyIds) {
    if (!historyIds.includes(id) && !manifest.tombstones.history.includes(id)) {
      manifest.tombstones.history.push(id);
      if (!localTombstones.history.includes(id)) {
        localTombstones.history.push(id);
        tombstoneChanged = true;
      }
    }
  }
  // 本地重新有了的条目从 tombstone 移除（删除回退，数据优先于删除）
  manifest.tombstones.history = manifest.tombstones.history.filter(
    id => !historyIds.includes(id)
  );
  manifest.historyIds = historyIds;
  await client.putObject(
    syncKey(cfg.prefix, 'history', 'index.json'),
    jsonBlob({ ids: historyIds })
  );

  // 4. 收藏：同上
  const favs = await listStoredFavorites();
  const favIds = favs.map(f => f.id);
  for (const fav of favs) {
    await client.putObject(syncKey(cfg.prefix, 'favs', `${fav.id}.json`), jsonBlob(fav));
  }
  for (const id of manifest.favIds) {
    if (!favIds.includes(id) && !manifest.tombstones.favs.includes(id)) {
      manifest.tombstones.favs.push(id);
      if (!localTombstones.favs.includes(id)) {
        localTombstones.favs.push(id);
        tombstoneChanged = true;
      }
    }
  }
  manifest.tombstones.favs = manifest.tombstones.favs.filter(
    id => !favIds.includes(id)
  );
  manifest.favIds = favIds;
  await client.putObject(syncKey(cfg.prefix, 'favs', 'index.json'), jsonBlob({ ids: favIds }));

  // 5. 角色：同上（旧版本清单可能没有 roleIds 字段，读侧一律兜底空数组）
  const roles = await listStoredRoles();
  const roleIds = roles.map(r => r.id);
  for (const role of roles) {
    const stored: Record<string, unknown> = { ...role };
    delete stored.syncedAt; // 云端不存本地同步元数据，与会话一致
    await client.putObject(syncKey(cfg.prefix, 'roles', `${role.id}.json`), jsonBlob(stored));
  }
  for (const id of manifest.roleIds ?? []) {
    if (!roleIds.includes(id) && !(manifest.tombstones.roles ?? []).includes(id)) {
      (manifest.tombstones.roles ??= []).push(id);
      if (!localTombstones.roles.includes(id)) {
        localTombstones.roles.push(id);
        tombstoneChanged = true;
      }
    }
  }
  manifest.tombstones.roles = (manifest.tombstones.roles ?? []).filter(
    id => !roleIds.includes(id)
  );
  manifest.roleIds = roleIds;
  await client.putObject(syncKey(cfg.prefix, 'roles', 'index.json'), jsonBlob({ ids: roleIds }));
  // 推送成功的角色标记本地 syncedAt，否则 countPending 会一直把它们算作待同步
  await markRolesSynced(roles, now);

  // 6. 重写清单
  if (tombstoneChanged) await setLocalTombstones(localTombstones);
  manifest.updatedAt = Date.now();
  await client.putObject(syncKey(cfg.prefix, 'manifest.json'), jsonBlob(manifest));
  await setCloudManifest(manifest);

  // 7. 全部成功后才标记本地 syncedAt；期间的新写入（updatedAt > now）自然跳过
  await mapLimit(syncedConvs, 4, conv =>
    markSynced(conv.id, now, syncedMessages.find(s => s.convId === conv.id)?.msgs)
  );

  return result;
}

function fileBase(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1).replace(/\.json$/, '');
}

/** 批量标记 syncedAt：只有 updatedAt 早于 time 的记录才会被标记 */
async function markSynced(
  convId: string,
  time: number,
  msgs?: StoredMessage[]
): Promise<void> {
  return enqueue(convId, () =>
    withDB(async db => {
      const tx = db.transaction(['conversations', 'messages'], 'readwrite');
      const conv = await tx.objectStore('conversations').get(convId);
      if (conv && conv.updatedAt <= time) {
        conv.syncedAt = time;
        await tx.objectStore('conversations').put(conv);
      }
      if (msgs) {
        for (const msg of msgs) {
          if (msg.updatedAt <= time) {
            msg.syncedAt = time;
            await tx.objectStore('messages').put(msg);
          }
        }
      }
      await tx.done;
    })
  );
}

// ---------------- 拉取 ----------------

/**
 * 云端 → 本地。
 *
 * 步骤：应用 tombstone → 拉变更会话（元数据 + 消息 + blob + 节点）→
 * 拉历史/收藏索引差异 → 更新本地清单缓存。
 */
export async function pullRemote(
  cfg: ByocConfig,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult> {
  const client = createS3Client(cfg);
  const result: SyncResult = {
    pushedConvs: 0, pushedMessages: 0, pushedBlobs: 0,
    pulledConvs: 0, pulledMessages: 0, pulledBlobs: 0, deletedConvs: 0,
  };
  const manifest = await readManifest(client, cfg);
  if (!manifest) return result; // 云端还没数据，别碰本地

  // 0. 本机删除检测：云端有、本地缓存清单也有、本地没有的会话/历史/收藏
  //    → 记本地 tombstone（否则下面"拉缺失"会把刚删的又拉回来）。
  //    缓存清单里没有的是别处新建、本机还没拉过的，绝不能当删除处理。
  //    云端 updatedAt 超过缓存记录的说明删除后又有新数据，数据优先，不记。
  const localTombstones = await getLocalTombstones();
  const cached = await getCloudManifest();
  const cachedConvs = new Map<string, number>(
    cached ? Object.entries(cached.convs) : []
  );
  const cachedHistIds = new Set<string>(cached ? cached.historyIds : []);
  const cachedFavIds = new Set<string>(cached ? cached.favIds : []);
  const cachedRoleIds = new Set<string>(cached ? (cached.roleIds ?? []) : []);
  const localConvIds = new Set((await listConversations()).map(c => c.id));
  const localHistIds = new Set((await listStoredImageHistory()).map(h => h.id));
  const localFavIds = new Set((await listStoredFavorites()).map(f => f.id));
  const localRoleIds = new Set((await listStoredRoles()).map(r => r.id));
  let tombstoneChanged = false;
  for (const convId of Object.keys(manifest.convs)) {
    if (localConvIds.has(convId)) continue;
    if (!cachedConvs.has(convId)) continue;
    if (manifest.convs[convId] > (cachedConvs.get(convId) ?? 0)) continue;
    if (!localTombstones.convs.includes(convId)) {
      localTombstones.convs.push(convId);
      tombstoneChanged = true;
    }
  }
  for (const id of manifest.historyIds) {
    if (localHistIds.has(id) || !cachedHistIds.has(id)) continue;
    if (!localTombstones.history.includes(id)) {
      localTombstones.history.push(id);
      tombstoneChanged = true;
    }
  }
  for (const id of manifest.favIds) {
    if (localFavIds.has(id) || !cachedFavIds.has(id)) continue;
    if (!localTombstones.favs.includes(id)) {
      localTombstones.favs.push(id);
      tombstoneChanged = true;
    }
  }
  for (const id of manifest.roleIds ?? []) {
    if (localRoleIds.has(id) || !cachedRoleIds.has(id)) continue;
    if (!localTombstones.roles.includes(id)) {
      localTombstones.roles.push(id);
      tombstoneChanged = true;
    }
  }
  if (tombstoneChanged) await setLocalTombstones(localTombstones);

  // 1. tombstone：删本地对应记录（云端已确认删除，顺带清本机删除记录）
  for (const convId of manifest.tombstones.convs) {
    if (await getConversation(convId)) {
      await deleteConversation(convId);
      result.deletedConvs += 1;
    }
    if (localTombstones.convs.includes(convId)) {
      localTombstones.convs = localTombstones.convs.filter(x => x !== convId);
      tombstoneChanged = true;
    }
  }
  for (const id of manifest.tombstones.history) {
    await deleteImageHistoryItem(id);
    if (localTombstones.history.includes(id)) {
      localTombstones.history = localTombstones.history.filter(x => x !== id);
      tombstoneChanged = true;
    }
  }
  for (const id of manifest.tombstones.favs) {
    await removeFavorite(id);
    if (localTombstones.favs.includes(id)) {
      localTombstones.favs = localTombstones.favs.filter(x => x !== id);
      tombstoneChanged = true;
    }
  }
  for (const id of manifest.tombstones.roles ?? []) {
    await deleteRole(id);
    if (localTombstones.roles.includes(id)) {
      localTombstones.roles = localTombstones.roles.filter(x => x !== id);
      tombstoneChanged = true;
    }
  }
  if (tombstoneChanged) await setLocalTombstones(localTombstones);

  // 2. 会话
  const convIds = Object.keys(manifest.convs);
  onProgress?.(0, convIds.length);
  for (let i = 0; i < convIds.length; i++) {
    const convId = convIds[i];
    const cloudUpdatedAt = manifest.convs[convId];
    if (localTombstones.convs.includes(convId)) {
      const cachedAt = cachedConvs.get(convId);
      // 本机已删：缓存清单里没有该会话（缓存丢失等）或云端没有更新 →
      // 保持删除（push 阶段会清云端对象）；
      // 云端 updatedAt 晚于缓存记录 → 其他设备恢复了会话，数据优先，撤销删除。
      if (cachedAt === undefined || cloudUpdatedAt <= cachedAt) continue;
      localTombstones.convs = localTombstones.convs.filter(x => x !== convId);
      await setLocalTombstones(localTombstones);
    }
    const local = await getConversation(convId);
    if (local && (local.syncedAt ?? 0) >= cloudUpdatedAt) continue; // 已是最新

    const raw = await client.getObject(syncKey(cfg.prefix, 'convs', `${convId}.json`));
    if (!raw) continue;
    const cloudConv = JSON.parse(await raw.text()) as StoredConversation;
    const cloudNewer = !local || cloudUpdatedAt > local.updatedAt;
    const pulled = await pullConversation(
      client, cfg, convId, cloudConv, cloudNewer
    );
    result.pulledConvs += pulled.convPulled ? 1 : 0;
    result.pulledMessages += pulled.messageCount;
    result.pulledBlobs += pulled.blobCount;
    onProgress?.(i + 1, convIds.length);
  }

  // 3. 图片历史：以云端 index 为准拉缺失；本地多余的**不删**——
  //    它可能是本地刚生成还没推送的，删除宁可回退也不能丢数据
  const histIndex = await readIndex(client, cfg, 'history');
  const localHist = new Map((await listStoredImageHistory()).map(h => [h.id, h]));
  const histStat = { blobCount: 0 };
  for (const id of histIndex) {
    if (localTombstones.history.includes(id)) continue; // 本机已删，不拉
    if (localHist.has(id)) continue;
    const raw = await client.getObject(syncKey(cfg.prefix, 'history', `${id}.json`));
    if (!raw) continue;
    const item = JSON.parse(await raw.text()) as StoredImageHistoryItem;
    await putStoredHistory(item);
    await pullBlobRefs(client, cfg, item.blobIds, histStat);
  }
  result.pulledBlobs += histStat.blobCount;

  // 4. 收藏：同上（缩略图 blob 一并拉）
  const favIndex = await readIndex(client, cfg, 'favs');
  const localFavs = new Map((await listStoredFavorites()).map(f => [f.id, f]));
  const favStat = { blobCount: 0 };
  for (const id of favIndex) {
    if (localTombstones.favs.includes(id)) continue; // 本机已删，不拉
    if (localFavs.has(id)) continue;
    const raw = await client.getObject(syncKey(cfg.prefix, 'favs', `${id}.json`));
    if (!raw) continue;
    const fav = JSON.parse(await raw.text()) as StoredFavoriteArtifact;
    await putStoredFavorite(fav);
    if (fav.thumbnailBlobId && !isRemoteUrl(fav.thumbnailBlobId)) {
      await pullOneBlob(client, cfg, fav.thumbnailBlobId, favStat);
    }
  }
  result.pulledBlobs += favStat.blobCount;

  // 5. 角色：同上（纯文本记录，无 blob 依赖）
  const roleIndex = await readIndex(client, cfg, 'roles');
  const localRoles = new Map((await listStoredRoles()).map(r => [r.id, r]));
  for (const id of roleIndex) {
    if (localTombstones.roles.includes(id)) continue; // 本机已删，不拉
    if (localRoles.has(id)) continue;
    const raw = await client.getObject(syncKey(cfg.prefix, 'roles', `${id}.json`));
    if (!raw) continue;
    const role = JSON.parse(await raw.text()) as StoredRole;
    await putStoredRole(role);
  }

  await setCloudManifest(manifest);
  return result;
}

async function readIndex(
  client: S3Client,
  cfg: ByocConfig,
  dir: 'history' | 'favs' | 'roles'
): Promise<string[]> {
  const raw = await client.getObject(syncKey(cfg.prefix, dir, 'index.json'));
  if (!raw) return [];
  const parsed = JSON.parse(await raw.text()) as { ids?: string[] };
  return Array.isArray(parsed.ids) ? parsed.ids : [];
}

/** 拉取单个会话（消息 + blob + 节点），返回统计与元数据是否覆盖 */
async function pullConversation(
  client: S3Client,
  cfg: ByocConfig,
  convId: string,
  cloudConv: StoredConversation,
  cloudNewer: boolean
): Promise<{ convPulled: boolean; messageCount: number; blobCount: number }> {
  const local = await getConversation(convId);
  const stats = { convPulled: cloudNewer, messageCount: 0, blobCount: 0 };

  // 消息：按 msgId 去重，updatedAt 大者胜
  const keys = await client.listObjects(syncKey(cfg.prefix, 'msgs', convId));
  let maxSeq = local?.headSeq ?? 0;
  await mapLimit(keys, 6, async k => {
    const msgId = fileBase(k.key);
    const existing = await withDB(db => db.get('messages', msgId));
    if (existing && existing.updatedAt >= k.lastModified) return;
    const raw = await client.getObject(k.key);
    if (!raw) return;
    const msg = JSON.parse(await raw.text()) as StoredMessage;
    await putStoredMessage(convId, msg, existing);
    await pullBlobRefs(client, cfg, realBlobIdsOf([msg]), stats);
    stats.messageCount += 1;
    maxSeq = Math.max(maxSeq, msg.seq);
  });

  // 节点：云端较新时以云端集合覆盖本地；本地较新时只补云端缺的
  const cloudNodes = await client.listObjects(syncKey(cfg.prefix, 'nodes', convId));
  const nodeIds = new Set(cloudNodes.map(n => fileBase(n.key)));
  if (cloudNewer) {
    const localNodes = await listNodesFor(convId);
    await mapLimit(localNodes.filter(n => !nodeIds.has(n.id)), 4, n =>
      deleteNode(n.convId, n.id)
    );
  }
  await mapLimit(cloudNodes, 4, async k => {
    const raw = await client.getObject(k.key);
    if (!raw) return;
    const node = JSON.parse(await raw.text()) as StoredContextNode;
    await putNode(node);
  });

  // 会话元数据：云端较新才覆盖（保留云端反范式计数，但 headSeq 取三者的最大，
  // 否则本地有本地新增消息时下一次追加会撞 seq）
  if (cloudNewer) {
    const count = await countMessages(convId);
    await withDB(async db => {
      await db.put('conversations', {
        ...cloudConv,
        syncedAt: Date.now(),
        messageCount: Math.max(cloudConv.messageCount, local?.messageCount ?? 0, count),
        headSeq: Math.max(cloudConv.headSeq, local?.headSeq ?? 0, maxSeq),
      });
    });
    stats.convPulled = true;
  }
  // 本地较新：元数据保留本地（LWW），也不标记 syncedAt——
  // 否则下一轮推送会把该会话过滤掉，本地新版永远传不上去
  return stats;
}

/** 原样落库一条云端消息：保留 seq，重算检索索引，冲突 seq 往后挪 */
async function putStoredMessage(
  convId: string,
  msg: StoredMessage,
  existing: StoredMessage | undefined
): Promise<void> {
  const seq = await enqueue(convId, () =>
    withDB(async db => {
      let seq = msg.seq;
      if (!existing) {
        // 两设备可能产生相同 seq：被占用就往后挪一点，绝不覆盖别人
        let guard = 0;
        while (guard++ < 3) {
          const taken = await db.getFromIndex('messages', 'by_conv_seq', [convId, seq]);
          if (!taken || taken.id === msg.id) break;
          seq += 1;
        }
      }
      return seq;
    })
  );
  await enqueue(convId, () =>
    withDB(async db => {
      // updatedAt 要刷新成本地时刻：否则它会一直停留在云端推送时刻，
      // 恒小于云端对象 lastModified，导致每次同步都全量重拉覆盖本地——
      // 一旦云端 seq 因任何原因错乱，本地将永远被覆盖、无法自愈。
      await db.put('messages', { ...msg, convId, seq, updatedAt: Date.now(), syncedAt: Date.now() });
    })
  );
  await indexMessage({ ...msg, convId, seq });
}

/** 保证引用 blob 在本地存在（缺失则从云端拉取；已有则 +1 引用计数） */
async function pullBlobRefs(
  client: S3Client,
  cfg: ByocConfig,
  blobIds: string[],
  stats: { blobCount: number }
): Promise<void> {
  await mapLimit(blobIds, 4, id => pullOneBlob(client, cfg, id, stats));
}

async function pullOneBlob(
  client: S3Client,
  cfg: ByocConfig,
  blobId: string,
  stats: { blobCount: number }
): Promise<void> {
  if (await getBlob(blobId)) {
    await retainBlobs([blobId]);
    return;
  }
  const raw = await client.getObject(syncKey(cfg.prefix, 'blobs', blobId));
  if (!raw) return; // 云端也没有：丢掉该引用，少一张图比丢一段对话好
  await putBlob(raw);
  stats.blobCount += 1;
}

/** 原样落库 imageHistory 记录（保留 id/timestamp，blobIds 引用不变） */
function putStoredHistory(item: StoredImageHistoryItem): Promise<void> {
  return enqueue('imageHistory', async () => {
    await withDB(db => db.put('imageHistory', item));
  });
}

/** 原样落库收藏记录 */
function putStoredFavorite(fav: StoredFavoriteArtifact): Promise<void> {
  return enqueue('favorites', async () => {
    await withDB(db => db.put('favoriteArtifacts', fav));
  });
}

/** 原样落库角色记录（拉取即视为已同步：标记 syncedAt，避免 countPending 反复统计） */
function putStoredRole(role: StoredRole): Promise<void> {
  return enqueue('roles', async () => {
    await withDB(db => db.put('roles', { ...role, syncedAt: Date.now() }));
  });
}

/** 推送成功的角色批量标记 syncedAt（只标记 updatedAt 不晚于 time 的，期间的写入下轮再推） */
async function markRolesSynced(roles: StoredRole[], time: number): Promise<void> {
  return enqueue('roles', () =>
    withDB(async db => {
      for (const r of roles) {
        if (r.updatedAt <= time) {
          await db.put('roles', { ...r, syncedAt: time });
        }
      }
    })
  );
}

async function listNodesFor(convId: string): Promise<StoredContextNode[]> {
  return listNodes(convId);
}
