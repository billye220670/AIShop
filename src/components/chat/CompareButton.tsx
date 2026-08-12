import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, ChevronDown } from 'lucide-react';
import { CHAT_MODELS } from '../../config/models';
import type { Model } from '../../types';

interface CompareButtonProps {
  messageModelId: string;
  usedModelIds: string[];
  onCompare: (modelId: string) => void;
  disabled?: boolean;
}

// 模型竞争力分层推荐表：键为当前使用的模型ID，值为推荐比较的模型ID列表（按优先级排序）
const COMPARE_RECOMMENDATIONS: Record<string, string[]> = {
  // 顶级旗舰模型互相推荐
  'claude-fable-5': ['claude-opus-5', 'gpt-5.6-sol', 'gemini-3.1-pro-preview'],
  'claude-opus-5': ['claude-fable-5', 'gpt-5.6-sol', 'grok-4.20-0309-reasoning'],
  'gpt-5.6-sol': ['claude-opus-5', 'claude-fable-5', 'gemini-3.1-pro-preview'],
  'gemini-3.1-pro-preview': ['claude-opus-5', 'gpt-5.6-sol', 'grok-4.20-0309-reasoning'],
  'grok-4.20-0309-reasoning': ['claude-opus-5', 'gpt-5.6-sol', 'gemini-3.1-pro-preview'],

  // 均衡型模型互相推荐
  'claude-sonnet-5': ['gpt-5.6-terra', 'gemini-3.5-flash', 'grok-4.3'],
  'gpt-5.6-terra': ['claude-sonnet-5', 'gemini-3.5-flash', 'grok-4.3'],
  'gemini-3.5-flash': ['claude-sonnet-5', 'gpt-5.6-terra', 'grok-4.3'],
  'grok-4.3': ['claude-sonnet-5', 'gpt-5.6-terra', 'gemini-3.5-flash'],

  // 轻量/经济型模型互相推荐
  'claude-haiku-4-5-20251001': ['gpt-5.6-luna', 'gpt-5.4-nano'],
  'gpt-5.6-luna': ['claude-haiku-4-5-20251001', 'gpt-5.4-nano'],
  'gpt-5.4-nano': ['claude-haiku-4-5-20251001', 'gpt-5.6-luna'],

  // 国内模型互相推荐 + 推荐一个国际旗舰
  'deepseek/deepseek-v4-pro': ['moonshotai/kimi-k3', 'qwen/qwen3.5-27b', 'zai-org/glm-5-turbo'],
  'zai-org/glm-5-turbo': ['deepseek/deepseek-v4-pro', 'moonshotai/kimi-k3', 'qwen/qwen3.5-27b'],
  'moonshotai/kimi-k3': ['deepseek/deepseek-v4-pro', 'qwen/qwen3.5-27b', 'zai-org/glm-5-turbo'],
  'qwen/qwen3.5-27b': ['deepseek/deepseek-v4-pro', 'moonshotai/kimi-k3', 'zai-org/glm-5-turbo'],
  'doubao-1-5-pro-32k-250115': ['deepseek/deepseek-v4-pro', 'qwen/qwen3.5-27b', 'zai-org/glm-5-turbo'],
  'xiaomimimo/mimo-v2-flash': ['deepseek/deepseek-v4-pro', 'qwen/qwen3.5-27b', 'doubao-1-5-pro-32k-250115'],
};

/**
 * 根据当前模型智能推荐一个实力相当的对比模型
 */
function getRecommendedModel(currentModelId: string, usedModelIds: string[]): string | null {
  const recommendations = COMPARE_RECOMMENDATIONS[currentModelId];
  if (recommendations) {
    // 从推荐列表中找第一个未用过的
    const found = recommendations.find((id) => !usedModelIds.includes(id));
    if (found) return found;
  }

  // 推荐列表都已用过，或当前模型不在映射表中 → 从 CHAT_MODELS 中找任意一个未用过的且不同的
  const chatModels = CHAT_MODELS.filter((m) => m.type === 'chat');
  const fallback = chatModels.find((m) => m.id !== currentModelId && !usedModelIds.includes(m.id));
  return fallback ? fallback.id : null;
}

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

const GROUP_ORDER = ['Anthropic', 'OpenAI', 'Google', 'xAI', '国内模型'];

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

const DARK_ICON_PROVIDERS = ['OpenAI', 'xAI', 'Xiaomi'];
// 仅浅色模式需要纯黑圆形背景的 provider（Kimi 白底彩色图标）
const BLACK_BG_PROVIDERS = ['Moonshot'];

function getProviderIcon(provider: string): string | null {
  const file = PROVIDER_ICON_MAP[provider];
  return file ? `${import.meta.env.BASE_URL}providers/${file}` : null;
}

const MENU_GAP = 4;
const MENU_TOP_PADDING = 16;

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  minWidth: number;
  maxHeight: number;
}

export default function CompareButton({
  messageModelId,
  usedModelIds,
  onCompare,
  disabled = false,
}: CompareButtonProps) {
  const [open, setOpen] = useState(false);
  const [animVisible, setAnimVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 智能推荐对比模型
  const recommendedModelId = getRecommendedModel(messageModelId, usedModelIds);
  const recommendedModel = recommendedModelId ? CHAT_MODELS.find((m) => m.id === recommendedModelId) : null;
  const recommendedModelName = recommendedModel?.name || recommendedModelId || '';

  // 如果没有可推荐的模型，不渲染按钮
  if (!recommendedModelId) return null;

  const close = () => {
    setOpen(false);
    setAnimVisible(false);
  };

  const toggleMenu = () => {
    if (disabled) return;
    if (!open) {
      clearTimeout(unmountTimer.current);
      setMounted(true);
      setOpen(true);
    } else {
      close();
    }
  };

  // 动画控制
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

  // 计算弹出位置（自适应方向）
  useLayoutEffect(() => {
    if (!open || !mounted || !arrowRef.current) return;
    const recalc = () => {
      if (!arrowRef.current) return;
      const rect = arrowRef.current.getBoundingClientRect();
      const spaceAbove = rect.top - MENU_GAP - MENU_TOP_PADDING;
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - MENU_TOP_PADDING;

      // 哪边空间大往哪边弹出
      if (spaceAbove >= spaceBelow) {
        // 向上弹出
        const maxHeight = Math.max(120, spaceAbove);
        setPos({
          bottom: window.innerHeight - rect.top + MENU_GAP,
          left: rect.right - 280,
          minWidth: 280,
          maxHeight,
        });
      } else {
        // 向下弹出
        const maxHeight = Math.max(120, spaceBelow);
        setPos({
          top: rect.bottom + MENU_GAP,
          left: rect.right - 280,
          minWidth: 280,
          maxHeight,
        });
      }
    };
    requestAnimationFrame(recalc);
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [mounted, open]);

  // 打开时禁止后方页面滚动（聊天区域滚动容器是内部 div 而非 body，
  // 因此拦截 wheel/touchmove 而非单纯锁 body overflow，面板自身的滚动仍放行）
  useEffect(() => {
    if (!open) return;
    const isInsideMenu = (target: EventTarget | null) =>
      !!(target instanceof Node && menuRef.current?.contains(target));
    const handleWheel = (e: WheelEvent) => {
      if (isInsideMenu(e.target)) return;
      e.preventDefault();
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (isInsideMenu(e.target)) return;
      e.preventDefault();
    };
    document.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('touchmove', handleTouchMove);
    };
  }, [open]);

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

  // 按厂商分组 chat 模型
  const chatModels = CHAT_MODELS.filter((m) => m.type === 'chat');
  const grouped = chatModels.reduce<Record<string, Model[]>>((acc, m) => {
    const group = PROVIDER_GROUP_MAP[m.provider] || '其他';
    if (!acc[group]) acc[group] = [];
    acc[group].push(m);
    return acc;
  }, {});
  const sortedGroups = Object.keys(grouped).sort(
    (a, b) =>
      (GROUP_ORDER.indexOf(a) === -1 ? 99 : GROUP_ORDER.indexOf(a)) -
      (GROUP_ORDER.indexOf(b) === -1 ? 99 : GROUP_ORDER.indexOf(b))
  );

  const renderModelItem = (model: Model) => {
    const icon = getProviderIcon(model.provider);
    const isUsed = usedModelIds.includes(model.id);
    return (
      <li key={model.id}>
        <button
          type="button"
          disabled={isUsed}
          onClick={() => {
            if (!isUsed) {
              onCompare(model.id);
              close();
            }
          }}
          className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors ${
            isUsed
              ? 'text-gray-600 cursor-not-allowed'
              : 'text-gray-300 hover:bg-white/5 cursor-pointer'
          }`}
        >
          {icon ? (
            DARK_ICON_PROVIDERS.includes(model.provider) || BLACK_BG_PROVIDERS.includes(model.provider) ? (
              <span className={`w-5 h-5 shrink-0 flex items-center justify-center rounded-full ${BLACK_BG_PROVIDERS.includes(model.provider) ? 'model-icon-bg-black' : 'model-icon-bg bg-white/70'}`}>
                <img src={icon} alt={model.provider} className="w-3 h-3" />
              </span>
            ) : (
              <img src={icon} alt={model.provider} className="w-4 h-4 shrink-0" />
            )
          ) : (
            <span className="w-4 h-4 shrink-0" />
          )}
          <span className="whitespace-nowrap flex-1">{model.name}</span>
          {isUsed && (
            <span className="text-xs text-gray-600 ml-auto">已比较</span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      {/* 整体按钮容器 */}
      <div
        className={`inline-flex items-center rounded-full h-9 ${
          disabled
            ? 'bg-[var(--color-bg-button)]/40 opacity-50 cursor-not-allowed'
            : 'bg-[var(--color-bg-button)]/80'
        }`}
      >
        {/* 左侧：触发比较 */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              onCompare(recommendedModelId);
            }
          }}
          className={`inline-flex items-center gap-2 pl-4 pr-3 h-full rounded-l-full transition-colors ${
            disabled
              ? 'text-gray-600 cursor-not-allowed'
              : 'text-gray-300 hover:bg-[var(--color-bg-button)] cursor-pointer'
          }`}
        >
          <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
          <span className="text-sm whitespace-nowrap">
            与 {recommendedModelName} 比较
          </span>
        </button>

        {/* 分隔线 */}
        <span className="w-px h-5 bg-white/10" />

        {/* 右侧：展开模型列表 */}
        <button
          ref={arrowRef}
          type="button"
          disabled={disabled}
          onClick={toggleMenu}
          className={`inline-flex items-center justify-center w-9 h-full rounded-r-full transition-colors ${
            disabled
              ? 'cursor-not-allowed'
              : 'hover:bg-[var(--color-bg-button)] cursor-pointer'
          }`}
        >
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {/* 弹出列表 */}
      {mounted &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
              ...(pos.top != null ? { top: pos.top } : {}),
              left: Math.max(8, pos.left),
              minWidth: pos.minWidth,
              maxHeight: pos.maxHeight,
            }}
            className={`z-[1000] overflow-hidden bg-[var(--color-bg-elevated)] border border-white/5 rounded-xl shadow-2xl
              transition-all duration-200 ease-out ${pos.bottom != null ? 'origin-bottom' : 'origin-top'}
              ${animVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
          >
            <ul
              role="listbox"
              className="overflow-y-auto py-3 h-full max-h-[inherit]"
            >
              {sortedGroups.map((group) => (
                <li key={group}>
                  <div className="px-4 pt-4 pb-1.5 text-sm font-bold text-[var(--color-text-tertiary)]">
                    {group}
                  </div>
                  <ul>{grouped[group].map((model) => renderModelItem(model))}</ul>
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
