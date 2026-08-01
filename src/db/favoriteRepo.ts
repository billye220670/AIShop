/**
 * Artifact 收藏。
 *
 * artifact 的 code 是纯文本，直接存；缩略图是 base64 JPEG，落成 blob。
 * 收藏几十个 artifact 的缩略图就能占掉 localStorage 大半配额，
 * 这也是要搬过来的原因。
 */
import { withDB, enqueue } from './open';
import type { StoredFavoriteArtifact } from './schema';
import { putBlobFromDataUrl, releaseBlobs } from './blobRepo';
import { blobRefUrl, parseBlobRefUrl } from './messageCodec';
import type { ArtifactBlock } from '../types';

const QUEUE = 'favorites';

export interface FavoriteArtifactData {
  artifact: ArtifactBlock;
  /** 缩略图地址：aishop-blob:<id> 形式，用 useBlobUrl 解析 */
  thumbnail: string;
  favoritedAt: number;
}

function fromStored(rec: StoredFavoriteArtifact): FavoriteArtifactData {
  return {
    artifact: rec.artifact,
    thumbnail: blobRefUrl(rec.thumbnailBlobId),
    favoritedAt: rec.favoritedAt,
  };
}

/** 按收藏时间升序（与原 localStorage 版本一致：新收藏的追加在末尾） */
export async function listFavorites(): Promise<FavoriteArtifactData[]> {
  const recs = await withDB(db =>
    db.getAllFromIndex('favoriteArtifacts', 'by_favoritedAt')
  );
  return recs.map(fromStored);
}

/**
 * 添加收藏。已存在则不动——重复收藏同一个 artifact 是无操作，
 * 不该悄悄换掉已有的缩略图。
 */
export function addFavorite(
  artifact: ArtifactBlock,
  thumbnail: string
): Promise<void> {
  return enqueue(QUEUE, async () => {
    const existing = await withDB(db => db.get('favoriteArtifacts', artifact.id));
    if (existing) return;

    // 传进来的通常是 base64 data URL；已经是引用形式就直接用
    const blobId = parseBlobRefUrl(thumbnail) ?? (await putBlobFromDataUrl(thumbnail));
    await withDB(db =>
      db.put('favoriteArtifacts', {
        id: artifact.id,
        artifact,
        thumbnailBlobId: blobId,
        favoritedAt: Date.now(),
      })
    );
  });
}

export function removeFavorite(artifactId: string): Promise<void> {
  return enqueue(QUEUE, async () => {
    const rec = await withDB(db => db.get('favoriteArtifacts', artifactId));
    if (!rec) return;
    await withDB(db => db.delete('favoriteArtifacts', artifactId));
    await releaseBlobs([rec.thumbnailBlobId]);
  });
}

export function renameFavorite(artifactId: string, title: string): Promise<void> {
  return enqueue(QUEUE, () =>
    withDB(async db => {
      const tx = db.transaction('favoriteArtifacts', 'readwrite');
      const rec = await tx.store.get(artifactId);
      if (rec) {
        await tx.store.put({ ...rec, artifact: { ...rec.artifact, title } });
      }
      await tx.done;
    })
  );
}
