import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({ isOpen, onClose, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number>(0);
  const startX = useRef<number>(0);
  const currentY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);
  const isHorizontalScroll = useRef<boolean>(false);
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);

  // 控制打开/关闭动画
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      // 下一帧触发进入动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimatingIn(true);
        });
      });
    } else if (shouldRender) {
      // 开始关闭动画
      setIsAnimatingIn(false);
      setIsClosing(true);
      // 动画结束后卸载组件
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 300); // 与动画时长一致
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleTouchStart = (e: React.TouchEvent) => {
    // 只在拖动手柄区域或非交互元素上启用手势
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('[role="button"]')) {
      return;
    }

    startY.current = e.touches[0].clientY;
    startX.current = e.touches[0].clientX;
    isDragging.current = true;
    isHorizontalScroll.current = false;

    // 拖拽开始时禁用过渡动画
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || !sheetRef.current) return;

    currentY.current = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const diffY = currentY.current - startY.current;
    const diffX = currentX - startX.current;

    // 检测是否为横向滚动：如果横向移动距离大于纵向移动距离，则认为是横向滚动
    if (!isHorizontalScroll.current && Math.abs(diffX) > Math.abs(diffY)) {
      isHorizontalScroll.current = true;
    }

    // 如果是横向滚动，不处理抽屉拖拽
    if (isHorizontalScroll.current) {
      return;
    }

    // 只在向下拖拽时移动抽屉
    if (diffY > 0) {
      sheetRef.current.style.transform = `translateY(${diffY}px)`;
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging.current || !sheetRef.current) return;

    // 如果是横向滚动，不处理关闭逻辑
    if (isHorizontalScroll.current) {
      isDragging.current = false;
      isHorizontalScroll.current = false;
      // 恢复过渡动画
      sheetRef.current.style.transition = '';
      return;
    }

    const diff = currentY.current - startY.current;

    // 恢复过渡动画
    sheetRef.current.style.transition = '';

    if (diff > 100) {
      onClose();
    } else {
      sheetRef.current.style.transform = '';
    }

    isDragging.current = false;
    isHorizontalScroll.current = false;
  };

  if (!shouldRender) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end">
      {/* 背景遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          isAnimatingIn && !isClosing ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div
        ref={sheetRef}
        className={`relative w-full bg-[var(--color-bg-primary)] rounded-t-3xl shadow-2xl overflow-hidden h-[85vh] flex flex-col transition-transform duration-300 ease-out ${
          isAnimatingIn && !isClosing ? 'translate-y-0' : 'translate-y-full'
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* 拖动手柄 */}
        <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing shrink-0">
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        {/* 内容区域 */}
        {children}
      </div>
    </div>,
    document.body
  );
}
