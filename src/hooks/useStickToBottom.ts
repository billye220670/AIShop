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
  /**
   * 判定“离底部很远”的距离，单位为容器可视高度的倍数。
   * 1 = 距底部超过一个屏高，此时值得给用户一个“回到底部”的入口。
   */
  farScreens?: number;
}) {
  const threshold = options?.threshold ?? 32;
  const ease = options?.ease ?? 0.28;
  const farScreens = options?.farScreens ?? 1;

  const containerRef = useRef<T | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  /** 本轮缓动是否允许长距离动画（用户主动点击回到底部） */
  const animateLongRef = useRef(false);
  const [isPinned, setIsPinned] = useState(true);
  const [isFarFromBottom, setIsFarFromBottom] = useState(false);

  const setPinned = useCallback((next: boolean) => {
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setIsPinned(next);
  }, []);

  const distanceFromBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight;

  /** 更新“离底部是否超过 farScreens 个屏高” */
  const syncFar = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const far = distanceFromBottom(el) > el.clientHeight * farScreens;
    setIsFarFromBottom(prev => (prev === far ? prev : far));
  }, [farScreens]);

  /**
   * 启动缓动循环，持续追当前的底部位置
   *
   * animateLongDistance = true 时不走"距离过大直接跳"的捷径，
   * 用于用户主动点击"回到底部"这类需要看到滚动过程的场景。
   */
  const startFollow = useCallback(
    (animateLongDistance = false) => {
      if (animateLongDistance) animateLongRef.current = true;
      if (rafRef.current != null) return;
      const step = () => {
        rafRef.current = null;
        const el = containerRef.current;
        if (!el || !pinnedRef.current) {
          animateLongRef.current = false;
          return;
        }
        const target = el.scrollHeight - el.clientHeight;
        const diff = target - el.scrollTop;
        if (diff <= 0.5) {
          // 已贴底，停止循环（下次内容增长会重新启动）
          if (diff > 0) el.scrollTop = target;
          animateLongRef.current = false;
          return;
        }
        // 距离过大（切换会话、历史加载）直接跳，避免长距离滚动动画
        if (diff > 1200 && !animateLongRef.current) {
          el.scrollTop = target;
        } else {
          // 保证每帧至少推进一点，避免尾段无限趋近导致收尾拖沓
          el.scrollTop += Math.max(diff * ease, Math.min(diff, 2));
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [ease]
  );

  /** 立即贴底并恢复吸附（用于发送消息等主动场景） */
  const scrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' | 'smooth-long' = 'smooth') => {
      const el = containerRef.current;
      setPinned(true);
      setIsFarFromBottom(false);
      if (!el) return;
      if (behavior === 'auto') {
        el.scrollTop = el.scrollHeight - el.clientHeight;
      } else {
        startFollow(behavior === 'smooth-long');
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
      syncFar();
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
      syncFar();
    });
    ro.observe(observed);
    if (observed !== el) ro.observe(el);
    syncFar();

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
  }, [setPinned, startFollow, syncFar, threshold]);

  return { containerRef, contentRef, isPinned, isFarFromBottom, scrollToBottom };
}
