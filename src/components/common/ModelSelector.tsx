import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { Model } from '../../types';

interface ModelSelectorProps {
  models: Model[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  compact?: boolean; // 是否使用紧凑模式（全圆角、无边框）
}

// provider 名称 → /public/providers/ 下的图标文件名
const PROVIDER_ICON_MAP: Record<string, string> = {
  Anthropic: 'claude-color.svg',
  Google: 'gemini-color.svg',
  OpenAI: 'openai.svg',
  xAI: 'grok.svg',
  DeepSeek: 'deepseek-color.svg',
  '智谱': 'zhipu-color.svg',
  Moonshot: 'kimi-color.svg',
  ByteDance: 'bytedance-color.svg',
  Alibaba: 'qwen-color.svg',
  Xiaomi: 'xiaomimimo.svg',
};

function getProviderIcon(provider: string): string | null {
  const file = PROVIDER_ICON_MAP[provider];
  return file ? `/providers/${file}` : null;
}

const MENU_MAX_HEIGHT = 288; // max-h-72 (18rem)
const MENU_GAP = 4;

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'top' | 'bottom';
}

export default function ModelSelector({ models, selectedModel, onModelChange, compact = false }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const current = models.find((m) => m.id === selectedModel) ?? models[0];

  // 计算弹出菜单的定位（fixed 坐标，不受祖先 overflow:hidden 影响）
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const recalc = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP;
      const placement: 'top' | 'bottom' =
        spaceBelow >= MENU_MAX_HEIGHT || spaceBelow >= spaceAbove ? 'bottom' : 'top';
      const maxHeight = Math.max(
        120,
        Math.min(MENU_MAX_HEIGHT, placement === 'bottom' ? spaceBelow : spaceAbove)
      );
      setPos({
        top: placement === 'bottom' ? rect.bottom + MENU_GAP : rect.top - MENU_GAP - maxHeight,
        left: rect.left,
        width: rect.width,
        maxHeight,
        placement,
      });
    };
    recalc();
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
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

  if (!current) return null;

  const currentIcon = getProviderIcon(current.provider);

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 text-sm cursor-pointer ${
          compact
            ? 'rounded-full bg-transparent text-white border border-gray-700/50 px-4 py-2 hover:border-gray-600 ml-0'
            : 'bg-gray-700 text-white rounded-lg px-3 py-1.5 border border-gray-600 hover:border-gray-500 focus:outline-none focus:border-blue-500'
        }`}
      >
        {currentIcon ? (
          <img src={currentIcon} alt={current.provider} className="w-4 h-4 shrink-0" />
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <span className="whitespace-nowrap">{current.name}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && pos &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className="z-[1000] overflow-y-auto bg-gray-800 border border-gray-600 rounded-lg shadow-lg py-1"
          >
            {models.map((model) => {
              const icon = getProviderIcon(model.provider);
              const active = model.id === selectedModel;
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onModelChange(model.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                      active ? 'bg-blue-600/20 text-blue-300' : 'text-gray-200 hover:bg-gray-700'
                    }`}
                  >
                    {icon ? (
                      <img src={icon} alt={model.provider} className="w-4 h-4 shrink-0" />
                    ) : (
                      <span className="w-4 h-4 shrink-0" />
                    )}
                    <span className="whitespace-nowrap">{model.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </div>
  );
}
