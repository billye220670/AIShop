import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

interface UpdateNotificationProps {
  open: boolean;
  onClose: () => void;
}

export default function UpdateNotification({ open, onClose }: UpdateNotificationProps) {
  const [visible, setVisible] = useState(false);
  const mounted = open || visible;

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => setVisible(false), 300);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  const shown = open && visible;

  const panelStyle: CSSProperties = {
    transition: 'opacity 300ms ease-out, transform 300ms ease-out',
    opacity: shown ? 1 : 0,
    transform: shown ? 'translateY(0)' : 'translateY(16px)',
  };

  const handleInstall = () => {
    window.electronAPI?.installUpdate();
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-[600] max-w-sm w-80"
      style={panelStyle}
    >
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-xl shadow-2xl p-5">
        {/* 图标 + 标题 */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-green-500/15 flex items-center justify-center">
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
          <h4 className="text-[var(--color-text-primary)] text-sm font-semibold">
            新版本已准备就绪
          </h4>
        </div>

        <p className="text-[var(--color-text-secondary)] text-xs leading-relaxed ml-12 mb-4">
          更新已下载完成，重启应用即可使用最新版本。
        </p>

        {/* 按钮 */}
        <div className="flex justify-end items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs bg-[var(--color-bg-button)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-border-subtle)]"
          >
            稍后
          </button>
          <button
            type="button"
            onClick={handleInstall}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-green-500/50"
          >
            立即重启
          </button>
        </div>
      </div>
    </div>
  );
}
