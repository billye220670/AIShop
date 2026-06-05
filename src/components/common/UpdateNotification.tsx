import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

interface UpdateNotificationProps {
  open: boolean;
  version: string;
  releaseNotes: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function UpdateNotification({
  open,
  version,
  releaseNotes,
  onConfirm,
  onCancel,
}: UpdateNotificationProps) {
  const [visible, setVisible] = useState(false);
  const mounted = open || visible;

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

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[var(--color-bg-base)]/60 backdrop-blur-sm"
      style={overlayStyle}
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="max-w-sm w-full mx-4 bg-[var(--color-bg-elevated)] rounded-xl shadow-2xl border border-[var(--color-border)] p-6"
        style={panelStyle}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
      >
        {/* 图标 + 标题 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-green-500/15 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4"
              />
            </svg>
          </div>
          <h3
            id="update-modal-title"
            className="text-[var(--color-text-primary)] text-lg font-semibold"
          >
            发现新版本 v{version}
          </h3>
        </div>

        {/* 更新说明 */}
        {releaseNotes ? (
          <div className="max-h-48 overflow-y-auto mb-5 px-1">
            <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">
              {releaseNotes}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)] mb-5 leading-relaxed">
            新版本已可用，是否立即更新？
          </p>
        )}

        {/* 按钮 */}
        <div className="flex justify-end items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm bg-[var(--color-bg-button)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-border-subtle)]"
          >
            稍后
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] hover:opacity-90 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
          >
            立即更新
          </button>
        </div>
      </div>
    </div>
  );
}
