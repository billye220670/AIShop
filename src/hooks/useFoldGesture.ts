import { useEffect, useRef, type RefObject } from 'react';

/**
 * 快速甩动折叠手势：在消息列表里连续快速上下滑动（不止一下）时触发回调。
 *
 * 识别方式：不是量测单次滑动速度（那分不清“想看内容的快速翻阅”和“想折叠的
 * 来回甩动”），而是统计一个时间窗口内滚动方向的反转次数——只有真的来回甩了
 * 好几次才判定为本手势，单向的快速翻页不会误触发。
 *
 * 接收外部的容器 ref（通常是 useStickToBottom 已经在用的那个滚动容器），
 * 而不是自己创建一个，这样两个 hook 可以共用同一个 DOM 节点，各自独立监听
 * 互不干扰。
 */

/**
 * 判定一次方向翻转所需的最小位移。
 * 调大能过滤惯性滚动末尾的回弹抖动——那种抖动会白送反转次数，
 * 让"只是滚得快"被误判成甩动。
 */
const MIN_DELTA_PX = 24;
/** 统计反转次数的时间窗口 */
const REVERSAL_WINDOW_MS = 1400;
/**
 * 窗口内达到这个反转次数即判定为甩动。
 * 一次"上下来回"= 2 次反转，所以 6 次约等于用户真的来回搓了三个回合，
 * 正常快速翻阅（单向为主、偶尔往回找一眼）不会命中。
 */
const REVERSAL_THRESHOLD = 6;
/** 一段同向滚动至少走这么远，才承认它是"一次甩"而不是原地微抖 */
const MIN_LEG_PX = 60;

interface Options {
  /** 消息滚动容器的 ref，与 useStickToBottom 的 containerRef 共用同一节点 */
  containerRef: RefObject<HTMLElement | null>;
  /** 识别到甩动手势时触发 */
  onFold: () => void;
  /** false 时不接管（例如已经处于折叠态，无需再次触发） */
  enabled?: boolean;
}

export function useFoldGesture({ containerRef, onFold, enabled = true }: Options) {
  const onFoldRef = useRef(onFold);
  useEffect(() => {
    onFoldRef.current = onFold;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    let lastScrollTop = el.scrollTop;
    /** null = 尚无明确方向 */
    let lastDir: 'up' | 'down' | null = null;
    /** 当前这一"段"（同方向连续滚动）已经走过的距离 */
    let legDistance = 0;
    /** 窗口内的反转时间戳 */
    let reversalTimes: number[] = [];

    const onScroll = () => {
      const top = el.scrollTop;
      const delta = top - lastScrollTop;
      lastScrollTop = top;
      if (Math.abs(delta) < MIN_DELTA_PX) return;

      const dir = delta > 0 ? 'down' : 'up';
      const now = performance.now();

      if (lastDir === null || dir === lastDir) {
        legDistance += Math.abs(delta);
      } else {
        // 只有上一段真的滑了一定距离才算一次有效反转，
        // 否则在某个位置反复微抖也能凑够次数
        if (legDistance >= MIN_LEG_PX) {
          reversalTimes = reversalTimes.filter(t => now - t <= REVERSAL_WINDOW_MS);
          reversalTimes.push(now);
          if (reversalTimes.length >= REVERSAL_THRESHOLD) {
            reversalTimes = [];
            lastDir = null;
            legDistance = 0;
            onFoldRef.current();
            return;
          }
        }
        legDistance = Math.abs(delta);
      }
      lastDir = dir;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, [containerRef, enabled]);
}
