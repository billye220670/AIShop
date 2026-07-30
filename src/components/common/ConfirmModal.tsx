import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';

export type ConfirmModalVariant = 'danger' | 'warning' | 'info';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmModalVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_BUTTON_CLASSES: Record<ConfirmModalVariant, string> = {
  danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500/50',
  warning: 'bg-yellow-600 hover:bg-yellow-700 text-white focus:ring-yellow-500/50',
  info: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500/50',
};

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'info',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // 控制可见状态（驱动过渡动画）
  const [visible, setVisible] = useState(false);
  // mounted 为派生值：open=true 或退出动画尚未结束（visible 仍为 true）时保持挂载
  const mounted = open || visible;

  // 同步 open 状态：打开时下一帧触发进入动画；关闭时延迟将 visible 置为 false，
  // 保留 DOM 直到退出动画结束，之后 mounted 自然变为 false 完成卸载
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => setVisible(false), 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  // ESC 关闭 + 阻止背景滚动
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onCancel]);

  if (!mounted) return null;

  // 实际可见态：open 与 visible 同时为 true 才显示开启样式，
  // 关闭时 open 立即变 false，触发退出动画（visible 在 200ms 后才变 false）
  const shown = open && visible;
  const overlayStyle: CSSProperties = {
    transition: 'opacity 200ms ease-out',
    opacity: shown ? 1 : 0,
  };
  const panelStyle: CSSProperties = {
    transition: 'opacity 200ms ease-out, transform 200ms ease-out',
    opacity: shown ? 1 : 0,
    transform: shown ? 'scale(1)' : 'scale(0.95)',
  };

  // 挂到 body：侧边栏等祖先带 transform 会成为 fixed 的包含块，导致弹窗在抽屉内居中
  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[var(--color-bg-base)]/60 backdrop-blur-sm"
      style={overlayStyle}
      data-swipe-ignore
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="max-w-sm w-full mx-4 bg-[var(--color-bg-elevated)] rounded-xl shadow-2xl border border-[var(--color-border)] p-6"
        style={panelStyle}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
      >
        <h3
          id="confirm-modal-title"
          className="text-[var(--color-text-primary)] text-lg font-semibold"
        >
          {title}
        </h3>
        <p
          id="confirm-modal-message"
          className="mt-2 text-[var(--color-text-secondary)] text-sm leading-relaxed"
        >
          {message}
        </p>
        <div className="mt-6 flex justify-end items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm bg-[var(--color-bg-button)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-border-subtle)]"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 ${VARIANT_BUTTON_CLASSES[variant]}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
