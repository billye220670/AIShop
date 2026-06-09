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
import { useState, useRef, useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical,
  Download,
  Trash2,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import type { PhotoItem } from './MasonryPhotoWall';

/* ============ 类型 ============ */

export interface PhotoCardProps {
  item: PhotoItem;
  /** 下载回调 */
  onDownload?: (item: PhotoItem) => void;
  /** 删除回调 */
  onDelete?: (item: PhotoItem) => void;
  /** 原生拖拽到桌面回调 */
  onNativeDrag?: (url: string) => void;
  /** 自定义拖拽结束（在应用内释放）回调 */
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
  onNativeDrag,
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
  const dragState = useRef<{
    pressed: boolean;
    active: boolean;
    startX: number;
    startY: number;
    nativeTriggered: boolean;
    visualVisible: boolean;
    posX: number;
    posY: number;
  }>({ pressed: false, active: false, startX: 0, startY: 0, nativeTriggered: false, visualVisible: false, posX: 0, posY: 0 });
  const [dragVisual, setDragVisual] = useState<{ x: number; y: number } | null>(null);
  const [dragVisualHidden, setDragVisualHidden] = useState(false);
  const dragFileUrl = useRef<string>(''); // 记录当前拖拽的文件 URL

  const thumbnailUrl = getThumbnailUrl(item);
  const originalUrl = getImageUrl(item);
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

  // ===== 自定义拖拽（pointer 事件） =====
  const DRAG_THRESHOLD = 6;

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // 仅左键
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      dragFileUrl.current = originalUrl;
      dragState.current = {
        pressed: true,
        active: false,
        startX: e.clientX,
        startY: e.clientY,
        nativeTriggered: false,
        visualVisible: false,
        posX: 0,
        posY: 0,
      };
    },
    [originalUrl],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const ds = dragState.current;
      if (!ds.pressed || ds.nativeTriggered) return; // 必须按下才处理
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      if (!ds.active && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      ds.active = true;
      setDragVisual({ x: e.clientX, y: e.clientY });

      // 鼠标移出窗口边界 → 隐藏自定义 visual，触发原生拖拽
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (e.clientX < -30 || e.clientX > W + 30 || e.clientY < -30 || e.clientY > H + 30) {
        ds.nativeTriggered = true;
        setDragVisual(null);
        if (onNativeDrag) onNativeDrag(dragFileUrl.current);
        return;
      }

      ds.posX = e.clientX;
      ds.posY = e.clientY;
      setDragVisual({ x: e.clientX, y: e.clientY });
    },
    [onNativeDrag],
  );

  const handlePointerLeave = useCallback(() => {
    const ds = dragState.current;
    if (ds.pressed && !ds.active) {
      // 按下但未开始拖拽就离开卡片，清理状态
      ds.pressed = false;
      ds.active = false;
      ds.nativeTriggered = false;
    }
  }, []);

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const ds = dragState.current;
      setDragVisual(null);
      setDragVisualHidden(false);

      if (ds.pressed && ds.active && !ds.nativeTriggered && onDragEnd) {
        // 窗口内释放：检测是否在输入区域
        onDragEnd(item, e.clientX, e.clientY);
      }

      ds.pressed = false;
      ds.active = false;
      ds.nativeTriggered = false;
      dragFileUrl.current = '';
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [item, onDragEnd],
  );

  // 卡片由外层 MasonryPhotoWall 控制高度（基于 width/height 计算），
  // 卡片内部应填满外层容器 (w-full h-full)
  return (
    <>
    <div
      ref={cardRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      className={`relative group overflow-hidden bg-gray-800 cursor-grab active:cursor-grabbing select-none w-full h-full ${className}`}
      style={{ touchAction: 'none' }}
    >
      {/* 骨架屏/占位背景色 */}
      {!loaded && !error && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse" />
      )}

      {!error && (
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
        <div className="flex justify-end pointer-events-auto">
          <button
            ref={menuBtnRef}
            onPointerDown={(e) => e.stopPropagation()}
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

    {/* 拖拽 visual */}
    {dragVisual &&
      createPortal(
        <div
          style={{
            position: 'fixed',
            left: dragVisual.x - 75,
            top: dragVisual.y - 75,
            width: 150,
            height: 150,
            pointerEvents: 'none',
            zIndex: 99999,
            borderRadius: 0,
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            opacity: dragVisualHidden ? 0 : 0.9,
            transition: 'opacity 0.05s ease',
          }}
        >
          <img
            src={thumbnailUrl}
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
