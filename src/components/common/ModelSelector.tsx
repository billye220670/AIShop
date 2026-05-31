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
  const [animVisible, setAnimVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const current = models.find((m) => m.id === selectedModel) ?? models[0];

  // 关闭菜单：在事件回调中同步清除动画状态，避免 effect 内 setState
  const close = () => {
    setOpen(false);
    setAnimVisible(false);
  };

  // 打开菜单：同步挂载 DOM
  const toggle = () => {
    if (!open) {
      clearTimeout(unmountTimer.current);
      setMounted(true);
      setOpen(true);
    } else {
      close();
    }
  };

  // 动画控制：打开时触发进入动画，关闭时延迟卸载 DOM
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimVisible(true));
      });
    } else {
      unmountTimer.current = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(unmountTimer.current);
    }
  }, [open]);

  // 计算弹出菜单的定位（fixed 坐标，不受祖先 overflow:hidden 影响）
  useLayoutEffect(() => {
    if (!mounted || !buttonRef.current) return;
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
  }, [mounted]);

  // ESC 和外部点击关闭
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
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

  // 分组逻辑
  const hasCategories = models.some((m) => m.category);
  const grouped = models.reduce<Record<string, Model[]>>((acc, m) => {
    const cat = m.category || '未分类';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(m);
    return acc;
  }, {});
  const categoryOrder = ['基础', '高级'];
  const sortedCategories = Object.keys(grouped).sort(
    (a, b) =>
      (categoryOrder.indexOf(a) === -1 ? 99 : categoryOrder.indexOf(a)) -
      (categoryOrder.indexOf(b) === -1 ? 99 : categoryOrder.indexOf(b))
  );

  // 渲染单个模型项
  const renderModelItem = (model: Model) => {
    const icon = getProviderIcon(model.provider);
    const active = model.id === selectedModel;
    return (
      <li key={model.id}>
        <button
          type="button"
          onClick={() => {
            onModelChange(model.id);
            close();
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
            active
              ? 'bg-purple-500/20 text-purple-200 rounded-lg mx-1.5 !w-[calc(100%-0.75rem)]'
              : 'text-gray-300 hover:bg-white/5'
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
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
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

      {mounted && pos &&
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
            className={`z-[1000] overflow-y-auto bg-gray-900/95 backdrop-blur-sm border border-white/5 rounded-xl shadow-2xl py-2
              transition-all duration-200 ease-out ${pos.placement === 'bottom' ? 'origin-top' : 'origin-bottom'}
              ${animVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
          >
            {hasCategories ? (
              sortedCategories.map((cat) => (
                <li key={cat}>
                  <div className="px-3 pt-3 pb-1 text-xs font-medium text-purple-400">
                    {cat}
                  </div>
                  <ul>
                    {grouped[cat].map((model) => renderModelItem(model))}
                  </ul>
                </li>
              ))
            ) : (
              models.map((model) => renderModelItem(model))
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}
