import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 吸底滚动 hook（类似 log 查看器的 tail 行为）
 *
 * 设计要点：
 * 1. "解除吸底" 只由用户输入事件触发（wheel / touchmove / 按键），
 *    绝不根据 scroll 事件的位置来解除 —— 程序滚动产生的 scroll 事件是
 *    异步派发的，用时间窗口屏蔽不可靠，会导致自动追滚随机中断。
 * 2. "恢复吸底" 只由 scroll 事件触发：滚回底部阈值内即恢复。
 * 3. 驱动源是内容高度变化（ResizeObserver），而不是 React 数据变化，
 *    保证在 DOM 真正布局完成之后才追。
 * 4. 平滑由 rAF 缓动实现，追一个持续移动的目标，不会互相打断。
 */
export function useStickToBottom<T extends HTMLElement>(options?: {
  /** 认为“已在底部”的像素阈值 */
  threshold?: number;
  /** 缓动系数，越大越快贴底 */
  ease?: number;
}) {
  const threshold = options?.threshold ?? 32;
  const ease = options?.ease ?? 0.28;

  const containerRef = useRef<T | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const pinnedRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const [isPinned, setIsPinned] = useState(true);

  const setPinned = useCallback((next: boolean) => {
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setIsPinned(next);
  }, []);

  const distanceFromBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight;

  /** 启动缓动循环，持续追当前的底部位置 */
  const startFollow = useCallback(() => {
    if (rafRef.current != null) return;
    const step = () => {
      rafRef.current = null;
      const el = containerRef.current;
      if (!el || !pinnedRef.current) return;
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      if (diff <= 0.5) {
        // 已贴底，停止循环（下次内容增长会重新启动）
        if (diff > 0) el.scrollTop = target;
        return;
      }
      // 距离过大（切换会话、历史加载）直接跳，避免长距离滚动动画
      el.scrollTop = diff > 1200 ? target : el.scrollTop + diff * ease;
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [ease]);

  /** 立即贴底并恢复吸附（用于发送消息等主动场景） */
  const scrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      const el = containerRef.current;
      setPinned(true);
      if (!el) return;
      if (behavior === 'auto') {
        el.scrollTop = el.scrollHeight - el.clientHeight;
      } else {
        startFollow();
      }
    },
    [setPinned, startFollow]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // --- 解除吸底：仅来自用户输入 ---
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) setPinned(false);
    };
    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y == null || touchY == null) return;
      // 手指往下移动 = 内容往上滚
      if (y - touchY > 2) setPinned(false);
      touchY = y;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) setPinned(false);
    };

    // --- 恢复吸底：仅根据是否滚回底部 ---
    const onScroll = () => {
      if (distanceFromBottom(el) <= threshold) {
        if (!pinnedRef.current) {
          setPinned(true);
          startFollow();
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('scroll', onScroll, { passive: true });

    // --- 驱动源：内容高度变化 ---
    const observed = contentRef.current ?? el;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) startFollow();
    });
    ro.observe(observed);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [setPinned, startFollow, threshold]);

  return { containerRef, contentRef, isPinned, scrollToBottom };
}
