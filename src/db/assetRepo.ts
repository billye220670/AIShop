/**
 * 「我的库」统一资产仓库：用户主动保存的 artifact / markdown / 图片。
 *
 * 与旧 favoriteRepo 的区别：同一套记录承载三种 kind，重命名/删除/排序
 * 只写一份逻辑。图片的 blob 处理沿用 imageHistory 的约定——base64 落成
 * blob、http 链接原样（上游链接有有效期，长期留存要靠 blob）。
 *
 * 去重策略按 kind 区分：
 * - artifact：id = artifact.id，重复保存无操作（与旧收藏一致）
 * - image：id = 源生成历史 id，重复保存无操作（一次生成整体入库）
 * - markdown：每次保存生成随机 id，但同一源消息不重复入库（sourceRef）
 */
import { withDB, enqueue } from './open';
import type { StoredAsset } from './schema';
import { putBlobFromDataUrl, releaseBlobs } from './blobRepo';
import { blobRefUrl, parseBlobRefUrl } from './messageCodec';
import type { ArtifactBlock, ImageHistoryItem } from '../types';

const QUEUE = 'assets';

/** 供 UI 使用的资产形态：blob 引用一律转成 aishop-blob: 地址 */
export interface AssetData {
  id: string;
  kind: StoredAsset['kind'];
  title: string;
  createdAt: number;
  artifact?: ArtifactBlock;
  content?: string;
  /** kind=image：aishop-blob: 引用或 http 链接 */
  urls?: string[];
  /** 卡片缩略图：artifact 用截图，image 用首图，markdown 无 */
  thumbnail?: string;
  sourceRef?: string;
}

function isRemoteUrl(id: string): boolean {
  return id.startsWith('http://') || id.startsWith('https://');
}

/** 从 urls 里挑出真正需要做引用计数的 blob id */
function realBlobIds(blobIds: string[]): string[] {
  return blobIds.filter(id => !isRemoteUrl(id));
}

/** data url 落成 blob，引用形式原样保留（与 imageHistoryRepo 同一套约定） */
async function toStoredIds(urls: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const url of urls) {
    if (url.startsWith('data:')) {
      ids.push(await putBlobFromDataUrl(url));
    } else {
      ids.push(parseBlobRefUrl(url) ?? url);
    }
  }
  return ids;
}

function fromStored(rec: StoredAsset): AssetData {
  const thumbnail =
    rec.kind === 'artifact' && rec.thumbnailBlobId
      ? blobRefUrl(rec.thumbnailBlobId)
      : rec.kind === 'image' && rec.blobIds?.[0]
        ? isRemoteUrl(rec.blobIds[0])
          ? rec.blobIds[0]
          : blobRefUrl(rec.blobIds[0])
        : undefined;
  return {
    id: rec.id,
    kind: rec.kind,
    title: rec.title,
    createdAt: rec.createdAt,
    artifact: rec.artifact,
    content: rec.content,
    urls: rec.blobIds?.map(id => (isRemoteUrl(id) ? id : blobRefUrl(id))),
    thumbnail,
    sourceRef: rec.sourceRef,
  };
}

/** 按入库时间升序（与旧收藏页顺序一致：新的追加在末尾） */
export async function listAssets(): Promise<AssetData[]> {
  const recs = await withDB(db => db.getAllFromIndex('assets', 'by_createdAt'));
  return recs.map(fromStored);
}

/** 读取原始存盘记录（云同步用），blob 引用保持原样 */
export async function listStoredAssets(): Promise<StoredAsset[]> {
  return withDB(db => db.getAllFromIndex('assets', 'by_createdAt'));
}

/** 原样落库一条记录（云同步拉取用）；已存在则整体覆盖（LWW 在调用方判断） */
export function putStoredAsset(asset: StoredAsset): Promise<void> {
  return enqueue(QUEUE, async () => {
    await withDB(db => db.put('assets', { ...asset, syncedAt: Date.now() }));
  });
}

/**
 * 保存 artifact。重复保存同一个 artifact 是无操作——
 * 不该悄悄换掉已有的缩略图。
 */
export function saveArtifact(artifact: ArtifactBlock, thumbnail: string): Promise<void> {
  return enqueue(QUEUE, async () => {
    const existing = await withDB(db => db.get('assets', artifact.id));
    if (existing) return;

    // 传进来的通常是 base64 data URL；已经是引用形式就直接用
    const thumbnailBlobId =
      parseBlobRefUrl(thumbnail) ?? (await putBlobFromDataUrl(thumbnail));
    const now = Date.now();
    await withDB(db =>
      db.put('assets', {
        id: artifact.id,
        kind: 'artifact',
        title: artifact.title,
        createdAt: now,
        artifact,
        thumbnailBlobId,
        updatedAt: now,
        syncedAt: null,
      })
    );
  });
}

/** markdown 按 sourceRef（源消息 id）查重：by_kind 索引只按 kind 过滤，
 * 同 kind 下条目不多，全量扫一遍即可 */
export async function findMarkdownBySourceRef(messageId: string): Promise<StoredAsset | undefined> {
  const all = await withDB(db => db.getAllFromIndex('assets', 'by_kind', 'markdown'));
  return all.find(a => a.sourceRef === messageId);
}

/**
 * 保存 markdown（消息纯文本）。同一源消息不重复入库，返回既有 id。
 */
export function saveMarkdown(
  messageId: string,
  title: string,
  content: string
): Promise<{ id: string; alreadySaved: boolean }> {
  return enqueue(QUEUE, async () => {
    const existing = await findMarkdownBySourceRef(messageId);
    if (existing) return { id: existing.id, alreadySaved: true };

    const id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `md-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    await withDB(db =>
      db.put('assets', {
        id,
        kind: 'markdown',
        title,
        content,
        createdAt: now,
        sourceRef: messageId,
        updatedAt: now,
        syncedAt: null,
      })
    );
    return { id, alreadySaved: false };
  });
}

/**
 * 保存一张/一批生成图片（整个历史条目入库）。重复保存无操作。
 */
export function saveImageHistory(item: ImageHistoryItem): Promise<void> {
  return enqueue(QUEUE, async () => {
    const existing = await withDB(db => db.get('assets', item.id));
    if (existing) return;

    const blobIds = await toStoredIds(item.urls);
    const now = Date.now();
    await withDB(db =>
      db.put('assets', {
        id: item.id,
        kind: 'image',
        title: item.prompt.slice(0, 50) || '图片',
        createdAt: now,
        blobIds,
        sourceRef: item.id,
        updatedAt: now,
        syncedAt: null,
      })
    );
  });
}

export function removeAsset(id: string): Promise<void> {
  return enqueue(QUEUE, async () => {
    const rec = await withDB(db => db.get('assets', id));
    if (!rec) return;
    await withDB(db => db.delete('assets', id));
    const ids = [...(rec.thumbnailBlobId ? [rec.thumbnailBlobId] : []), ...(rec.blobIds ?? [])];
    const real = realBlobIds(ids);
    if (real.length) await releaseBlobs(real);
  });
}

export function renameAsset(id: string, title: string): Promise<void> {
  return enqueue(QUEUE, () =>
    withDB(async db => {
      const tx = db.transaction('assets', 'readwrite');
      const rec = await tx.store.get(id);
      if (rec) {
        // artifact 的 title 同时存在两处，改名必须一致，否则预览头显示旧名
        const artifact = rec.artifact ? { ...rec.artifact, title } : undefined;
        await tx.store.put({ ...rec, title, artifact, updatedAt: Date.now() });
      }
      await tx.done;
    })
  );
}
