/**
 * 图片全屏查看器（点击消息/库里的图片时打开）。
 *
 * 固定全屏遮罩 + 手势缩放，缩放/平移算法全部由 react-zoom-pan-pinch
 * （成熟轮子，无自研算法）实现：
 * - 移动端：双指捏合缩放、单指平移（缩放后）、双击 1x ↔ 2x 缩放/还原
 * - 桌面端：滚轮缩放、左键拖动平移、双击缩放/还原
 * - 缩放中（scale > 1）单击不关闭，与系统相册一致
 * - 未缩放单击延迟 300ms 关闭，双击窗口内第二击取消关闭（避免双击缩放的第一击误关）
 * - 已缩放到最小（1x）时：向下滑动 / 继续捏合缩小 → 关闭预览（系统相册行为）；
 *   从放大状态持续缩小到 1x 不触发关闭（仅手势起始时已在 1x 才生效）
 * - 打开动画：挂载后内容从 0.85 倍放大到原尺寸 + 背景淡入（200ms）；
 *   关闭时内容轻微缩小 + 淡出（对称过渡）
 * - 右上角 X 按钮仅桌面端显示；移动端用单击/手势/系统返回键关闭
 * 通过 createPortal 挂到 body，避免被聊天列表等容器的 overflow 裁剪。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  TransformComponent,
  TransformWrapper,
  useTransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import BlobImage from './BlobImage';
import { haptic } from '../../utils/haptics';
import { useDeviceMode } from '../../platform/useDeviceMode';

interface ImageViewerProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

/** 两次点击间隔小于该值视为双击（缩放交给库处理），不关闭查看器 */
const DOUBLE_TAP_WINDOW = 300;
/** 单击关闭延迟：等待双击窗口过去，避免双击缩放的第一击误关 */
const CLICK_CLOSE_DELAY = 300;
/** 超过该缩放比例视为"缩放中"，单击不关闭 */
const ZOOMED_THRESHOLD = 1.05;

/** 手势关闭：手势起始时超过该缩放比例视为"从放大状态缩小"，不触发关闭 */
const DISMISS_SCALE_LIMIT = 1.05;
/** 手势关闭：1x 时单指下滑超过该距离（px），松手关闭 */
const PULL_DOWN_THRESHOLD = 80;
/** 手势关闭：1x 时双指距离缩小到起始的该比例以下，松手关闭 */
const PINCH_SHRINK_RATIO = 0.85;
/** 手势关闭触发后的淡出时长（ms），随后真正卸载 */
const CLOSE_ANIMATION_MS = 220;

/** 缩放容器内的图片：订阅实时缩放比例，处理"单击关闭 / 双击缩放"的区分 */
function ZoomableImage({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  // 只订阅 scale（库官方推荐的轻量订阅），其余状态不关心
  const scale = useTransformComponent(
    useCallback(({ state }) => state.scale, [])
  );
  const lastTapRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    []
  );

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 关闭逻辑自己处理，阻止冒泡到遮罩的立即关闭
    e.stopPropagation();
    const now = Date.now();
    // 双击的第二击：取消待执行的单击关闭，缩放交给库处理
    if (now - lastTapRef.current < DOUBLE_TAP_WINDOW) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      return;
    }
    lastTapRef.current = now;
    if (scale > ZOOMED_THRESHOLD) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(onClose, CLICK_CLOSE_DELAY);
  };

  return (
    <TransformComponent
      // 全屏视口：缩放后的平移查看范围是整块屏幕（内容本身收缩到图片尺寸，
      // 库据此计算平移边界，保证图片不能完全移出屏幕）
      wrapperStyle={{ width: '100%', height: '100%' }}
      contentProps={{ onClick: handleClick }}
    >
      <BlobImage
        src={src}
        alt={alt}
        draggable={false}
        className="max-w-[92vw] max-h-[85vh] object-contain rounded-lg select-none"
      />
    </TransformComponent>
  );
}

export default function ImageViewer({ src, alt = '图片', onClose }: ImageViewerProps) {
  // 桌面端保留右上角 X 按钮；移动端（安卓/手机 Web）用单击/手势/系统返回键关闭
  const isDesktop = useDeviceMode() === 'desktop';
  // 打开过渡：挂载后下一帧从"缩小态"过渡到正常尺寸（双帧确保 transition 生效）
  const [entered, setEntered] = useState(false);
  // 关闭过渡：先淡出再卸载，防重复触发
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 手势关闭检测：记录手势起始时的缩放比例与位置，仅"起始已在 1x"时生效
  const panStartRef = useRef<{ scale: number; startY: number; lastY: number; activated: boolean } | null>(null);
  const pinchStartRef = useRef<{ scale: number; dist: number; activated: boolean } | null>(null);

  const triggerClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeAnimTimerRef.current = setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(
    () => () => {
      if (closeAnimTimerRef.current) clearTimeout(closeAnimTimerRef.current);
    },
    []
  );

  // 打开动画：首帧渲染"缩小态"，下一帧切到正常尺寸触发过渡
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Esc 关闭（桌面端习惯）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Android 壳返回键：预览打开时消费 back-requested 关闭预览（而非最小化 App）
  useEffect(() => {
    const onBackRequested = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    window.addEventListener('back-requested', onBackRequested);
    return () => window.removeEventListener('back-requested', onBackRequested);
  }, [onClose]);

  // ── 手势关闭：单指下滑（仅在 1x 时有效）──
  const handlePanningStart = useCallback((ref: ReactZoomPanPinchRef, event: TouchEvent | MouseEvent) => {
    const touch = (event as TouchEvent).touches?.[0];
    if (!touch) return;
    panStartRef.current = { scale: ref.state.scale, startY: touch.clientY, lastY: touch.clientY, activated: false };
  }, []);

  const handlePanning = useCallback((_: ReactZoomPanPinchRef, event: TouchEvent | MouseEvent) => {
    const ps = panStartRef.current;
    const touch = (event as TouchEvent).touches?.[0];
    if (!ps || !touch) return;
    ps.lastY = touch.clientY;
    // 从放大状态开始的手势（缩小到 1x 途中）不触发关闭
    if (ps.scale > DISMISS_SCALE_LIMIT) return;
    if (touch.clientY - ps.startY > PULL_DOWN_THRESHOLD) ps.activated = true;
  }, []);

  const handlePanningStop = useCallback(() => {
    const ps = panStartRef.current;
    panStartRef.current = null;
    // 松手时仍在阈值外才关闭（滑回来则不关）
    if (ps?.activated && ps.lastY - ps.startY > PULL_DOWN_THRESHOLD) triggerClose();
  }, [triggerClose]);

  // ── 手势关闭：双指继续捏合缩小（仅在 1x 时有效）──
  const handlePinchStart = useCallback((ref: ReactZoomPanPinchRef, event: TouchEvent) => {
    if (event.touches.length < 2) return;
    const [t0, t1] = [event.touches[0], event.touches[1]];
    pinchStartRef.current = {
      scale: ref.state.scale,
      dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
      activated: false,
    };
  }, []);

  const handlePinch = useCallback((_: ReactZoomPanPinchRef, event: TouchEvent) => {
    const ps = pinchStartRef.current;
    if (!ps || event.touches.length < 2) return;
    if (ps.scale > DISMISS_SCALE_LIMIT) return;
    const [t0, t1] = [event.touches[0], event.touches[1]];
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    if (dist < ps.dist * PINCH_SHRINK_RATIO) ps.activated = true;
  }, []);

  const handlePinchStop = useCallback(() => {
    const ps = pinchStartRef.current;
    pinchStartRef.current = null;
    if (ps?.activated) triggerClose();
  }, [triggerClose]);

  return createPortal(
    <div
      className={`fixed inset-0 z-[200] bg-black/85 flex items-center justify-center overscroll-none transition-opacity duration-200 ${closing || !entered ? 'opacity-0' : ''}`}
      onClick={onClose}
    >
      {isDesktop && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
          aria-label="关闭"
        >
          <X className="w-5 h-5" />
        </button>
      )}
      {/* 内容过渡：打开从 0.85 倍放大，关闭轻微缩小（transform-origin 默认中心）。
          w-full h-full 必须保留：库的 wrapper 依赖父级确定高度（height:100%），
          缺了会塌陷成内容高度，缩放后图片被 overflow:hidden 裁剪 */}
      <div
        className={`w-full h-full transition-transform duration-200 ease-out ${closing ? 'scale-[0.92]' : entered ? '' : 'scale-[0.85]'}`}
      >
        <TransformWrapper
          initialScale={1}
          minScale={1}
          maxScale={4}
          limitToBounds
          centerZoomedOut
          centerOnInit
          // 双击在 1x 与 2x 之间切换（系统相册行为）
          doubleClick={{ mode: 'toggle', step: 1, animationTime: 180 }}
          wheel={{ step: 0.3 }}
          onZoomStart={() => haptic()}
          onPanningStart={handlePanningStart}
          onPanning={handlePanning}
          onPanningStop={handlePanningStop}
          onPinchStart={handlePinchStart}
          onPinch={handlePinch}
          onPinchStop={handlePinchStop}
        >
          <ZoomableImage src={src} alt={alt} onClose={onClose} />
        </TransformWrapper>
      </div>
    </div>,
    document.body
  );
}
