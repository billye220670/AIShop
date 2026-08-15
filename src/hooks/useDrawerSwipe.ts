import { useEffect, useRef, useState } from 'react';

/**
 * 左侧抽屉的横向滑动手势
 *
 * 交互：屏幕任意位置右滑拉出侧边栏，左滑收回。手指跟随，松手按「速度优先、
 * 距离兜底」决定吸附方向。
 *
 * 关键取舍：
 * - 方向锁。首次位移超过 AXIS_LOCK_PX 时判定主轴，横向才接管；一旦判为纵向
 *   则本次手势整体放弃，避免上下滚动列表时抽屉抖动。
 * - touchmove 必须以 { passive: false } 原生绑定。React 的 onTouchMove 是被动
 *   监听，调不了 preventDefault，页面会跟着一起滚。
 * - 手势起点落在横向可滚动元素（代码块、表格）内时不接管，让原生滚动优先。
 * - 起点在输入框/可编辑区域内不接管，否则会抢掉光标拖选。
 * - 需要屏蔽本手势的浮层（弹窗等）加 data-swipe-ignore 属性即可。
 */

/** 判定主轴所需的最小位移 */
const AXIS_LOCK_PX = 10;
/** 横向位移需超过纵向的这个倍数才算横滑，避免斜向误触发 */
const HORIZONTAL_BIAS = 1.2;

/**
 * 长按上下文菜单的遮罩（Sidebar / MessageBubble 的 portal 遮罩）是否已打开。
 * 遮罩虽然覆盖全屏，但它是 portal 到 body 的兄弟节点：长按弹出菜单时本次触摸
 * 序列的目标在 touchstart 已固定为长按的元素，后续 touchmove 不经过遮罩、
 * 仍会冒泡到本容器，遮罩自身的 onTouchMove 拦不到，只能在这里检测放弃手势。
 */
function contextMenuOpen(): boolean {
  return document.querySelector('.context-menu-overlay') !== null;
}
/** 快速滑动的速度阈值(px/ms)，超过则忽略距离直接按方向吸附 */
const FLING_VELOCITY = 0.4;
/** 慢速时的距离阈值：打开需越过 35%，关闭需回落到 65% 以下 */
const OPEN_RATIO = 0.35;
const CLOSE_RATIO = 0.65;
/**
 * 算速度只取松手前这段时间的采样。用全程均速会漏掉「慢慢拖再甩一下」，
 * 也会让中途停顿过的手势速度被低估。
 */
const VELOCITY_WINDOW_MS = 100;

interface Options {
  width: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 为 false 时完全不接管手势（例如有全屏浮层） */
  enabled?: boolean;
  /** 吸附完成时的回调，可用于触感反馈 */
  onSettle?: (open: boolean) => void;
}

/** 起点是否落在不应被抽屉手势抢走的区域内 */
function shouldIgnoreTarget(target: EventTarget | null, dx: number): boolean {
  let el = target instanceof Element ? target : null;
  while (el) {
    if (el.hasAttribute('data-swipe-ignore')) return true;

    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el instanceof HTMLElement && el.isContentEditable) return true;

    // 横向可滚动且在本次方向上还有余量 → 让给原生滚动
    if (el.scrollWidth > el.clientWidth + 1) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowX)) {
        const canScrollRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
        const canScrollLeft = el.scrollLeft > 1;
        if ((dx < 0 && canScrollRight) || (dx > 0 && canScrollLeft)) return true;
      }
    }

    el = el.parentElement;
  }
  return false;
}

export function useDrawerSwipe({ width, open, onOpenChange, enabled = true, onSettle }: Options) {
  /**
   * 拖动中抽屉露出的宽度(px)，0=完全收起，width=完全展开。
   * null 表示当前没有横滑手势，位置交回 CSS class 控制。
   */
  const [dragOffset, setDragOffset] = useState<number | null>(null);

  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  /** null=尚未判定主轴，'h'=横向接管，'v'=放弃本次手势 */
  const axisRef = useRef<'h' | 'v' | null>(null);
  /** 最近若干个采样点，用于算末段速度（见 VELOCITY_WINDOW_MS） */
  const samplesRef = useRef<{ x: number; t: number }[]>([]);
  /** 刚结束横滑，用于吞掉紧随其后的 click（避免顺带触发遮罩关闭） */
  const suppressClickRef = useRef(false);
  const targetRef = useRef<HTMLDivElement | null>(null);

  // 拖动中每帧都 setState 重渲染，这些值若进 effect 依赖会导致手势中途反复
  // 解绑/重绑监听。放进 ref 同步，让 effect 只依赖 enabled / width
  const openRef = useRef(open);
  const openChangeRef = useRef(onOpenChange);
  const settleRef = useRef(onSettle);
  useEffect(() => {
    openRef.current = open;
    openChangeRef.current = onOpenChange;
    settleRef.current = onSettle;
  });

  useEffect(() => {
    const node = targetRef.current;
    if (!node || !enabled) return;

    const reset = () => {
      startRef.current = null;
      axisRef.current = null;
      samplesRef.current = [];
      setDragOffset(null);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        reset();
        return;
      }
      // 遮罩已打开时完全不接管（防御边界情况，正常触摸遮罩不经过本容器）
      if (contextMenuOpen()) {
        reset();
        return;
      }
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY, t: e.timeStamp };
      samplesRef.current = [{ x: t.clientX, t: e.timeStamp }];
      axisRef.current = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      // 长按菜单在本次触摸中途弹出（长按 450ms 后手指未抬起继续滑）时，
      // 触摸目标已固定为长按的元素，touchmove 仍冒泡到本容器；此时必须
      // 放弃本次手势，否则背景抽屉会跟着手指滑动
      if (contextMenuOpen()) {
        reset();
        return;
      }
      const start = startRef.current;
      if (!start || axisRef.current === 'v') return;
      // 多指（缩放等）中途介入，直接放弃
      if (e.touches.length !== 1) {
        axisRef.current = 'v';
        setDragOffset(null);
        return;
      }

      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;

      if (axisRef.current === null) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;

        const isHorizontal = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS;
        // 已展开时右滑、已收起时左滑都无处可去
        const validDirection = openRef.current ? dx < 0 : dx > 0;
        if (!isHorizontal || !validDirection || shouldIgnoreTarget(e.target, dx)) {
          axisRef.current = 'v';
          return;
        }
        axisRef.current = 'h';
      }

      // 接管后阻止页面滚动/浏览器手势
      if (e.cancelable) e.preventDefault();
      const base = openRef.current ? width : 0;
      setDragOffset(Math.max(0, Math.min(width, base + dx)));

      const samples = samplesRef.current;
      samples.push({ x: t.clientX, t: e.timeStamp });
      // 只保留窗口内的点，另外始终留一个更早的点兜底（手指停住时窗口内可能没点）
      while (samples.length > 2 && e.timeStamp - samples[1].t > VELOCITY_WINDOW_MS) {
        samples.shift();
      }
    };

    const onTouchEnd = () => {
      const start = startRef.current;
      const samples = samplesRef.current;
      const last = samples[samples.length - 1];
      if (!start || axisRef.current !== 'h' || !last) {
        reset();
        return;
      }

      const base = openRef.current ? width : 0;
      const current = Math.max(0, Math.min(width, base + last.x - start.x));

      // 末段速度：窗口内最早的采样点到松手点
      const first = samples[0];
      const dt = last.t - first.t;
      const velocity = dt > 0 ? (last.x - first.x) / dt : 0;

      let next: boolean;
      if (Math.abs(velocity) > FLING_VELOCITY) {
        next = velocity > 0;
      } else {
        next = openRef.current ? current > width * CLOSE_RATIO : current > width * OPEN_RATIO;
      }

      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 300);

      // 清空 dragOffset 与更新 open 在同一次渲染里生效，transition 便从当前
      // 手指位置平滑吸附到终点
      reset();
      if (next !== openRef.current) {
        openChangeRef.current(next);
        settleRef.current?.(next);
      }
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd, { passive: true });
    node.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
      // enabled 关掉或宽度变化时清理进行中的手势，避免卡在拖动态
      reset();
    };
  }, [enabled, width]);

  return {
    /** 挂到手势容器上 */
    ref: targetRef,
    /** 是否正在跟手拖动（此时应关掉 CSS transition） */
    dragging: dragOffset !== null,
    dragOffset,
    /** 手势刚结束的这段时间内应吞掉 click */
    shouldSuppressClick: () => suppressClickRef.current,
  };
}
