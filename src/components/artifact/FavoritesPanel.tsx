import { useState, useRef, useEffect } from 'react';
import { Star, X, ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import type { FavoriteArtifactData } from '../../services/storage';
import { haptic } from '../../utils/haptics';
import PromptModal from '../common/PromptModal';
import ConfirmModal from '../common/ConfirmModal';

interface FavoritesPanelProps {
  favorites: FavoriteArtifactData[];
  onRemoveFavorite: (artifactId: string) => void;
  onRenameFavorite: (artifactId: string, newTitle: string) => void;
}

export default function FavoritesPanel({ favorites, onRemoveFavorite, onRenameFavorite }: FavoritesPanelProps) {
  const [previewItem, setPreviewItem] = useState<FavoriteArtifactData | null>(null);
  const [isEntering, setIsEntering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 长按上下文菜单
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<FavoriteArtifactData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // 长按逻辑
  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressOriginRef.current = null;
  };

  const handlePressStart = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearPressTimer();
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      suppressClickRef.current = true;
      setMenuOpenId(id);
      window.getSelection?.()?.removeAllRanges();
      haptic();
    }, LONG_PRESS_MS);
  };

  const handlePressMove = (e: React.PointerEvent) => {
    const origin = pressOriginRef.current;
    if (!origin || !pressTimerRef.current) return;
    const dx = Math.abs(e.clientX - origin.x);
    const dy = Math.abs(e.clientY - origin.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
      clearPressTimer();
    }
  };

  useEffect(() => () => clearPressTimer(), []);

  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = () => setMenuOpenId(null);
    document.addEventListener('click', handleClick);
    document.addEventListener('pointerdown', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('pointerdown', handleClick);
    };
  }, [menuOpenId]);

  const handleClose = () => {
    setIsEntering(false);
    // 等待动画结束后再真正关闭
    setTimeout(() => {
      setPreviewItem(null);
      setIsLoading(false);
    }, 300);
  };

  const handleOpenPreview = (item: FavoriteArtifactData) => {
    setPreviewItem(item);
    setIsLoading(true);
    // 下一帧触发进入动画
    requestAnimationFrame(() => {
      setIsEntering(true);
    });
    // 延迟隐藏loading（给iframe时间加载）
    setTimeout(() => {
      setIsLoading(false);
    }, 800);
  };

  // Preview 模式
  if (previewItem) {
    return (
      <div
        className={`fixed inset-0 z-[100] bg-[var(--color-bg-base)] flex flex-col transition-transform duration-300 ease-out ${
          isEntering ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ pointerEvents: isEntering ? 'auto' : 'none' }}
      >
        {/* 顶部导航栏 */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-[var(--color-bg-primary)]">
          {/* 左侧：返回按钮 */}
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10"
            title="返回"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* 中间：标题 */}
          <h1 className="absolute left-1/2 -translate-x-1/2 text-white font-medium text-base truncate max-w-[60%]">
            {previewItem.artifact.title}
          </h1>

          {/* 右侧：占位保持布局平衡 */}
          <div className="w-9" />
        </div>

        {/* iframe 渲染 */}
        <div className="flex-1 overflow-hidden relative">
          {/* Loading 动画 */}
          {isLoading && (
            <div className="absolute inset-0 bg-[var(--color-bg-base)] flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
                <span className="text-sm text-gray-400">加载中...</span>
              </div>
            </div>
          )}

          <iframe
            srcDoc={previewItem.artifact.code}
            sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups allow-modals allow-pointer-lock"
            allow="camera; microphone; fullscreen; clipboard-write; clipboard-read; autoplay; geolocation; accelerometer; gyroscope"
            className="w-full h-full border-0 bg-white"
            title={previewItem.artifact.title}
          />
        </div>
      </div>
    );
  }

  // Gallery 模式
  return (
    <>
      <div className="flex flex-col h-full bg-[var(--color-bg-base)] overflow-hidden">
        {/* 顶部标题 */}
        <div className="px-4 py-3 bg-[var(--color-bg-base)]">
          <h2 className="text-white font-medium text-lg">我的Artifact</h2>
        </div>

        {/* 长按呼出上下文菜单时的背景模糊遮罩 */}
        {menuOpenId && (
          <div
            className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay"
            onClick={() => setMenuOpenId(null)}
            onPointerDown={() => setMenuOpenId(null)}
          />
        )}

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
              {favorites.map(item => {
                const isMenuOpen = menuOpenId === item.artifact.id;
                return (
                  <div
                    key={item.artifact.id}
                    className={`group relative rounded-xl overflow-hidden bg-[var(--color-bg-primary)] shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer border border-gray-700/30 hover:border-gray-600/50 select-none [-webkit-touch-callout:none] [-webkit-user-select:none] ${
                      isMenuOpen ? 'relative z-[201] context-menu-pop' : ''
                    }`}
                    onPointerDown={e => handlePressStart(item.artifact.id, e)}
                    onPointerMove={handlePressMove}
                    onPointerUp={clearPressTimer}
                    onPointerCancel={clearPressTimer}
                    onPointerLeave={clearPressTimer}
                    onContextMenu={e => e.preventDefault()}
                    onTouchStart={e => {
                      // 阻止触摸默认行为（如长按选择文本、保存图片等）
                      if (e.touches.length === 1) {
                        e.preventDefault();
                      }
                    }}
                    onDragStart={e => e.preventDefault()}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      handleOpenPreview(item);
                    }}
                  >
                    {/* 缩略图 - 1:1 */}
                    <div className="aspect-square overflow-hidden bg-gray-800 pointer-events-none">
                      <img
                        src={item.thumbnail}
                        alt={item.artifact.title}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    </div>

                    {/* 底部标题 */}
                    <div className="px-3 py-3 pointer-events-none">
                      <p className="text-sm text-[var(--color-text-primary)] truncate font-medium">
                        {item.artifact.title}
                      </p>
                    </div>

                    {/* 悬浮取消收藏按钮 - 非菜单打开时显示 */}
                    {!isMenuOpen && (
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
                    )}

                    {/* 浮动菜单 */}
                    {isMenuOpen && (
                      <div
                        className="absolute right-2 top-2 z-[200] w-40 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2 select-none context-menu-pop"
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setRenameTarget(item);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
                        >
                          <Pencil className="w-4 h-4 flex-shrink-0" />
                          <span>重命名</span>
                        </button>
                        <button
                          onClick={() => {
                            setDeleteTarget(item.artifact.id);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 active:bg-white/10 hover:bg-white/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4 flex-shrink-0" />
                          <span>删除</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 重命名弹窗 */}
      <PromptModal
        open={renameTarget !== null}
        title="重命名 Artifact"
        initialValue={renameTarget?.artifact.title ?? ''}
        placeholder="新标题"
        confirmText="保存"
        cancelText="取消"
        maxLength={50}
        onConfirm={value => {
          if (renameTarget) {
            onRenameFavorite(renameTarget.artifact.id, value);
          }
          setRenameTarget(null);
        }}
        onCancel={() => setRenameTarget(null)}
      />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="删除 Artifact"
        message="确定要删除这个收藏的 Artifact 吗？此操作无法撤销。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (deleteTarget) onRemoveFavorite(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
