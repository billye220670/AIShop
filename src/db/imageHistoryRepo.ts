/**
 * 图片生成历史。
 *
 * 生成结果有两种形态：上游返回的 http 链接，或 base64 data URL。
 * 只有后者需要落成 blob——它是撑爆 localStorage 的元凶（几十张图就到
 * 5MB 上限）。http 链接原样保留，它本身不占本地空间。
 *
 * 注意 http 链接通常有有效期，过期后图就打不开了。真正想长期留住的图
 * 需要主动下载下来存成 blob，那是另一个话题，这里不做。
 */
import { withDB, enqueue } from './open';
import type { StoredImageHistoryItem } from './schema';
import { putBlobFromDataUrl, releaseBlobs } from './blobRepo';
import { blobRefUrl, parseBlobRefUrl } from './messageCodec';
import type { ImageHistoryItem } from '../types';

/** 所有写操作共用一条队列：与 blob 引用计数的读改写保持一致 */
const QUEUE = 'imageHistory';

function isDataUrl(url: string): boolean {
  return url.startsWith('data:');
}

/**
 * blobIds 里混着两种东西：blob 的 sha-256，和上游的 http 链接。
 * 靠 http 前缀区分，不靠 id 格式猜——格式判断在链接形态变化时会静默出错。
 */
function isRemoteUrl(id: string): boolean {
  return id.startsWith('http://') || id.startsWith('https://');
}

/** 从 blobIds 里挑出真正需要做引用计数的那些 */
function realBlobIds(blobIds: string[]): string[] {
  return blobIds.filter(id => !isRemoteUrl(id));
}

/** 存盘：base64 落成 blob，其余原样 */
async function toStored(item: ImageHistoryItem): Promise<StoredImageHistoryItem> {
  const blobIds: string[] = [];
  for (const url of item.urls) {
    if (isDataUrl(url)) {
      blobIds.push(await putBlobFromDataUrl(url));
    } else {
      // 已经是引用形式说明是读出来又写回去的，别重复入库
      blobIds.push(parseBlobRefUrl(url) ?? url);
    }
  }
  return {
    id: item.id,
    blobIds,
    prompt: item.prompt,
    model: item.model,
    timestamp: item.timestamp,
    aspectRatio: item.aspectRatio,
    size: item.size,
    quality: item.quality,
    sourceImages: item.sourceImages,
    width: item.width,
    height: item.height,
    updatedAt: Date.now(),
  };
}

/**
 * 读回：blob 用 aishop-blob: 引用表示，http 链接原样。
 *
 * 与消息里的图片同一套约定，UI 侧统一用 useBlobUrl 解析。
 */
function fromStored(rec: StoredImageHistoryItem): ImageHistoryItem {
  return {
    id: rec.id,
    urls: rec.blobIds.map(id => (isRemoteUrl(id) ? id : blobRefUrl(id))),
    prompt: rec.prompt,
    model: rec.model,
    timestamp: rec.timestamp,
    aspectRatio: rec.aspectRatio,
    size: rec.size,
    quality: rec.quality,
    sourceImages: rec.sourceImages,
    width: rec.width,
    height: rec.height,
  };
}

/** 按时间升序读取全部历史（与原 localStorage 版本的顺序一致） */
export async function listImageHistory(): Promise<ImageHistoryItem[]> {
  const recs = await withDB(db => db.getAllFromIndex('imageHistory', 'by_timestamp'));
  return recs.map(fromStored);
}

/** 读取原始存盘记录（云同步用），blobIds 保持引用形式原样 */
export async function listStoredImageHistory(): Promise<StoredImageHistoryItem[]> {
  return withDB(db => db.getAllFromIndex('imageHistory', 'by_timestamp'));
}

export function putImageHistoryItem(item: ImageHistoryItem): Promise<void> {
  return enqueue(QUEUE, async () => {
    const existing = await withDB(db => db.get('imageHistory', item.id));
    const rec = await toStored(item);
    await withDB(db => db.put('imageHistory', rec));

    // 覆盖写时旧图要减引用，否则它永远不会被 GC 回收
    if (existing) {
      const kept = new Set(rec.blobIds);
      const dropped = realBlobIds(existing.blobIds.filter(id => !kept.has(id)));
      if (dropped.length) await releaseBlobs(dropped);
    }
  });
}

/** 只更新尺寸信息（瀑布流占位用），不重写图片 */
export function updateImageDimensions(
  id: string,
  width: number,
  height: number
): Promise<void> {
  return enqueue(QUEUE, () =>
    withDB(async db => {
      const tx = db.transaction('imageHistory', 'readwrite');
      const rec = await tx.store.get(id);
      // updatedAt 前移，让尺寸回填也能作为一次变更同步到其他设备
      if (rec) await tx.store.put({ ...rec, width, height, updatedAt: Date.now() });
      await tx.done;
    })
  );
}

export function deleteImageHistoryItem(id: string): Promise<void> {
  return enqueue(QUEUE, async () => {
    const rec = await withDB(db => db.get('imageHistory', id));
    if (!rec) return;
    await withDB(db => db.delete('imageHistory', id));
    // 只有真的 blob 才需要减引用，http 链接不占本地存储
    const ids = realBlobIds(rec.blobIds);
    if (ids.length) await releaseBlobs(ids);
  });
}

export function clearImageHistory(): Promise<void> {
  return enqueue(QUEUE, async () => {
    const recs = await withDB(db => db.getAll('imageHistory'));
    if (!recs.length) return;
    await withDB(async db => {
      const tx = db.transaction('imageHistory', 'readwrite');
      await Promise.all(recs.map(r => tx.store.delete(r.id)));
      await tx.done;
    });
    const ids = realBlobIds(recs.flatMap(r => r.blobIds));
    if (ids.length) await releaseBlobs(ids);
  });
}
