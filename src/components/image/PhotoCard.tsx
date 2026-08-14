/**
 * PhotoCard - 瀑布流照片墙卡片组件
 *
 * 职责：
 * - 卡片内容渲染（图片、骨架屏、错误状态）
 * - 卡片交互（hover 覆盖层、下载、删除、拖拽）
 * - 防布局抖动（使用 aspect-ratio 或占位高度）
 *
 * 设计原则：
 * - 卡片组件可替换、可扩展
 * - 不做与"图片"强绑定的假设（未来可扩展为视频卡片等）
 * - 交互事件通过 props/回调向上暴露
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical,
  Download,
  Trash2,
  Loader2,
  TriangleAlert,
  Bookmark,
} from 'lucide-react';
import type { PhotoItem } from './MasonryPhotoWall';
import { useBlobUrl } from '../../hooks/useBlobUrl';

/* ============ 类型 ============ */

export interface PhotoCardProps {
  item: PhotoItem;
  /** 下载回调 */
  onDownload?: (item: PhotoItem) => void;
  /** 删除回调 */
  onDelete?: (item: PhotoItem) => void;
  /** 收藏到「我的库」回调（已收藏时显示状态） */
  onSave?: (item: PhotoItem) => void;
  /** 是否已在「我的库」中 */
  saved?: boolean;
  /** App 内释放回调（已在输入区域 hit-test 通过） */
  onDragEnd?: (item: PhotoItem, clientX: number, clientY: number) => void;
  /** 额外的 className */
  className?: string;
}

/** 加载中状态卡片 Props */
export interface LoadingCardProps {
  id: string;
  prompt: string;
  onCancel: (id: string) => void;
  className?: string;
}

/** 错误状态卡片 Props */
export interface ErrorCardProps {
  id: string;
  error: string;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  className?: string;
}

/* ============ 工具函数 ============ */

/** 从 PhotoItem 中提取图片 URL */
function getImageUrl(item: PhotoItem): string {
  return (item.url as string) || (item.thumbnailUrl as string) || '';
}

/** 从 PhotoItem 中提取缩略图 URL */
function getThumbnailUrl(item: PhotoItem): string {
  return (item.thumbnailUrl as string) || (item.url as string) || '';
}

/* ============ PhotoCard 组件 ============ */

export default function PhotoCard({
  item,
  onDownload,
  onDelete,
  onSave,
  saved = false,
  onDragEnd,
  className = '',
}: PhotoCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // 图片存在 IndexedDB 里时地址是 aishop-blob:<id>，需要换成 object URL。
  // useBlobUrl 对普通 http 链接原样返回，所以两种来源都能直接套。
  //
  // 解析中返回 undefined，此时不能给 <img> 一个空 src——那会立刻触发 onError
  // 把卡片判成加载失败。下面用 thumbnailUrl 是否存在来决定渲不渲染 <img>。
  const thumbnailUrl = useBlobUrl(getThumbnailUrl(item));
  const originalUrl = useBlobUrl(getImageUrl(item));
  const prompt = (item.prompt as string) || '';
  const model = (item.model as string) || '';

  // 点击菜单外部关闭
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current && !menuBtnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  // App 内拖拽：鼠标追踪 + hit-test
  const DRAG_THRESHOLD = 6;
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    url: string;
    nativeFired: boolean;
  }>({ active: false, startX: 0, startY: 0, url: '', nativeFired: false });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragHidden, setDragHidden] = useState(false);

  // Electron 原生拖拽：主进程 startDrag 只能同步处理 data:/local-image://，
  // IndexedDB 图片是 blob: object URL，需预转换为 data URL 缓存，拖拽时同步取用
  const nativeDragDataUrlRef = useRef('');
  useEffect(() => {
    if (!window.electronAPI?.startDrag || !originalUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(originalUrl);
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          if (!cancelled && typeof reader.result === 'string') {
            nativeDragDataUrlRef.current = reader.result;
          }
        };
        reader.readAsDataURL(blob);
      } catch {
        // 转换失败：保持空值，拖拽时退回 App 内拖拽（与 Web 行为一致）
      }
    })();
    return () => { cancelled = true; };
  }, [originalUrl]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // 还没解析出地址就不启动拖拽
      const url = originalUrl ?? '';
      dragRef.current = { active: false, startX: e.clientX, startY: e.clientY, url, nativeFired: false };

      const onWindowMove = (ev: MouseEvent) => {
        const dr = dragRef.current;
        if (dr.nativeFired) return;
        const dx = ev.clientX - dr.startX;
        const dy = ev.clientY - dr.startY;
        if (!dr.active && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

        // Electron：超过阈值即转原生拖拽到桌面（sendSync 同步，拖拽窗口期内有效）
        const api = window.electronAPI;
        if (api?.startDrag && nativeDragDataUrlRef.current) {
          dr.nativeFired = true;
          api.startDrag(nativeDragDataUrlRef.current);
          return;
        }

        dr.active = true;

        setDragPos({ x: ev.clientX, y: ev.clientY });
      };

      const onWindowUp = (ev: MouseEvent) => {
        const dr = dragRef.current;
        window.removeEventListener('mousemove', onWindowMove);
        window.removeEventListener('mouseup', onWindowUp);
        setDragPos(null);
        setDragHidden(false);

        if (dr.active && !dr.nativeFired && onDragEnd) {
          onDragEnd(item, ev.clientX, ev.clientY);
        }

        dr.active = false;
      };

      window.addEventListener('mousemove', onWindowMove);
      window.addEventListener('mouseup', onWindowUp, { once: false });
    },
    [originalUrl, item, onDragEnd],
  );

  // 卡片由外层 MasonryPhotoWall 控制高度（基于 width/height 计算），
  // 卡片内部应填满外层容器 (w-full h-full)
  return (
    <>
    <div
      ref={cardRef}
      onMouseDown={handleMouseDown}
      className={`relative group overflow-hidden bg-gray-800 cursor-grab active:cursor-grabbing select-none w-full h-full ${className}`}
    >
      {/* 骨架屏/占位背景色。thumbnailUrl 为空表示还在从库里取地址，也算加载中 */}
      {(!loaded || !thumbnailUrl) && !error && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse" />
      )}

      {!error && thumbnailUrl && (
        <img
          ref={imgRef}
          src={thumbnailUrl}
          alt={prompt}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          onDragStart={(e) => e.preventDefault()}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <TriangleAlert className="w-6 h-6 text-gray-500" />
        </div>
      )}

      {/* Hover overlay - pointer-events-none 防止阻挡拖拽 */}
      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3 pointer-events-none">
        <div className="flex justify-end pointer-events-auto gap-1.5">
          {/* 收藏到我的库 */}
          {onSave && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSave(item);
              }}
              className={`w-7 h-7 flex items-center justify-center backdrop-blur-sm rounded-md transition-colors ${
                saved
                  ? 'bg-yellow-500/30 text-yellow-400'
                  : 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white'
              }`}
              title={saved ? '已保存到我的库' : '保存到我的库'}
            >
              <Bookmark className="w-4 h-4" fill={saved ? 'currentColor' : 'none'} />
            </button>
          )}
          <button
            ref={menuBtnRef}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="w-7 h-7 flex items-center justify-center bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white/80 hover:text-white rounded-md transition-colors"
            title="更多"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
        <div>
          <p className="text-xs text-white/90 line-clamp-3">{prompt}</p>
          {model && (
            <p className="text-[10px] text-gray-300 mt-1">{model}</p>
          )}
        </div>
      </div>

      {/* 上下文菜单 */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute top-11 right-3 z-50 min-w-[120px] py-1 rounded-lg shadow-xl backdrop-blur-md border overflow-hidden"
          style={{
            backgroundColor: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onDownload && (
            <button
              onClick={() => {
                onDownload(item);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white transition-colors"
              style={{ backgroundColor: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Download className="w-3.5 h-3.5" />
              下载
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => {
                onDelete(item);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 transition-colors"
              style={{ backgroundColor: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>
          )}
        </div>
      )}
    </div>

    {/* 拖拽 visual — 跟随鼠标的浮动缩略图 */}
    {dragPos &&
      createPortal(
        <div
          style={{
            position: 'fixed',
            left: dragPos.x - 75,
            top: dragPos.y - 75,
            width: 150,
            height: 150,
            pointerEvents: 'none',
            zIndex: 99999,
            borderRadius: 0,
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            opacity: dragHidden ? 0 : 0.9,
            transition: 'opacity 0.05s ease',
          }}
        >
          <img
            src={thumbnailUrl ?? undefined}
            alt="drag"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            draggable={false}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

/* ============ LoadingCard 组件 ============ */

export function LoadingCard({ id, prompt, onCancel, className = '' }: LoadingCardProps) {
  return (
    <div
      className={`relative overflow-hidden bg-gray-800 animate-pulse w-full h-full ${className}`}
    >
      <div className="flex flex-col items-center justify-center h-full p-3 text-center">
        <Loader2 className="animate-spin h-8 w-8 text-blue-500 mb-2" />
        <p className="text-xs text-gray-400 line-clamp-2">{prompt}</p>
        <button
          onClick={() => onCancel(id)}
          className="mt-2 text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
}

/* ============ ErrorCard 组件 ============ */

export function ErrorCard({ id, error, onRetry, onDismiss, className = '' }: ErrorCardProps) {
  return (
    <div
      className={`relative overflow-hidden bg-red-950/40 w-full h-full ${className}`}
    >
      <div className="flex flex-col items-center justify-center h-full p-3 text-center">
        <TriangleAlert className="h-8 w-8 text-red-400 mb-2" />
        <p className="text-xs text-red-400 line-clamp-2 mb-2">{error}</p>
        <div className="flex gap-2">
          <button
            onClick={() => onRetry(id)}
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            重试
          </button>
          <button
            onClick={() => onDismiss(id)}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
