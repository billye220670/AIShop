/**
 * 二进制仓库：内容寻址存储 + 引用计数。
 *
 * blobId 取字节的 sha-256，所以同一张图片粘贴两次只占一份空间。
 * 引用计数归零不立即删除，交给 sweepOrphanBlobs 批量清理——
 * 删消息的路径上不该再多一次写事务。
 */
import { withDB, enqueue } from './open';
import type { StoredBlob } from './schema';

/** 所有 blob 写操作共用一条队列：refCount 是读改写，必须串行 */
const BLOB_QUEUE = 'blobs';

async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 读取图片尺寸，失败时返回空对象（尺寸只用于瀑布流占位，不是必需信息） */
async function readDimensions(blob: Blob): Promise<{ width?: number; height?: number }> {
  if (!blob.type.startsWith('image/')) return {};
  // createImageBitmap 在 iOS Safari 16.4+ 可用；失败就放弃尺寸
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();
    return { width, height };
  } catch {
    return {};
  }
}

/**
 * 存入 blob 并返回其 id。
 *
 * 已存在相同内容时只递增引用计数，不重复写字节。
 */
export function putBlob(blob: Blob): Promise<string> {
  return enqueue(BLOB_QUEUE, async () => {
    const buf = await blob.arrayBuffer();
    const blobId = await sha256(buf);
    const dims = await readDimensions(blob);

    return withDB(async db => {
      const tx = db.transaction('blobs', 'readwrite');
      const existing = await tx.store.get(blobId);
      if (existing) {
        existing.refCount += 1;
        await tx.store.put(existing);
      } else {
        const record: StoredBlob = {
          blobId,
          blob,
          mime: blob.type || 'application/octet-stream',
          bytes: blob.size,
          ...dims,
          refCount: 1,
          createdAt: Date.now(),
        };
        await tx.store.put(record);
      }
      await tx.done;
      return blobId;
    });
  });
}

/** 从 data URL 存入。用于粘贴/上传路径拿到的仍是 base64 的场景。 */
export async function putBlobFromDataUrl(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  return putBlob(await res.blob());
}

export function getBlob(blobId: string): Promise<StoredBlob | undefined> {
  return withDB(db => db.get('blobs', blobId));
}

export function getBlobs(blobIds: string[]): Promise<Array<StoredBlob | undefined>> {
  return withDB(async db => {
    const tx = db.transaction('blobs', 'readonly');
    const out = await Promise.all(blobIds.map(id => tx.store.get(id)));
    await tx.done;
    return out;
  });
}

/** 递增引用（消息被复制到新会话等场景） */
export function retainBlobs(blobIds: string[]): Promise<void> {
  return adjustRefCounts(blobIds, 1);
}

/** 递减引用。归零的记录留给 sweepOrphanBlobs。 */
export function releaseBlobs(blobIds: string[]): Promise<void> {
  return adjustRefCounts(blobIds, -1);
}

/**
 * 按出现次数调整引用计数。
 *
 * 必须计重复项，不能去重：putBlob 是每引用一次就 +1（同一条消息里放两张
 * 相同的图会让 refCount 变成 2），所以释放时也要按次数减，否则计数永远
 * 归不了零、blob 永远不会被回收。
 */
function adjustRefCounts(blobIds: string[], delta: number): Promise<void> {
  if (!blobIds.length) return Promise.resolve();

  const counts = new Map<string, number>();
  for (const id of blobIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  return enqueue(BLOB_QUEUE, () =>
    withDB(async db => {
      const tx = db.transaction('blobs', 'readwrite');
      for (const [id, times] of counts) {
        const record = await tx.store.get(id);
        if (!record) continue;
        record.refCount = Math.max(0, record.refCount + delta * times);
        await tx.store.put(record);
      }
      await tx.done;
    })
  );
}

/**
 * 清理引用计数为 0 的 blob，返回释放的字节数。
 *
 * 适合在启动后空闲时或设置页手动触发，不要放在删除操作的关键路径上。
 */
export function sweepOrphanBlobs(): Promise<number> {
  return enqueue(BLOB_QUEUE, () =>
    withDB(async db => {
      const tx = db.transaction('blobs', 'readwrite');
      let freed = 0;
      let cursor = await tx.store.openCursor();
      while (cursor) {
        if (cursor.value.refCount <= 0) {
          freed += cursor.value.bytes;
          await cursor.delete();
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      return freed;
    })
  );
}

/** 存储占用概览，供设置页展示 */
export async function getBlobStats(): Promise<{ count: number; bytes: number; orphanBytes: number }> {
  return withDB(async db => {
    let count = 0;
    let bytes = 0;
    let orphanBytes = 0;
    const tx = db.transaction('blobs', 'readonly');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      count += 1;
      bytes += cursor.value.bytes;
      if (cursor.value.refCount <= 0) orphanBytes += cursor.value.bytes;
      cursor = await cursor.continue();
    }
    await tx.done;
    return { count, bytes, orphanBytes };
  });
}
