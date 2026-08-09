/**
 * 云备份层（BYOC 第一阶段能力）。
 *
 * 直接把现有的全量备份格式（backup.ts 的 BackupFile v2，图片 base64 内联、
 * 自包含）推到用户自己的桶，或从桶里拉取最新备份恢复。与增量同步共用同一个
 * S3 客户端和配置，但两者互不依赖——增量层没做好之前，这一层已经能扛住
 * "浏览器清数据=全丢"。
 */
import { buildBackup, restoreBackup } from '../backup';
import type { ByocConfig, CloudBackupResult, ProgressFn } from './types';
import { createS3Client, type S3Client } from './s3Client';

function backupsPrefix(prefix: string): string {
  return `${prefix}/backups/`;
}

function timestampName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function getClient(cfg: ByocConfig): S3Client {
  return createS3Client(cfg);
}

/**
 * 把全量备份推送到云端。
 *
 * 文件名带时间戳且可按字典序排序（YYYYMMDD-HHmm），"最新备份"就是
 * listObjects 结果里的最后一个 key。
 */
export async function backupToCloud(
  cfg: ByocConfig,
  onProgress?: ProgressFn
): Promise<CloudBackupResult> {
  const backup = await buildBackup({ onProgress });
  const key = `${backupsPrefix(cfg.prefix)}portai-backup-${timestampName()}.json`;
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  await getClient(cfg).putObject(key, blob);
  return { key, bytes: blob.size };
}

/** 云端是否存在至少一份备份 */
export async function hasCloudBackup(cfg: ByocConfig): Promise<boolean> {
  const list = await getClient(cfg).listObjects(backupsPrefix(cfg.prefix));
  return list.length > 0;
}

/**
 * 从云端最新备份恢复。
 *
 * 复用 restoreBackup 的语义：一律以新 id 导入，不覆盖现有会话，
 * 重复了让用户自己删，恢复动作永远无破坏性。
 */
export async function restoreFromCloud(
  cfg: ByocConfig
): Promise<{ conversations: number; messages: number; skipped: number }> {
  const list = await getClient(cfg).listObjects(backupsPrefix(cfg.prefix));
  if (!list.length) throw new Error('云端还没有备份');
  // key 按字典序排列，时间戳前缀保证最后一个就是最新的
  const latest = list[list.length - 1];
  const raw = await getClient(cfg).getObject(latest.key);
  if (!raw) throw new Error('备份文件不存在');
  const text = await raw.text();
  const backup = JSON.parse(text); // 结构校验交给 restoreBackup
  return restoreBackup(backup);
}
