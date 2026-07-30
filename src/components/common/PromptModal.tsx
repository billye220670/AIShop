import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';

interface PromptModalProps {
  open: boolean;
  title: string;
  /** 输入框初始值，打开时同步一次 */
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  maxLength?: number;
  /** 返回去空格后的文本；空值时确认按钮为禁用态，不会触发 */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function PromptModal({
  open,
  title,
  initialValue = '',
  placeholder = '',
  confirmText = '保存',
  cancelText = '取消',
  maxLength = 50,
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [value, setValue] = useState(initialValue);
  // 控制可见状态（驱动过渡动画）
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // mounted 为派生值：open=true 或退出动画尚未结束时保持挂载
  const mounted = open || visible;

  // 渲染期同步重置输入值：必须早于聚焦后的 select()，否则会选中上一次的旧文本
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(initialValue);
  }

  // 打开时下一帧触发进入动画；关闭时延迟卸载以播完退出动画
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => setVisible(false), 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 尽早聚焦以唤起移动端键盘：iOS 只在触发点击的同一个任务里响应 focus()，
  // 放到 setTimeout / rAF 里就会被判定为非用户手势而不弹键盘，故用 layout effect 同步执行
  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
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

  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;

  const submit = () => {
    if (!canConfirm) return;
    onConfirm(trimmed);
  };

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
      className="fixed inset-0 z-[500] flex items-start justify-center pt-[18vh] bg-[var(--color-bg-base)]/60 backdrop-blur-sm"
      style={overlayStyle}
      data-swipe-ignore
      onClick={onCancel}
      onPointerDown={e => e.stopPropagation()}
      role="presentation"
    >
      <div
        className="max-w-sm w-full mx-6 bg-[var(--color-bg-elevated)] rounded-3xl shadow-2xl border border-[var(--color-border)] p-6"
        style={panelStyle}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
      >
        <h3
          id="prompt-modal-title"
          className="text-[var(--color-text-primary)] text-lg font-semibold"
        >
          {title}
        </h3>

        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-label={title}
          className="mt-5 w-full h-12 px-4 rounded-2xl bg-[var(--color-bg-button)] border border-[var(--color-border)] text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none transition-colors"
        />

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 rounded-2xl text-base bg-[var(--color-bg-button)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] transition-colors focus:outline-none"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canConfirm}
            className={`h-12 rounded-2xl text-base font-medium transition-colors focus:outline-none ${
              canConfirm
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] hover:bg-[var(--color-accent-hover)]'
                : 'bg-[var(--color-bg-button)] text-[var(--color-text-secondary)] opacity-50 cursor-not-allowed'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
