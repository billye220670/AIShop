import { useState, useCallback, useEffect } from 'react';
import type { ArtifactBlock } from '../types';
import {
  listFavorites,
  addFavorite as dbAddFavorite,
  removeFavorite as dbRemoveFavorite,
  renameFavorite as dbRenameFavorite,
  type FavoriteArtifactData,
} from '../db';

export type { FavoriteArtifactData };

/**
 * Artifact 收藏。
 *
 * 缩略图存在 IndexedDB 里，thumbnail 字段是 aishop-blob:<id> 形式，
 * 渲染处需要用 useBlobUrl 解析。
 *
 * 写库与本地 state 分别更新：先改 state 让界面立刻响应，再异步落库。
 * 收藏是低频操作，失败了下次操作会覆盖，不做回滚。
 */
export function useFavoriteArtifacts() {
  const [favorites, setFavorites] = useState<FavoriteArtifactData[]>([]);

  useEffect(() => {
    const load = () => {
      void listFavorites()
        .then(setFavorites)
        .catch(e => console.error('[useFavoriteArtifacts] 加载失败', e));
    };
    load();
  }, []);

  const addFavorite = useCallback((artifact: ArtifactBlock, thumbnail: string) => {
    setFavorites(prev => {
      if (prev.some(f => f.artifact.id === artifact.id)) return prev;
      // state 里先放传入的 base64，落库后它会被换成 blob 引用；
      // 两种形式 useBlobUrl 都认，所以中间态不影响渲染。
      return [...prev, { artifact: { ...artifact }, thumbnail, favoritedAt: Date.now() }];
    });
    void dbAddFavorite(artifact, thumbnail)
      .then(listFavorites)
      .then(setFavorites)
      .catch(e => console.error('[useFavoriteArtifacts] 收藏失败', e));
  }, []);

  const removeFavorite = useCallback((artifactId: string) => {
    setFavorites(prev => prev.filter(f => f.artifact.id !== artifactId));
    void dbRemoveFavorite(artifactId).catch(e =>
      console.error('[useFavoriteArtifacts] 取消收藏失败', e)
    );
  }, []);

  const isFavorite = useCallback(
    (artifactId: string) => favorites.some(f => f.artifact.id === artifactId),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (artifact: ArtifactBlock, thumbnail?: string) => {
      const already = favorites.some(f => f.artifact.id === artifact.id);
      if (already) {
        removeFavorite(artifact.id);
        return;
      }
      if (!thumbnail) return; // 收藏时必须有缩略图
      addFavorite(artifact, thumbnail);
    },
    [favorites, addFavorite, removeFavorite]
  );

  const renameFavorite = useCallback((artifactId: string, newTitle: string) => {
    setFavorites(prev =>
      prev.map(f =>
        f.artifact.id === artifactId
          ? { ...f, artifact: { ...f.artifact, title: newTitle } }
          : f
      )
    );
    void dbRenameFavorite(artifactId, newTitle).catch(e =>
      console.error('[useFavoriteArtifacts] 重命名失败', e)
    );
  }, []);

  return { favorites, addFavorite, removeFavorite, isFavorite, toggleFavorite, renameFavorite };
}
