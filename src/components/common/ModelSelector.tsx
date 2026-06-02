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

// provider → 显示的组名
const PROVIDER_GROUP_MAP: Record<string, string> = {
  Anthropic: 'Anthropic',
  OpenAI: 'OpenAI',
  Google: 'Google',
  xAI: 'xAI',
  DeepSeek: '国内模型',
  '智谱': '国内模型',
  Alibaba: '国内模型',
  ByteDance: '国内模型',
  Moonshot: '国内模型',
  Xiaomi: '国内模型',
};

// 分组显示顺序
const GROUP_ORDER = ['Anthropic', 'OpenAI', 'Google', 'xAI', '国内模型'];

// 需要圆形背景的深色图标 provider
const DARK_ICON_PROVIDERS = ['OpenAI', 'xAI', 'Xiaomi'];

function getProviderIcon(provider: string): string | null {
  const file = PROVIDER_ICON_MAP[provider];
  return file ? `${import.meta.env.BASE_URL}providers/${file}` : null;
}

const MENU_GAP = 4;
const MENU_TOP_PADDING = 16; // 菜单距视口顶部的最小间距

interface MenuPosition {
  top?: number;      // bottom placement 使用
  bottom?: number;   // top placement 使用
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
  const menuRef = useRef<HTMLDivElement>(null);
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
    if (!open || !mounted || !buttonRef.current) return;
    const recalc = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP - MENU_TOP_PADDING;
      const placement: 'top' | 'bottom' =
        spaceBelow >= spaceAbove ? 'bottom' : 'top';
      const maxHeight = Math.max(
        120,
        placement === 'bottom' ? spaceBelow - MENU_TOP_PADDING : spaceAbove
      );
      if (placement === 'bottom') {
        setPos({
          top: rect.bottom + MENU_GAP,
          left: rect.left,
          width: rect.width,
          maxHeight,
          placement,
        });
      } else {
        setPos({
          bottom: window.innerHeight - rect.top + MENU_GAP,
          left: rect.left,
          width: rect.width,
          maxHeight,
          placement,
        });
      }
    };
    // 使用 rAF 确保 DOM 完全渲染后再测量位置
    requestAnimationFrame(recalc);
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [mounted, open]);

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

  // 按厂商分组
  const hasGroups = models.some((m) => PROVIDER_GROUP_MAP[m.provider]);
  const grouped = models.reduce<Record<string, Model[]>>((acc, m) => {
    const group = PROVIDER_GROUP_MAP[m.provider] || '其他';
    if (!acc[group]) acc[group] = [];
    acc[group].push(m);
    return acc;
  }, {});
  const sortedGroups = Object.keys(grouped).sort(
    (a, b) => (GROUP_ORDER.indexOf(a) === -1 ? 99 : GROUP_ORDER.indexOf(a)) -
              (GROUP_ORDER.indexOf(b) === -1 ? 99 : GROUP_ORDER.indexOf(b))
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
          className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors ${
            active
              ? 'bg-[rgb(70,61,123)] text-white rounded-lg mx-2 !w-[calc(100%-1rem)]'
              : 'text-gray-300 hover:bg-white/5'
          }`}
        >
          {icon ? (
            DARK_ICON_PROVIDERS.includes(model.provider) ? (
              <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full bg-white/70">
                <img src={icon} alt={model.provider} className="w-3 h-3" />
              </span>
            ) : (
              <img src={icon} alt={model.provider} className="w-4 h-4 shrink-0" />
            )
          ) : (
            <span className="w-4 h-4 shrink-0" />
          )}
          <span className="whitespace-nowrap">{model.name}</span>
        </button>
      </li>
    );
  };

  // 渲染触发器上的图标
  const renderTriggerIcon = () => {
    if (!currentIcon) return <span className="w-4 h-4 shrink-0" />;
    if (DARK_ICON_PROVIDERS.includes(current.provider)) {
      return (
        <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full bg-white/70">
          <img src={currentIcon} alt={current.provider} className="w-3 h-3" />
        </span>
      );
    }
    return <img src={currentIcon} alt={current.provider} className="w-4 h-4 shrink-0" />;
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
        {renderTriggerIcon()}
        <span className="whitespace-nowrap">{current.name}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {mounted && pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              ...(pos.top !== undefined ? { top: pos.top } : {}),
              ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
              left: pos.left,
              minWidth: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className={`z-[1000] overflow-hidden bg-[rgb(46,47,60)] border border-white/5 rounded-xl shadow-2xl
              transition-all duration-200 ease-out ${pos.placement === 'bottom' ? 'origin-top' : 'origin-bottom'}
              ${animVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
          >
            <ul
              role="listbox"
              className="overflow-y-auto py-3 h-full max-h-[inherit]"
            >
            {hasGroups ? (
              sortedGroups.map((group) => (
                <li key={group}>
                  <div className="px-4 pt-4 pb-1.5 text-sm font-bold text-[rgb(114,115,138)]">
                    {group}
                  </div>
                  <ul>
                    {grouped[group].map((model) => renderModelItem(model))}
                  </ul>
                </li>
              ))
            ) : (
              models.map((model) => renderModelItem(model))
            )}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
