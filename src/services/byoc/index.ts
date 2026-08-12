/**
 * BYOC（自带云存储）统一出口。
 *
 * 应用侧只从这里导入：设置面板、自动调度、手动同步都走这几个函数，
 * 底层 S3 客户端 / 增量同步 / 云备份的实现细节不对外暴露。
 *
 * 自动同步策略：
 * - 启动后延迟拉取一次（云端可能有多设备的新数据）
 * - 每 60 秒检查一次待同步条数，>0 就推送（不监听具体写路径，零侵入）
 * - 页面回到前台时拉取
 * 全部只在 enabled 且配置完整时执行；任何失败都静默降级，绝不影响主流程。
 */
import { settingsService } from '../settingsService';
import type { ByocConfig, SyncResult, CloudBackupResult, ProgressFn } from './types';
import { pushLocal, pullRemote } from './incrementalSync';
import { backupToCloud, restoreFromCloud, hasCloudBackup } from './backupSync';
import {
  countPending,
  setLastSyncAt,
  getLastSyncAt,
  updateLocalTombstones,
} from './state';
import { createS3Client } from './s3Client';

/** 状态变化事件（设置面板监听后刷新展示） */
export const BYOC_STATUS_EVENT = 'aishop:byoc-status-changed';
/** 自动同步完成事件（App 层监听后刷新会话列表） */
export const BYOC_SYNC_DONE_EVENT = 'aishop:byoc-sync-done';

export function getByocConfig(): ByocConfig {
  return settingsService.getByocSettings();
}

export function updateByocConfig(patch: Partial<ByocConfig>): void {
  settingsService.setByocSettings(patch);
  dispatchStatus();
}

/** 配置完整性检查；返回错误文案，通过则返回 null */
export function validateConfig(cfg: ByocConfig): string | null {
  if (!cfg.endpoint.trim()) return '请填写 Endpoint';
  if (!cfg.bucket.trim()) return '请填写 Bucket 名称';
  if (!cfg.accessKey.trim() || !cfg.secretKey.trim()) return '请填写 AccessKey 与 SecretKey';
  return null;
}

/** 连通性测试：列一个对象即可，能返回就说明签名、网络、CORS 全通 */
export async function testConnection(cfg: ByocConfig = getByocConfig()): Promise<void> {
  const missing = validateConfig(cfg);
  if (missing) throw new Error(missing);
  const client = createS3Client(cfg);
  await client.listObjects(`${cfg.prefix}/`);
}

// ---------------- 增量同步 ----------------

let syncing = false;

/**
 * 记录本机会话删除（删除动作发生时立即写本地 tombstone）。
 *
 * 为什么删除时要主动记而不是等同步期检测：
 * 1. 删除后的自动同步可能失败（网络抖动、与另一同步冲突），失败即无重试；
 * 2. 60 秒轮询靠 countPending 感知——它统计会话/消息 diff，删掉的会话不在
 *    列表里，只有 tombstone 记录能把它变成「待同步项」；
 * 3. pushLocal 的删除传播也能以这份记录为准，不再依赖缓存清单是否完整。
 * 云端确认删除后，pullRemote 应用 tombstone 时会自动清除这里的记录。
 */
export async function recordLocalDeletions(convIds: string[]): Promise<void> {
  if (!convIds.length) return;
  await updateLocalTombstones(t => {
    const now = Date.now();
    for (const id of convIds) {
      if (!t.convs.some(x => x.id === id)) t.convs.push({ id, at: now });
    }
  });
}

/**
 * 记录本机角色删除（角色被删后由 useChat 检测列表差异时写入）。
 *
 * 与 recordLocalDeletions 同理：删除不在列表里，countPending 只按
 * updatedAt 统计看不到它，必须靠本地 tombstone 让 60 秒轮询兜底重试。
 */
export async function recordLocalRoleDeletions(roleIds: string[]): Promise<void> {
  if (!roleIds.length) return;
  await updateLocalTombstones(t => {
    for (const id of roleIds) {
      if (!t.roles.includes(id)) t.roles.push(id);
    }
  });
}

/**
 * 双向同步：先拉后推。
 *
 * 先拉：把云端（其他设备的变更与 tombstone）落到本地，再推本地变更，
 * 一轮下来两边收敛。多标签页用 Web Locks 串行，避免并发写同一批数据。
 */
export async function syncNow(
  cfg: ByocConfig = getByocConfig(),
  onProgress?: ProgressFn
): Promise<SyncResult> {
  const missing = validateConfig(cfg);
  if (missing) throw new Error(missing);
  if (syncing) throw new Error('同步正在进行中，请稍候');
  syncing = true;
  try {
    const result =
      typeof navigator !== 'undefined' && 'locks' in navigator
        ? await navigator.locks.request('aishop-byoc-sync', () => runSync(cfg, onProgress))
        : await runSync(cfg, onProgress);
    await setLastSyncAt(Date.now());
    dispatchStatus();
    return result;
  } finally {
    syncing = false;
  }
}

async function runSync(cfg: ByocConfig, onProgress?: ProgressFn): Promise<SyncResult> {
  const pulled = await pullRemote(cfg, onProgress);
  const pushed = await pushLocal(cfg, onProgress);
  const merged: SyncResult = {
    pushedConvs: pulled.pushedConvs + pushed.pushedConvs,
    pushedMessages: pulled.pushedMessages + pushed.pushedMessages,
    pushedBlobs: pulled.pushedBlobs + pushed.pushedBlobs,
    pulledConvs: pulled.pulledConvs + pushed.pulledConvs,
    pulledMessages: pulled.pulledMessages + pushed.pulledMessages,
    pulledBlobs: pulled.pulledBlobs + pushed.pulledBlobs,
    deletedConvs: pulled.deletedConvs + pushed.deletedConvs,
  };
  return merged;
}

// ---------------- 全量云备份 ----------------

/** 全量备份推送到云端（与增量层独立，文件自包含可下载） */
export async function backupNow(
  cfg: ByocConfig = getByocConfig(),
  onProgress?: ProgressFn
): Promise<CloudBackupResult> {
  const missing = validateConfig(cfg);
  if (missing) throw new Error(missing);
  const result = await backupToCloud(cfg, onProgress);
  dispatchStatus();
  return result;
}

/** 从云端最新全量备份恢复（以新 id 导入，不覆盖现有会话） */
export async function restoreNow(
  cfg: ByocConfig = getByocConfig()
): Promise<{ conversations: number; messages: number; skipped: number }> {
  const missing = validateConfig(cfg);
  if (missing) throw new Error(missing);
  const result = await restoreFromCloud(cfg);
  dispatchStatus();
  return result;
}

export async function cloudHasBackup(cfg: ByocConfig = getByocConfig()): Promise<boolean> {
  return hasCloudBackup(cfg);
}

// ---------------- 状态与自动调度 ----------------

export interface ByocStatus {
  lastSyncAt: number | null;
  pending: { convs: number; messages: number; roles: number };
}

export async function getSyncStatus(): Promise<ByocStatus> {
  const [lastSyncAt, pending] = await Promise.all([getLastSyncAt(), countPending()]);
  return { lastSyncAt, pending };
}

function dispatchStatus(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BYOC_STATUS_EVENT));
}

/** 静默同步：自动路径专用，失败只留日志，不打断用户 */
export async function safeSync(): Promise<void> {
  const cfg = getByocConfig();
  if (!cfg.enabled || validateConfig(cfg)) return;
  try {
    await syncNow(cfg);
    // 同步完成后通知 UI 层刷新（会话列表等）
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(BYOC_SYNC_DONE_EVENT));
    }
  } catch (e) {
    console.warn('[byoc] 自动同步失败（下轮重试）', e);
  }
}

/**
 * 注册自动同步（App 启动时调用一次）。
 *
 * 自动同步时机：
 * - 启动后延迟拉取（打开/刷新页面即同步一次，等首屏与数据层就绪）
 * - 页面回到前台 / 从 bfcache 恢复时拉取，赶上其他设备的变更
 * - 每 60 秒检查待同步量（会话/消息/角色），>0 就推送
 * 内部每次执行都会重新读配置，所以启动时即便还没配置也不影响——
 * 用户配好并打开开关后，下一轮定时检查自然生效。
 */
export function scheduleAutoSync(): void {
  if (typeof window === 'undefined') return;

  // 启动延迟拉取：等首屏与数据层就绪（覆盖页面打开与刷新）
  setTimeout(() => void safeSync(), 3000);

  // 周期检查待同步量（写操作后 60 秒内被兜住）
  setInterval(() => {
    if (!getByocConfig().enabled) return;
    void countPending().then(pending => {
      if (pending.convs > 0 || pending.messages > 0 || pending.roles > 0) void safeSync();
    });
  }, 60000);

  // 回到前台立即拉取，赶上其他设备的变更
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void safeSync();
  });

  // 从 bfcache 恢复时不一定触发 visibilitychange，这里兜底补一次
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void safeSync();
  });
}
