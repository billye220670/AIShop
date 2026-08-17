/**
 * 增量双向同步引擎（BYOC 第二阶段能力）。
 *
 * 原理：schema 从设计之初就为同步预留了 updatedAt/syncedAt——
 * "推送 syncedAt 为空的记录，不需要 CRDT"。这里把判断收紧为
 * `updatedAt > syncedAt`：流式覆盖写会保留旧 syncedAt 但更新 updatedAt，
 * 只查 null 会漏掉这类变更。
 *
 * 桶内布局（prefix 写死为 PortAI，不向用户暴露）：
 *   sync/v1/manifest.json                 云端"目录"，每轮推送整体重写
 *   sync/v1/convs/{convId}.json           会话元数据
 *   sync/v1/msgs/{convId}/{msgId}.json    单条消息（原样存盘格式）
 *   sync/v1/nodes/{convId}/{nodeId}.json  上下文节点（派生数据，可重建）
 *   sync/v1/blobs/{sha256}                二进制原样（内容寻址，全局去重）
 *   sync/v1/history/{id}.json + index.json 图片生成历史
 *   sync/v1/assets/{id}.json + index.json 「我的库」资产（md / artifact / 图片）
 *   sync/v1/favs/{id}.json + index.json   收藏（artifact 资产的旧版兼容镜像）
 *   sync/v1/roles/{id}.json + index.json  角色（系统提示词预设）
 *   sync/v1/settings.json                 API 设置（providers + apiKeys，可选同步，单对象整体覆盖）
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
  listStoredAssets,
  removeAsset,
  putStoredAsset,
  listStoredRoles,
  deleteRole,
  releaseBlobs,
} from '../../db';
import { collectMessageBlobIds } from '../../db/messageCodec';
import { deleteConversation } from '../../db/conversationRepo';
import type {
  StoredConversation,
  StoredMessage,
  StoredContextNode,
  StoredImageHistoryItem,
  StoredFavoriteArtifact,
  StoredAsset,
  StoredRole,
} from '../../db/schema';
import { createS3Client, type S3Client } from './s3Client';
import type { ByocConfig, SyncManifestV1, SyncResult, SyncedSettings } from './types';
import {
  getDeviceId,
  setCloudManifest,
  getCloudManifest,
  getLocalTombstones,
  updateLocalTombstones,
  getSettingsSyncMeta,
  setSettingsSyncMeta,
  getAppliedVersions,
  updateAppliedVersions,
} from './state';
import { settingsService } from '../settingsService';

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
    tombstones: { convs: [], history: [], favs: [], roles: [], assets: [] },
    historyIds: [],
    favIds: [],
    roleIds: [],
    assetIds: [],
    assetVers: {},
    roleVers: {},
    historyVers: {},
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

/** 图片历史的本地版本：旧记录没有 updatedAt，回退到 timestamp（生成时刻） */
function localVer(item: StoredImageHistoryItem): number {
  return item.updatedAt ?? item.timestamp;
}

/**
 * 云端版本覆盖本地资产前，释放本地独有的 blob 引用。
 *
 * 拉取路径以前直接 put 覆盖，被换掉的缩略图/图片引用计数永远不减，
 * blob 再也不会被 sweepOrphanBlobs 回收。与 messageRepo.putMessage 同一套按
 * 出现次数抵扣的做法（同一张图可能被引用多次）。
 */
async function releaseReplacedAssetBlobs(
  oldAsset: StoredAsset,
  newAsset: StoredAsset
): Promise<void> {
  const idsOf = (a: StoredAsset): string[] =>
    [...(a.thumbnailBlobId ? [a.thumbnailBlobId] : []), ...(a.blobIds ?? [])].filter(
      id => !isRemoteUrl(id)
    );
  const counts = new Map<string, number>();
  for (const id of idsOf(oldAsset)) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of idsOf(newAsset)) {
    const left = counts.get(id);
    if (left !== undefined) counts.set(id, left - 1);
  }
  const stale: string[] = [];
  for (const [id, times] of counts) {
    for (let i = 0; i < times; i++) stale.push(id);
  }
  if (stale.length) await releaseBlobs(stale);
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
  onProgress?: (done: number, total: number) => void,
  knownRemoteSnapshot?: SyncManifestV1 | null
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
  //    只处理"缓存清单里同步过"或"本机明确删除过"的会话（本地 tombstone
  //    里有记录）：云端新增、本机还没拉过的不能当删除处理，否则 pull 失败时
  //    会把其他设备新建的会话误删。
  //    knownRemoteSnapshot 是**本轮 pull 开始之前**的缓存清单：pull 结尾会把
  //    最新云端清单写进缓存，若这里改读缓存，那道保护就永久失效——pull 中途
  //    失败（网络抖动、单个对象 404）跳过的会话会立刻被判成「已知且本地没有」
  //    而删掉，并把删除传播给所有设备。调用方必须传入 pull 前的快照。
  //    每次迭代重读最新 tombstone：删除动作可能发生在本轮同步进行期间，
  //    用开始时的快照会漏掉它——刚删的会话会被当成普通变更推回云端。
  const cached =
    knownRemoteSnapshot !== undefined ? knownRemoteSnapshot : await getCloudManifest() ?? null;
  const knownRemote = new Set(cached ? Object.keys(cached.convs) : []);
  for (const convId of Object.keys(manifest.convs)) {
    if (localIds.has(convId)) continue;
    const tombstones = await getLocalTombstones();
    const localDeleted = tombstones.convs.some(t => t.id === convId);
    if (!knownRemote.has(convId) && !localDeleted) continue;
    if (manifest.tombstones.convs.includes(convId)) continue;
    manifest.tombstones.convs.push(convId);
    delete manifest.convs[convId];
    if (!localDeleted) {
      // 缓存清单里已知、本地却已消失且无删除记录：视为本机删过，补记
      // tombstone（at 取缓存值，撤销判定退化为缓存对比，保持原行为）
      await updateLocalTombstones(t => {
        if (!t.convs.some(x => x.id === convId)) {
          t.convs.push({ id: convId, at: cached?.convs[convId] ?? 0 });
        }
      });
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
    await pushBlobRefs(client, cfg, realBlobIdsOf(dirtyMsgs), result);

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
  // 版本表：拉取方靠它发现「云端这条改过了」，只有 id 集合的话修改传不出去
  manifest.historyVers = Object.fromEntries(history.map(h => [h.id, localVer(h)]));
  // 历史引用的图片 blob 一并上传，否则另一端拉取时云端缺对象，图片会静默丢失
  await pushBlobRefs(
    client,
    cfg,
    history.flatMap(h => h.blobIds ?? []),
    result
  );
  for (const id of manifest.historyIds) {
    if (!historyIds.includes(id) && !manifest.tombstones.history.includes(id)) {
      manifest.tombstones.history.push(id);
      await updateLocalTombstones(t => {
        if (!t.history.includes(id)) t.history.push(id);
      });
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

  // 4. 「我的库」资产：以本地为准推全量索引 + 对象；云端有而本地没有的记 tombstone。
  //    assets 目录承载三种 kind；favs 目录保留为 artifact 资产的兼容镜像，让仍运行
  //    旧版本（无 assets store）的设备继续收到 artifact 收藏/删除。
  const assets = await listStoredAssets();
  const assetIds = assets.map(a => a.id);
  for (const asset of assets) {
    await client.putObject(
      syncKey(cfg.prefix, 'assets', `${asset.id}.json`),
      jsonBlob(asset)
    );
  }
  // 版本表：同 history，缺了它另一端只能看到新增、看不到重命名
  manifest.assetVers = Object.fromEntries(assets.map(a => [a.id, a.updatedAt]));
  // 资产引用的 blob 一并上传：artifact 缩略图 + image 图片（http 上游链接除外）。
  // 只推元数据不推 blob 的话，另一端 pullAssetBlobs 会因云端缺对象丢掉缩略图引用，
  // 表现为库列表项存在但没有缩略图。
  await pushBlobRefs(
    client,
    cfg,
    assets.flatMap(a => [
      ...(a.thumbnailBlobId ? [a.thumbnailBlobId] : []),
      ...(a.blobIds ?? []),
    ]),
    result
  );
  for (const id of manifest.assetIds ?? []) {
    if (!assetIds.includes(id) && !(manifest.tombstones.assets ?? []).includes(id)) {
      (manifest.tombstones.assets ??= []).push(id);
      await updateLocalTombstones(t => {
        if (!t.assets.includes(id)) t.assets.push(id);
      });
    }
  }
  manifest.tombstones.assets = (manifest.tombstones.assets ?? []).filter(
    id => !assetIds.includes(id)
  );
  manifest.assetIds = assetIds;
  await client.putObject(
    syncKey(cfg.prefix, 'assets', 'index.json'),
    jsonBlob({ ids: assetIds })
  );

  // favs 兼容镜像：只镜像 artifact 资产，id 与 asset id 一致（迁移时保持），
  // 旧设备删除 artifact 时发的 favs tombstone 与本端 asset id 对齐
  const favs = assets
    .filter(a => a.kind === 'artifact' && a.artifact && a.thumbnailBlobId)
    .map(a => ({
      id: a.id,
      artifact: a.artifact!,
      thumbnailBlobId: a.thumbnailBlobId!,
      favoritedAt: a.createdAt,
    }));
  const favIds = favs.map(f => f.id);
  for (const fav of favs) {
    await client.putObject(syncKey(cfg.prefix, 'favs', `${fav.id}.json`), jsonBlob(fav));
  }
  for (const id of manifest.favIds) {
    if (!favIds.includes(id) && !manifest.tombstones.favs.includes(id)) {
      manifest.tombstones.favs.push(id);
      await updateLocalTombstones(t => {
        if (!t.favs.includes(id)) t.favs.push(id);
      });
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
  // 版本表：缺了它另一端收不到角色提示词的编辑
  manifest.roleVers = Object.fromEntries(roles.map(r => [r.id, r.updatedAt]));
  for (const id of manifest.roleIds ?? []) {
    if (!roleIds.includes(id) && !(manifest.tombstones.roles ?? []).includes(id)) {
      (manifest.tombstones.roles ??= []).push(id);
      await updateLocalTombstones(t => {
        if (!t.roles.includes(id)) t.roles.push(id);
      });
    }
  }
  manifest.tombstones.roles = (manifest.tombstones.roles ?? []).filter(
    id => !roleIds.includes(id)
  );
  manifest.roleIds = roleIds;
  await client.putObject(syncKey(cfg.prefix, 'roles', 'index.json'), jsonBlob({ ids: roleIds }));
  // 推送成功的角色标记本地 syncedAt，否则 countPending 会一直把它们算作待同步
  await markRolesSynced(roles, now);

  // 5.5 API 设置（providers + apiKeys）：可选同步（开关开启才参与），
  //    单对象整体覆盖，LWW（updatedAt 大者胜）
  if (settingsService.getSyncApiSettings()) {
    await pushSettings(client, cfg, manifest);
  }

  // 6. 重写清单
  manifest.updatedAt = Date.now();
  await client.putObject(syncKey(cfg.prefix, 'manifest.json'), jsonBlob(manifest));
  await setCloudManifest(manifest);

  // 本机推上去的版本也要记进 applied：否则下一轮拉取会看到
  // 「云端版本 > 已应用版本」，把自己刚推的内容原样拉回来重写一遍。
  await updateAppliedVersions(v => {
    for (const a of assets) v.assets[a.id] = a.updatedAt;
    for (const r of roles) v.roles[r.id] = r.updatedAt;
    for (const h of history) v.history[h.id] = localVer(h);
  });

  // 7. 全部成功后才标记本地 syncedAt；期间的新写入（updatedAt > now）自然跳过
  await mapLimit(syncedConvs, 4, conv =>
    markSynced(conv.id, now, syncedMessages.find(s => s.convId === conv.id)?.msgs)
  );

  return result;
}

/**
 * 保证引用 blob 在云端存在：HEAD 探测，缺失才上传（内容寻址，重复只传一次）。
 * 消息、图片历史、「我的库」资产共用；http 上游链接不属于本地 blob 体系，跳过。
 */
async function pushBlobRefs(
  client: S3Client,
  cfg: ByocConfig,
  ids: string[],
  result: SyncResult
): Promise<void> {
  await mapLimit(ids, 4, async blobId => {
    if (isRemoteUrl(blobId)) return;
    if (await client.headObject(syncKey(cfg.prefix, 'blobs', blobId))) return;
    const record = await getBlob(blobId);
    if (!record) return;
    await client.putObject(syncKey(cfg.prefix, 'blobs', blobId), record.blob);
    result.pushedBlobs += 1;
  });
}

/**
 * 推送 API 设置（sync/v1/settings.json，单对象整体覆盖，LWW）。
 *
 * 只在本地有变更（updatedAt > syncedAt）时推；若云端版本晚于本机最后变更
 * （其他设备后写、本机还未拉过），反向拉云端覆盖本地——避免旧数据覆盖新数据。
 */
async function pushSettings(
  client: S3Client,
  cfg: ByocConfig,
  manifest: SyncManifestV1
): Promise<void> {
  const meta = await getSettingsSyncMeta();
  if (!meta || meta.updatedAt <= meta.syncedAt) return; // 无本地变更
  const cloudAt = manifest.settingsUpdatedAt ?? 0;
  if (cloudAt > meta.updatedAt) {
    await pullSettings(client, cfg, cloudAt);
    return;
  }
  await client.putObject(
    syncKey(cfg.prefix, 'settings.json'),
    jsonBlob(settingsService.getSyncedSettings())
  );
  manifest.settingsUpdatedAt = meta.updatedAt;
  await setSettingsSyncMeta({ updatedAt: meta.updatedAt, syncedAt: meta.updatedAt });
}

/** 拉取云端 API 设置并写回本地（整体覆盖），成功后把 meta 对齐到云端版本 */
async function pullSettings(client: S3Client, cfg: ByocConfig, cloudAt: number): Promise<void> {
  const raw = await client.getObject(syncKey(cfg.prefix, 'settings.json'));
  if (!raw) return;
  const parsed = JSON.parse(await raw.text()) as SyncedSettings;
  if (!parsed || typeof parsed !== 'object' || !parsed.providers || !parsed.apiKeys) return;
  settingsService.applySyncedSettings(parsed);
  await setSettingsSyncMeta({ updatedAt: cloudAt, syncedAt: cloudAt });
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
 *
 * 返回值里的 priorManifest 是**本轮开始前**的缓存清单快照，供随后的 pushLocal
 * 判断「哪些会话本机确实同步过」。不能让 push 自己去读缓存——本函数结尾会把
 * 最新云端清单写进缓存，push 再读就会把 pull 中途跳过的会话误判成本地删除。
 */
export async function pullRemote(
  cfg: ByocConfig,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult & { priorManifest: SyncManifestV1 | null }> {
  const client = createS3Client(cfg);
  const result: SyncResult & { priorManifest: SyncManifestV1 | null } = {
    pushedConvs: 0, pushedMessages: 0, pushedBlobs: 0,
    pulledConvs: 0, pulledMessages: 0, pulledBlobs: 0, deletedConvs: 0,
    priorManifest: (await getCloudManifest()) ?? null,
  };
  const manifest = await readManifest(client, cfg);
  if (!manifest) return result; // 云端还没数据，别碰本地

  // 本轮是否有对象拉取失败：只要有一次失败就不提交缓存清单。
  // 缓存清单的语义是「这些内容本机确实收下了」，push 的删除检测完全依赖它；
  // 把没拉全的清单当成收全了记账，下一轮 push 就会删掉那些没拉到的会话。
  let incomplete = false;

  // 0. 本机删除检测：云端有、本地缓存清单也有、本地没有的会话/历史/收藏
  //    → 记本地 tombstone（否则下面"拉缺失"会把刚删的又拉回来）。
  //    缓存清单里没有的是别处新建、本机还没拉过的，绝不能当删除处理。
  //    云端 updatedAt 超过缓存记录的说明删除后又有新数据，数据优先，不记。
  //    用事务化更新（读-改-写原子）：删除动作可能与本轮同步并发发生，
  //    快照式"读→改→整体写回"会把 recordLocalDeletions 刚写入的记录覆盖掉，
  //    导致拉取阶段看不到 tombstone、把刚删的会话又拉回来。
  const cached = result.priorManifest;
  const cachedConvs = new Map<string, number>(
    cached ? Object.entries(cached.convs) : []
  );
  const cachedHistIds = new Set<string>(cached ? cached.historyIds : []);
  const cachedFavIds = new Set<string>(cached ? cached.favIds : []);
  const cachedAssetIds = new Set<string>(cached ? (cached.assetIds ?? []) : []);
  const cachedRoleIds = new Set<string>(cached ? (cached.roleIds ?? []) : []);
  const localConvIds = new Set((await listConversations()).map(c => c.id));
  const localHistIds = new Set((await listStoredImageHistory()).map(h => h.id));
  const localAssetIds = new Set((await listStoredAssets()).map(a => a.id));
  const localRoleIds = new Set((await listStoredRoles()).map(r => r.id));
  for (const convId of Object.keys(manifest.convs)) {
    if (localConvIds.has(convId)) continue;
    if (!cachedConvs.has(convId)) continue;
    if (manifest.convs[convId] > (cachedConvs.get(convId) ?? 0)) continue;
    // at 取缓存记录值：撤销判定时 max(at, cachedAt) = cachedAt，退化为缓存对比
    await updateLocalTombstones(t => {
      if (!t.convs.some(x => x.id === convId)) {
        t.convs.push({ id: convId, at: cachedConvs.get(convId) ?? 0 });
      }
    });
  }
  for (const id of manifest.historyIds) {
    if (localHistIds.has(id) || !cachedHistIds.has(id)) continue;
    await updateLocalTombstones(t => {
      if (!t.history.includes(id)) t.history.push(id);
    });
  }
  for (const id of manifest.favIds) {
    if (localAssetIds.has(id) || !cachedFavIds.has(id)) continue;
    await updateLocalTombstones(t => {
      if (!t.favs.includes(id)) t.favs.push(id);
    });
  }
  // 资产（含 favs 镜像之外的 md/image）：缓存清单有而本地没有的记本地 tombstone
  for (const id of manifest.assetIds ?? []) {
    if (localAssetIds.has(id) || !cachedAssetIds.has(id)) continue;
    await updateLocalTombstones(t => {
      if (!t.assets.includes(id)) t.assets.push(id);
    });
  }
  for (const id of manifest.roleIds ?? []) {
    if (localRoleIds.has(id) || !cachedRoleIds.has(id)) continue;
    await updateLocalTombstones(t => {
      if (!t.roles.includes(id)) t.roles.push(id);
    });
  }

  // 1. tombstone：删本地对应记录（云端已确认删除，顺带清本机删除记录）
  for (const convId of manifest.tombstones.convs) {
    if (await getConversation(convId)) {
      await deleteConversation(convId);
      result.deletedConvs += 1;
    }
    await updateLocalTombstones(t => {
      t.convs = t.convs.filter(x => x.id !== convId);
    });
  }
  for (const id of manifest.tombstones.history) {
    await deleteImageHistoryItem(id);
    await updateLocalTombstones(t => {
      t.history = t.history.filter(x => x !== id);
    });
  }
  // favs tombstone 与 artifact 资产 id 一致（迁移时保持）：直接删 assets 记录，
  // 本地 tombstone 两边都清，避免残留导致 countPending 永远挂账
  for (const id of manifest.tombstones.favs) {
    await removeAsset(id);
    await updateLocalTombstones(t => {
      t.favs = t.favs.filter(x => x !== id);
      t.assets = t.assets.filter(x => x !== id);
    });
  }
  for (const id of manifest.tombstones.assets ?? []) {
    await removeAsset(id);
    await updateLocalTombstones(t => {
      t.assets = t.assets.filter(x => x !== id);
      t.favs = t.favs.filter(x => x !== id);
    });
  }
  for (const id of manifest.tombstones.roles ?? []) {
    await deleteRole(id);
    await updateLocalTombstones(t => {
      t.roles = t.roles.filter(x => x !== id);
    });
  }

  // 2. 会话
  const convIds = Object.keys(manifest.convs);
  onProgress?.(0, convIds.length);
  for (let i = 0; i < convIds.length; i++) {
    const convId = convIds[i];
    const cloudUpdatedAt = manifest.convs[convId];
    // 每次重读最新 tombstone：删除动作可能发生在本轮同步开始之后，
    // 用快照判断会把刚删的会话拉回来（"删了又拉"）。
    const tomb = (await getLocalTombstones()).convs.find(t => t.id === convId);
    if (tomb) {
      const cachedAt = cachedConvs.get(convId);
      // 本机已删：缓存清单里没有该会话（缓存丢失等）→ 保持删除；
      // 云端 updatedAt 晚于「删除时刻」且晚于缓存记录 → 删除之后其他设备
      // 恢复了会话（新数据），数据优先，撤销删除；否则保持删除（push 阶段
      // 会清云端对象）。at=0 的旧记录（无删除时刻）退化为缓存对比。
      if (cachedAt === undefined || cloudUpdatedAt <= Math.max(tomb.at, cachedAt)) continue;
      await updateLocalTombstones(t => {
        t.convs = t.convs.filter(x => x.id !== convId);
      });
    }
    const local = await getConversation(convId);
    if (local && (local.syncedAt ?? 0) >= cloudUpdatedAt) continue; // 已是最新

    const raw = await client.getObject(syncKey(cfg.prefix, 'convs', `${convId}.json`));
    if (!raw) {
      // 清单说有、对象却读不到：云端不一致或写入尚未可见。标记本轮不完整，
      // 否则缓存清单会记成「已收下」，下一轮 push 就把这个会话当本地删除清掉。
      incomplete = true;
      continue;
    }
    const cloudConv = JSON.parse(await raw.text()) as StoredConversation;
    const cloudNewer = !local || cloudUpdatedAt > local.updatedAt;
    try {
      const pulled = await pullConversation(
        client, cfg, convId, cloudConv, cloudNewer
      );
      result.pulledConvs += pulled.convPulled ? 1 : 0;
      result.pulledMessages += pulled.messageCount;
      result.pulledBlobs += pulled.blobCount;
    } catch (e) {
      // 单个会话失败不该中断整轮（其他会话仍应收敛），但必须记为不完整
      console.warn(`[byoc] 会话 ${convId} 拉取失败（下轮重试）`, e);
      incomplete = true;
    }
    onProgress?.(i + 1, convIds.length);
  }

  // 3. 图片历史：以云端 index 为准拉缺失与**有更新**的；本地多余的**不删**——
  //    它可能是本地刚生成还没推送的，删除宁可回退也不能丢数据。
  //    只按「本地没有才拉」会让另一端的修改（尺寸回填等）永远传不过来，
  //    所以同时比对清单里的版本号与本机已应用版本。
  const histIndex = await readIndex(client, cfg, 'history');
  const localHist = new Map((await listStoredImageHistory()).map(h => [h.id, h]));
  const histStat = { blobCount: 0 };
  const applied = await getAppliedVersions();
  for (const id of histIndex) {
    const tombstones = await getLocalTombstones();
    if (tombstones.history.includes(id)) continue; // 本机已删，不拉
    const cloudVer = manifest.historyVers?.[id] ?? 0;
    if (localHist.has(id) && cloudVer <= (applied.history[id] ?? 0)) continue;
    const raw = await client.getObject(syncKey(cfg.prefix, 'history', `${id}.json`));
    if (!raw) continue;
    const item = JSON.parse(await raw.text()) as StoredImageHistoryItem;
    // 本地更新且尚未推送时不覆盖（LWW：本地 updatedAt 更大则等下一轮 push 上行）
    const localItem = localHist.get(id);
    if (localItem && localVer(localItem) > cloudVer) continue;
    await putStoredHistory(item);
    await updateAppliedVersions(v => { v.history[id] = cloudVer; });
    await pullBlobRefs(client, cfg, item.blobIds, histStat);
  }
  result.pulledBlobs += histStat.blobCount;

  // 4. 「我的库」资产：主拉 assets 目录（三种 kind，缩略图/图片 blob 一并拉）；
  //    favs 目录是旧版本设备推送的 artifact 镜像，其 id 本地没有时转成资产拉入。
  //    同样按版本号判断：只看「本地有没有」会让重命名永远同步不过来。
  const assetIndex = await readIndex(client, cfg, 'assets');
  const localAssets = new Map((await listStoredAssets()).map(a => [a.id, a]));
  const assetStat = { blobCount: 0 };
  for (const id of assetIndex) {
    const tombstones = await getLocalTombstones();
    if (tombstones.assets.includes(id) || tombstones.favs.includes(id)) continue; // 本机已删，不拉
    const cloudVer = manifest.assetVers?.[id] ?? 0;
    const localAsset = localAssets.get(id);
    if (localAsset && cloudVer <= (applied.assets[id] ?? 0)) continue;
    // 本地有未推送的更新时保留本地（LWW），等下一轮 push 上行
    if (localAsset && localAsset.updatedAt > cloudVer) continue;
    const raw = await client.getObject(syncKey(cfg.prefix, 'assets', `${id}.json`));
    if (!raw) continue;
    const asset = JSON.parse(await raw.text()) as StoredAsset;
    // 覆盖前释放本地被换掉的 blob 引用，否则重命名/换图会让计数只增不减
    if (localAsset) await releaseReplacedAssetBlobs(localAsset, asset);
    await putStoredAsset(asset);
    await updateAppliedVersions(v => { v.assets[id] = cloudVer; });
    await pullAssetBlobs(client, cfg, asset, assetStat);
  }
  // 兼容镜像：旧版本云端只有 favs，拉下来转成 artifact 资产（id/缩略图不变）
  const favIndex = await readIndex(client, cfg, 'favs');
  const favStat = { blobCount: 0 };
  for (const id of favIndex) {
    if (localAssets.has(id)) continue;
    const tombstones = await getLocalTombstones();
    if (tombstones.assets.includes(id) || tombstones.favs.includes(id)) continue;
    const raw = await client.getObject(syncKey(cfg.prefix, 'favs', `${id}.json`));
    if (!raw) continue;
    const fav = JSON.parse(await raw.text()) as StoredFavoriteArtifact;
    const now = Date.now();
    await putStoredAsset({
      id: fav.id,
      kind: 'artifact',
      title: fav.artifact.title,
      createdAt: fav.favoritedAt,
      artifact: fav.artifact,
      thumbnailBlobId: fav.thumbnailBlobId,
      updatedAt: now,
      syncedAt: null,
    });
    if (fav.thumbnailBlobId && !isRemoteUrl(fav.thumbnailBlobId)) {
      await pullOneBlob(client, cfg, fav.thumbnailBlobId, favStat);
    }
  }
  result.pulledBlobs += assetStat.blobCount + favStat.blobCount;

  // 5. 角色：同上（纯文本记录，无 blob 依赖）。按版本号拉，
  //    否则另一端编辑过的系统提示词永远同步不过来。
  const roleIndex = await readIndex(client, cfg, 'roles');
  const localRoles = new Map((await listStoredRoles()).map(r => [r.id, r]));
  for (const id of roleIndex) {
    const tombstones = await getLocalTombstones();
    if (tombstones.roles.includes(id)) continue; // 本机已删，不拉
    const cloudVer = manifest.roleVers?.[id] ?? 0;
    const localRole = localRoles.get(id);
    if (localRole && cloudVer <= (applied.roles[id] ?? 0)) continue;
    if (localRole && localRole.updatedAt > cloudVer) continue; // 本地更新，等 push 上行
    const raw = await client.getObject(syncKey(cfg.prefix, 'roles', `${id}.json`));
    if (!raw) continue;
    const role = JSON.parse(await raw.text()) as StoredRole;
    await putStoredRole(role);
    await updateAppliedVersions(v => { v.roles[id] = cloudVer; });
  }

  // 5.5 API 设置：云端较新且本机无更新变更时整体覆盖写回（LWW）
  if (settingsService.getSyncApiSettings()) {
    const settingsCloudAt = manifest.settingsUpdatedAt ?? 0;
    const settingsMeta = await getSettingsSyncMeta();
    if (
      settingsCloudAt > (settingsMeta?.syncedAt ?? 0) &&
      settingsCloudAt > (settingsMeta?.updatedAt ?? 0)
    ) {
      await pullSettings(client, cfg, settingsCloudAt);
    }
  }

  // 缓存清单代表「这些内容本机确实收下了」，push 的删除检测完全依赖它。
  // 本轮有对象没拉成功就不提交：宁可下轮重拉，也不能让 push 把没收到的
  // 会话当成本地删除清掉并传播出去。
  if (!incomplete) {
    await setCloudManifest(manifest);
  } else {
    console.warn('[byoc] 本轮拉取不完整，保留旧清单缓存（下轮重试）');
  }
  return result;
}

async function readIndex(
  client: S3Client,
  cfg: ByocConfig,
  dir: 'history' | 'favs' | 'roles' | 'assets'
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

  // 消息：按 msgId 去重。版本判定用「上次收下的云端版本」与云端当前
  // LastModified 比较——两者同为存储服务端时钟，可比。
  // 绝不能拿本地 updatedAt 去比 LastModified：那是设备时钟对服务端时钟，
  // 手机慢几分钟就每轮全量重拉覆盖本地，快几分钟就永远拉不到新消息。
  const keys = await client.listObjects(syncKey(cfg.prefix, 'msgs', convId));
  let maxSeq = local?.headSeq ?? 0;
  await mapLimit(keys, 6, async k => {
    const msgId = fileBase(k.key);
    const existing = await withDB(db => db.get('messages', msgId));
    if (existing && (existing.cloudVersion ?? 0) >= k.lastModified) return;
    const raw = await client.getObject(k.key);
    if (!raw) return;
    const msg = JSON.parse(await raw.text()) as StoredMessage;
    // 本地有未推送的更新时保留本地（LWW），等下一轮 push 上行覆盖云端
    if (existing && existing.updatedAt > (existing.syncedAt ?? 0)) return;
    await putStoredMessage(convId, msg, existing, k.lastModified);
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
  existing: StoredMessage | undefined,
  cloudVersion: number
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

  // 覆盖写会丢掉旧内容里的图片引用：与 messageRepo.putMessage 一样，
  // 被换掉的 blob 必须按出现次数减引用，否则 refCount 永远归不了零、
  // 图片删了也不会被 GC 回收（同步路径以前漏了这一步）。
  if (existing) {
    const counts = new Map<string, number>();
    for (const id of collectMessageBlobIds(existing)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const id of collectMessageBlobIds(msg)) {
      const left = counts.get(id);
      if (left !== undefined) counts.set(id, left - 1);
    }
    const stale: string[] = [];
    for (const [id, times] of counts) {
      for (let i = 0; i < times; i++) stale.push(id);
    }
    if (stale.length) await releaseBlobs(stale);
  }

  await enqueue(convId, () =>
    withDB(async db => {
      // updatedAt 刷成本地时刻、syncedAt 同步跟上：这条内容与云端一致，
      // 不该被下一轮 push 当成本地变更再推一遍。
      // cloudVersion 记下收到的是云端哪个版本，供下轮拉取判定（同一时钟源比较）。
      await db.put('messages', {
        ...msg,
        convId,
        seq,
        updatedAt: Date.now(),
        syncedAt: Date.now(),
        cloudVersion,
      });
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

/** 拉资产引用的 blob：artifact 缩略图 + image 的 blobIds（http 上游链接除外） */
async function pullAssetBlobs(
  client: S3Client,
  cfg: ByocConfig,
  asset: StoredAsset,
  stats: { blobCount: number }
): Promise<void> {
  const ids: string[] = [];
  if (asset.thumbnailBlobId && !isRemoteUrl(asset.thumbnailBlobId)) {
    ids.push(asset.thumbnailBlobId);
  }
  for (const id of asset.blobIds ?? []) {
    if (!isRemoteUrl(id)) ids.push(id);
  }
  await pullBlobRefs(client, cfg, ids, stats);
}

/** 原样落库 imageHistory 记录（保留 id/timestamp，blobIds 引用不变） */
function putStoredHistory(item: StoredImageHistoryItem): Promise<void> {
  return enqueue('imageHistory', async () => {
    await withDB(db => db.put('imageHistory', item));
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
