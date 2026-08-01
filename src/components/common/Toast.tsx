import { useEffect } from 'react';
import { Check, X } from 'lucide-react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  onClose: () => void;
  duration?: number;
  /** 附加操作，例如「查看」跳转链接 */
  action?: { label: string; onClick: () => void };
}

export default function Toast({ message, type = 'success', onClose, duration = 2000, action }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className="fixed top-20 inset-x-0 z-[9999] flex justify-center">
      <div className="flex items-center gap-2 px-4 py-3 rounded-full shadow-lg backdrop-blur-sm animate-[slideDown_0.3s_ease-out] bg-[var(--color-accent)] text-black">
        {type === 'success' ? (
          <Check className="w-5 h-5" />
        ) : (
          <X className="w-5 h-5" />
        )}
        <span className="text-sm font-medium">{message}</span>
        {action && (
          <button
            type="button"
            onClick={() => { action.onClick(); onClose(); }}
            className="text-sm font-medium underline underline-offset-2 hover:opacity-70 transition-opacity"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
