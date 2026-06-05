import { useState } from 'react';
import { Star, X, ArrowLeft } from 'lucide-react';
import type { FavoriteArtifactData } from '../../services/storage';

interface FavoritesPanelProps {
  favorites: FavoriteArtifactData[];
  onRemoveFavorite: (artifactId: string) => void;
}

export default function FavoritesPanel({ favorites, onRemoveFavorite }: FavoritesPanelProps) {
  const [previewItem, setPreviewItem] = useState<FavoriteArtifactData | null>(null);

  // Preview 模式
  if (previewItem) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-bg-base)] overflow-hidden relative">
        {/* 返回按钮 - 固定顶部 */}
        <div className="absolute top-0 left-0 right-0 z-10 p-3">
          <button
            onClick={() => setPreviewItem(null)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/50 backdrop-blur-sm text-white/90 hover:text-white hover:bg-black/70 transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            返回收藏
          </button>
        </div>

        {/* iframe 渲染 */}
        <iframe
          srcDoc={previewItem.artifact.code}
          sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups allow-modals allow-pointer-lock"
          allow="camera; microphone; fullscreen; clipboard-write; clipboard-read; autoplay; geolocation; accelerometer; gyroscope"
          className="w-full h-full border-0 bg-white"
          title={previewItem.artifact.title}
        />
      </div>
    );
  }

  // Gallery 模式
  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-base)] overflow-hidden">
      {/* 顶部标题 */}
      <div className="px-4 py-3 border-b border-gray-700/50 bg-[var(--color-bg-primary)]">
        <h2 className="text-white font-medium text-sm">Artifact 收藏</h2>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto p-4">
        {favorites.length === 0 ? (
          /* 空状态 */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Star className="w-12 h-12 text-gray-600 mb-3" />
            <p className="text-gray-500 text-sm">还没有收藏的 Artifact</p>
          </div>
        ) : (
          /* 网格布局 */
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {favorites.map(item => (
              <div
                key={item.artifact.id}
                className="group relative rounded-xl overflow-hidden bg-[var(--color-bg-primary)] shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer border border-gray-700/30 hover:border-gray-600/50"
                onClick={() => setPreviewItem(item)}
              >
                {/* 缩略图 - 1:1 */}
                <div className="aspect-square overflow-hidden bg-gray-800">
                  <img
                    src={item.thumbnail}
                    alt={item.artifact.title}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* 底部标题 */}
                <div className="px-3 py-2">
                  <p className="text-xs text-[var(--color-text-primary)] truncate font-medium">
                    {item.artifact.title}
                  </p>
                </div>

                {/* 悬浮取消收藏按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFavorite(item.artifact.id);
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-red-500/80 opacity-0 group-hover:opacity-100 transition-all duration-200"
                  title="取消收藏"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
