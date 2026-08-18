/**
 * 消息里的图片。
 *
 * 图片解析逻辑在 common/BlobImage，这里只负责消息里的占位与失效样式。
 * 显示尺寸参考微信用户发图：默认横图最宽 240px、竖图最高 360px，小图原样不放大；
 * 用户上传的图片通过 maxWidth/maxHeight 传更小的上限（160×240，缩略图观感）。
 * 加载完成前按 4:3 预估占位，拿到自然尺寸后再按比例落到真实大小。
 * 聊天内生图的图片：请求时已知宽高比（initialSize），占位与最终渲染同尺寸，图片回传不跳变。
 * 点击图片打开全屏查看器（ImageViewer）。
 *
 * 上下文菜单：
 *  - 移动端（触屏）：长按图片弹出，样式与消息长按菜单一致。长按在图片的 pointerdown 上
 *    stopPropagation，避免同时触发外层消息气泡的长按菜单。
 *  - PC 端（electron / web，精确指针）：hover 到图片右上角出现三点图标，点击弹出悬浮菜单。
 * 菜单项：保存到本地 / 高清处理 / 去除背景 / 修改图片（塞回聊天输入框）。
 */
import { useMemo, useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, MoreVertical, Download, Wand2, Eraser, Pencil, Loader2 } from 'lucide-react';
import BlobImage from '../common/BlobImage';
import ImageViewer from '../common/ImageViewer';
import Toast from '../common/Toast';
import { BUBBLE_IMAGE_MAX_WIDTH, BUBBLE_IMAGE_MAX_HEIGHT } from '../../utils/imageDisplaySize';
import { useDeviceMode } from '../../platform/useDeviceMode';
import { haptic } from '../../utils/haptics';
import {
  saveImageToDevice,
  processImageAction,
  resolveImageDataUrl,
  dispatchAttachChatImage,
  dispatchPostImageMessage,
  SAVE_SHARE_CANCELED,
} from '../../services/imageContextActions';

interface MessageImageProps {
  src: string;
  alt?: string;
  /** 已知请求比例时按显示规则预计算的占位尺寸：加载占位与最终渲染一致，避免图片回传时跳变 */
  initialSize?: { width: number; height: number };
  /** 显示尺寸上限：默认聊天气泡图上限；用户上传的图片传更小的上限（微信式缩略图） */
  maxWidth?: number;
  maxHeight?: number;
}

/** 长按超过该时长判定为触发上下文菜单，其后的 click 不再打开查看器 */
const LONG_PRESS_MS = 450;
/** 长按判定允许的指针位移，超过即视为滑动/滚动而非长按 */
const LONG_PRESS_MOVE_TOLERANCE = 10;

/** 图片悬浮菜单项定义 */
interface MenuAction {
  key: 'download' | 'upscale' | 'bgRemove' | 'attach';
  label: string;
  icon: typeof Download;
}

const MENU_ACTIONS: MenuAction[] = [
  { key: 'download', label: '保存到本地', icon: Download },
  { key: 'upscale', label: '高清处理', icon: Wand2 },
  { key: 'bgRemove', label: '去除背景', icon: Eraser },
  { key: 'attach', label: '修改图片', icon: Pencil },
];

export default function MessageImage({ src, alt = '图片', initialSize, maxWidth = BUBBLE_IMAGE_MAX_WIDTH, maxHeight = BUBBLE_IMAGE_MAX_HEIGHT }: MessageImageProps) {
  // 尺寸和 src 绑定：src 变化（hydrate 时 dataURL → aishop-blob:<id>）时
  // 旧尺寸自动作废回占位，无需 effect 手动重置
  const [loaded, setLoaded] = useState<{ src: string; w: number; h: number } | null>(null);
  const current = loaded && loaded.src === src ? loaded : null;
  const [viewerOpen, setViewerOpen] = useState(false);
  // 按压开始时间：长按后的 click 不应打开查看器（长按菜单会同时出现）
  const pressStartRef = useRef(0);

  // ---- 上下文菜单状态 ----
  const isDesktop = useDeviceMode() === 'desktop' && window.matchMedia('(pointer: fine)').matches;
  const [menuOpen, setMenuOpen] = useState(false);
  // 菜单锚点：长按 = 手指视口坐标；三点按钮 = 按钮 rect 的右上角（fixed 坐标）
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'loading' | 'success' | 'error' } | null>(null);

  // 长按检测（移动端）：在图片的 pointerdown 上 stopPropagation，避免冒泡到消息气泡的长按
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressOriginRef.current = null;
  }, []);

  /** 打开菜单（固定视口坐标） */
  const openMenuAt = useCallback(
    (x: number, y: number) => {
      setMenuAnchor({ x, y });
      setMenuOpen(true);
      window.getSelection?.()?.removeAllRanges();
      haptic();
    },
    []
  );

  // 菜单打开时锁背景滚动（与消息长按菜单一致）
  useEffect(() => {
    if (!menuOpen) return;
    const scroller = document.querySelector<HTMLElement>('[data-messages-container]');
    if (!scroller) return;
    const prevOverflow = scroller.style.overflowY;
    const prevTouch = scroller.style.touchAction;
    scroller.style.overflowY = 'hidden';
    scroller.style.touchAction = 'none';
    return () => {
      scroller.style.overflowY = prevOverflow;
      scroller.style.touchAction = prevTouch;
    };
  }, [menuOpen]);

  // 点外部 / Esc 关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenuOpen(false); });
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('click', close);
    };
  }, [menuOpen]);

  // 菜单定位：根据锚点朝手指/按钮右下方展开，放不下翻到另一侧，末尾夹进边距
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menuOpen || !el || !menuAnchor) return;
    const GAP = 6;
    const MARGIN = 8;
    el.style.maxHeight = '';
    el.style.overflowY = '';
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const offsetX = vv?.offsetLeft ?? 0;
    const offsetY = vv?.offsetTop ?? 0;
    const minX = offsetX + MARGIN;
    const maxX = offsetX + vw - MARGIN;
    const minY = offsetY + MARGIN;
    const maxY = offsetY + vh - MARGIN;

    const anchorX = menuAnchor.x + offsetX;
    const anchorY = menuAnchor.y + offsetY;

    let left = anchorX + GAP;
    if (left + width > maxX) left = anchorX - GAP - width;
    left = Math.min(Math.max(left, minX), Math.max(minX, maxX - width));

    let top = anchorY + GAP;
    const spaceBelow = maxY - (anchorY + GAP);
    const spaceAbove = anchorY - GAP - minY;
    if (height > spaceBelow) {
      if (height <= spaceAbove) {
        top = anchorY - GAP - height;
      } else {
        const usable = Math.max(spaceBelow, spaceAbove);
        el.style.maxHeight = `${Math.max(120, usable)}px`;
        el.style.overflowY = 'auto';
        top = spaceAbove > spaceBelow ? minY : anchorY + GAP;
      }
    }
    const finalHeight = el.offsetHeight;
    top = Math.min(Math.max(top, minY), Math.max(minY, maxY - finalHeight));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transformOrigin = `${top > anchorY ? 'top' : 'bottom'} ${left >= anchorX ? 'left' : 'right'}`;
    el.style.visibility = 'visible';
  }, [menuOpen, menuAnchor]);

  useEffect(() => () => clearPressTimer(), [clearPressTimer]);

  // 移动端长按开始：记录按压起点与开启计时；stopPropagation 阻止消息气泡的长按同时触发
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // 冒泡到消息级长按检测：图片的长按优先，不让外层消息菜单抢走手势
    e.stopPropagation();
    clearPressTimer();
    pressStartRef.current = Date.now();
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      openMenuAt(e.clientX, e.clientY);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const origin = pressOriginRef.current;
    if (!origin || !pressTimerRef.current) return;
    if (
      Math.abs(e.clientX - origin.x) > LONG_PRESS_MOVE_TOLERANCE ||
      Math.abs(e.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE
    ) {
      clearPressTimer();
    }
  };

  // PC 三点按钮：以按钮右上角为锚点打开
  const handleMoreClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    openMenuAt(rect.left, rect.top);
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  };

  // 执行菜单动作
  const runAction = async (action: MenuAction['key']) => {
    setMenuOpen(false);
    if (action === 'download') {
      // 保存可能耗时（解析大图 + 写相册），先立刻给个带转圈的"正在保存"，完成后再替换结果
      setToast({ message: '正在保存…', type: 'loading' });
      try {
        await saveImageToDevice(src, alt);
        setToast({ message: '已保存到本地', type: 'success' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : '保存失败';
        // 用户在系统分享面板取消不算失败，静默关掉 loading
        setToast(msg === SAVE_SHARE_CANCELED ? null : { message: msg, type: 'error' });
      }
      return;
    }
    if (action === 'attach') {
      try {
        const dataUrl = await resolveImageDataUrl(src);
        dispatchAttachChatImage(dataUrl);
      } catch (e) {
        showToast(e instanceof Error ? e.message : '读取图片失败', 'error');
      }
      return;
    }
    // upscale / bgRemove：处理中 → 结果插入当前会话（App 层转发给 useChat）
    if (processing) return;
    setProcessing(true);
    try {
      const kind = action === 'upscale' ? 'upscale' : 'bgRemove';
      const resultUrl = await processImageAction(kind, src);
      const title = kind === 'upscale' ? '已为您高清放大' : '已为您去除背景';
      dispatchPostImageMessage(title, [resultUrl]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '处理失败，请稍后重试', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const style = useMemo(() => {
    if (current) {
      const scale = Math.min(1, maxWidth / current.w, maxHeight / current.h);
      return { width: Math.round(current.w * scale), height: Math.round(current.h * scale) };
    }
    return initialSize ? { width: initialSize.width, height: initialSize.height } : undefined;
  }, [current, initialSize, maxWidth, maxHeight]);

  return (
    <>
      <div
        className={`relative inline-block ${isDesktop ? 'group' : ''}`}
        onPointerDown={isDesktop ? undefined : handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearPressTimer}
        onPointerCancel={clearPressTimer}
        onPointerLeave={clearPressTimer}
        onClick={() => {
          // PC 端点按（开查看器）走 BlobImage 自己的 onClick；这里只管移动端点按
          if (isDesktop) return;
          // 长按松手后紧随的 click 不该打开查看器（菜单已弹出）
          if (Date.now() - pressStartRef.current > LONG_PRESS_MS) return;
          setViewerOpen(true);
        }}
      >
        <BlobImage
          src={src}
          alt={alt}
          className="max-w-full rounded-lg cursor-pointer select-none"
          style={style}
          onClick={isDesktop ? (e) => { e.stopPropagation(); setViewerOpen(true); } : undefined}
          onLoad={e => {
            const el = e.currentTarget;
            if (el.naturalWidth > 0) {
              setLoaded({ src, w: el.naturalWidth, h: el.naturalHeight });
            }
          }}
          placeholder={
            <div
              className={`animate-pulse rounded-lg bg-black/5 dark:bg-white/5 ${initialSize ? '' : 'h-44 w-60'}`}
              style={initialSize ? { width: initialSize.width, height: initialSize.height } : undefined}
            />
          }
          fallback={
            <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs text-black/40 dark:bg-white/5 dark:text-white/40">
              <ImageOff size={14} />
              图片已不可用
            </div>
          }
        />

        {/* PC 端：hover 显示三点图标 */}
        {isDesktop && !processing && (
          <button
            type="button"
            onClick={handleMoreClick}
            onPointerDown={e => e.stopPropagation()}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[var(--color-bg-elevated)] border border-white/10 text-gray-400 hover:text-white hover:bg-[var(--color-bg-hover)] flex items-center justify-center shadow transition-all opacity-0 group-hover:opacity-100"
            aria-label="图片操作"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        )}

        {/* 处理中遮罩 */}
        {processing && (
          <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center z-10">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* 背景遮罩：变暗 + 模糊（与消息长按菜单一致），点击关闭 */}
      {menuOpen && createPortal(
        <div
          className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay touch-none overscroll-none"
          onClick={() => setMenuOpen(false)}
          onPointerDown={() => setMenuOpen(false)}
          onTouchMove={e => e.preventDefault()}
        />,
        document.body
      )}

      {/* 悬浮菜单 */}
      {menuOpen && menuAnchor && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
          className="z-[200] w-52 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2 select-none context-menu-pop"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          {MENU_ACTIONS.map(action => (
            <button
              key={action.key}
              onClick={() => { runAction(action.key); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
            >
              <action.icon className="w-5 h-5 flex-shrink-0" />
              <span>{action.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}

      {viewerOpen && <ImageViewer src={src} alt={alt} onClose={() => setViewerOpen(false)} />}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}
