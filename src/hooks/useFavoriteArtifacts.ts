import { useState, useCallback, useEffect } from 'react';
import type { ArtifactBlock } from '../types';
import { loadFavoriteArtifacts, saveFavoriteArtifacts } from '../services/storage';
import type { FavoriteArtifactData } from '../services/storage';

export function useFavoriteArtifacts() {
  const [favorites, setFavorites] = useState<FavoriteArtifactData[]>(() => loadFavoriteArtifacts());

  // 变更后自动持久化
  useEffect(() => {
    saveFavoriteArtifacts(favorites);
  }, [favorites]);

  const addFavorite = useCallback((artifact: ArtifactBlock, thumbnail: string) => {
    setFavorites(prev => {
      // 避免重复添加
      if (prev.some(f => f.artifact.id === artifact.id)) return prev;
      return [...prev, { artifact: { ...artifact }, thumbnail, favoritedAt: Date.now() }];
    });
  }, []);

  const removeFavorite = useCallback((artifactId: string) => {
    setFavorites(prev => prev.filter(f => f.artifact.id !== artifactId));
  }, []);

  const isFavorite = useCallback((artifactId: string) => {
    return favorites.some(f => f.artifact.id === artifactId);
  }, [favorites]);

  const toggleFavorite = useCallback((artifact: ArtifactBlock, thumbnail?: string) => {
    setFavorites(prev => {
      if (prev.some(f => f.artifact.id === artifact.id)) {
        return prev.filter(f => f.artifact.id !== artifact.id);
      }
      if (!thumbnail) return prev; // 收藏时必须有缩略图
      return [...prev, { artifact: { ...artifact }, thumbnail, favoritedAt: Date.now() }];
    });
  }, []);

  const renameFavorite = useCallback((artifactId: string, newTitle: string) => {
    setFavorites(prev =>
      prev.map(f =>
        f.artifact.id === artifactId
          ? { ...f, artifact: { ...f.artifact, title: newTitle } }
          : f
      )
    );
  }, []);

  return { favorites, addFavorite, removeFavorite, isFavorite, toggleFavorite, renameFavorite };
}
