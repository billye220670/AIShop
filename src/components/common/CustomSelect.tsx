import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  id?: string;
  className?: string; // 附加到触发按钮上的样式
}

// 自绘下拉选择器：外观与输入框统一，替代浏览器原生 <select>
export default function CustomSelect({ value, onChange, options, id, className = '' }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = options.find(opt => opt.value === value);

  // 外部点击 / ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className={`w-full flex items-center justify-between bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-3.5 text-sm text-white focus:border-[var(--color-accent)] focus:outline-none transition-colors cursor-pointer ${className}`}
      >
        <span className="truncate">{current?.label ?? ''}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-60 overflow-y-auto bg-[var(--color-bg-elevated)] border border-white/5 rounded-xl shadow-2xl py-2"
        >
          {options.map(opt => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left transition-colors ${
                  active ? 'text-white' : 'text-gray-300 hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {active && <Check className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
