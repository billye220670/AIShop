import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Globe, SquareCode } from 'lucide-react';
import BottomSheet from './BottomSheet';
import type { Model } from '../../types';

interface ModelBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  models: Model[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  webSearchEnabled: boolean;
  onWebSearchToggle: () => void;
  artifactEnabled: boolean;
  onArtifactToggle: () => void;
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

// 需要圆形背景的深色图标 provider
const DARK_ICON_PROVIDERS = ['OpenAI', 'xAI', 'Xiaomi'];

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
const GROUP_ORDER = ['高级', 'Anthropic', 'OpenAI', 'Google', 'xAI', '国内模型'];

function getProviderIcon(provider: string): string | null {
  const file = PROVIDER_ICON_MAP[provider];
  return file ? `${import.meta.env.BASE_URL}providers/${file}` : null;
}

// 推荐模型列表（按顺序）
// 推荐模型：Sonnet 5, Opus 5, Gemini 3.1 Pro, GPT-5.6-Sol, Grok 4.3
const RECOMMENDED_MODEL_IDS = [
  'claude-sonnet-5',        // Claude Sonnet 5
  'claude-opus-5',          // Claude Opus 5
  'gemini-3.1-pro-preview', // Gemini 3.1 Pro
  'gpt-5.6-sol',            // GPT-5.6-Sol
  'grok-4.3',               // Grok 4.3
];

// 模型简介
const MODEL_DESCRIPTIONS: Record<string, string> = {
  // Anthropic
  'claude-fable-5': 'Anthropic 最新旗舰模型，拥有卓越的推理能力和创造力，适合复杂任务处理',
  'claude-haiku-4-5': 'Anthropic 快速响应模型，轻量高效，适合简单任务和快速交互',
  'claude-opus-5': 'Anthropic 新一代旗舰模型，100 万 token 上下文，推理与创作能力进一步提升',
  'claude-sonnet-5': 'Anthropic 新一代均衡模型，100 万 token 上下文，兼顾能力与响应速度',

  // OpenAI
  'gpt-5.4-nano': 'OpenAI 轻量级模型，高性价比，适合大规模部署和快速响应场景',
  'gpt-5.6-sol': 'OpenAI 新一代旗舰模型，105 万 token 上下文，适合最复杂的推理和创作任务',
  'gpt-5.6-terra': 'OpenAI 新一代均衡模型，105 万 token 上下文，性能与成本兼顾',
  'gpt-5.6-luna': 'OpenAI 新一代轻量模型，105 万 token 上下文，响应快速、性价比高',

  // Google
  'gemini-3.1-pro-preview': 'Google 最强多模态模型，支持文本、图像、视频、音频输入，擅长分析和理解',
  'gemini-3.5-flash': 'Google 新一代快速多模态模型，支持文本、图像、视频、音频输入，性价比高',

  // xAI
  'grok-4.20-0309-reasoning': 'xAI 推理增强模型，200 万 token 超长上下文，擅长复杂逻辑推理',
  'grok-4.3': 'xAI 高性能模型，100 万 token 上下文，快速响应，适合多轮对话',

  // DeepSeek
  'deepseek/deepseek-v4-pro': 'DeepSeek 旗舰模型，强大的中文理解能力，超长上下文，适合中文场景',
  'deepseek/deepseek-v4-flash-0731': 'DeepSeek 快速模型，超长上下文，极高性价比，适合大规模调用',

  // 智谱 GLM
  'zai-org/glm-5-turbo': '智谱 AI 高性能模型，优秀的中文能力，支持长文本处理',

  // Moonshot
  'moonshotai/kimi-k3': 'Moonshot AI 新一代旗舰模型，105 万 token 超长上下文，支持多模态，能力全面升级',

  // Alibaba Qwen
  'qwen/qwen3.5-27b': '阿里云通义千问模型，优秀的中文能力，支持多模态输入',

  // ByteDance Doubao
  'doubao-1-5-pro-32k': '字节跳动豆包模型，高性价比，适合中文对话和内容创作',

  // Xiaomi MiMo
  'xiaomimimo/mimo-v2-flash': '小米 MiMo 快速模型，极高性价比，适合大规模应用',
};

export default function ModelBottomSheet({
  isOpen,
  onClose,
  models,
  selectedModel,
  onModelChange,
  webSearchEnabled,
  onWebSearchToggle,
  artifactEnabled,
  onArtifactToggle,
}: ModelBottomSheetProps) {
  const [showAllModels, setShowAllModels] = useState(false);
  const [animationState, setAnimationState] = useState<'idle' | 'to-all' | 'to-recommended'>('idle');

  // 当 BottomSheet 关闭时，重置状态
  useEffect(() => {
    if (!isOpen) {
      setShowAllModels(false);
      setAnimationState('idle');
    }
  }, [isOpen]);

  const handleShowAllModels = () => {
    setAnimationState('to-all');
    setTimeout(() => {
      setShowAllModels(true);
      setAnimationState('idle');
    }, 300);
  };

  const handleBackToRecommended = () => {
    setAnimationState('to-recommended');
    setTimeout(() => {
      setShowAllModels(false);
      setAnimationState('idle');
    }, 300);
  };

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId);
    onClose();
  };

  // 获取推荐模型
  const recommendedModels = RECOMMENDED_MODEL_IDS.map(id =>
    models.find(m => m.id === id)
  ).filter(Boolean) as Model[];

  // 按厂商分组所有模型
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

  const renderModelIcon = (model: Model) => {
    const icon = getProviderIcon(model.provider);
    if (!icon) return null;

    if (DARK_ICON_PROVIDERS.includes(model.provider)) {
      return (
        <div className="w-12 h-12 rounded-full bg-white/70 flex items-center justify-center">
          <img src={icon} alt={model.provider} className="w-7 h-7" />
        </div>
      );
    }
    return <img src={icon} alt={model.provider} className="w-12 h-12 rounded-full" />;
  };

  const renderRecommendedView = () => (
    <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
      {/* 标题 */}
      <h2 className="text-white text-xl font-bold mb-6">聊天设置</h2>

      {/* 模型区域 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-white text-base">✦</span>
            <span className="text-white text-base font-semibold">模型</span>
          </div>
          <button
            onClick={handleShowAllModels}
            className="flex items-center gap-1 text-[var(--color-accent)] text-sm font-medium"
          >
            <div className="flex items-center -space-x-2 mr-1">
              {recommendedModels.slice(0, 3).map((model, idx) => {
                const icon = getProviderIcon(model.provider);
                return icon ? (
                  <div key={model.id} className="w-5 h-5 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-bg-primary)] overflow-hidden" style={{ zIndex: 3 - idx }}>
                    <img src={icon} alt={model.provider} className="w-full h-full object-cover" />
                  </div>
                ) : null;
              })}
            </div>
            更多
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* 推荐模型横向滚动 */}
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {recommendedModels.map((model) => {
            const isSelected = model.id === selectedModel;
            return (
              <button
                key={model.id}
                onClick={() => handleModelSelect(model.id)}
                className={`relative flex-shrink-0 w-28 rounded-2xl overflow-hidden p-4 flex flex-col items-center gap-2 transition-all ${
                  isSelected
                    ? 'bg-[var(--color-accent-soft)] border-2 border-[var(--color-accent)]'
                    : 'bg-[var(--color-bg-elevated)] border-2 border-transparent'
                }`}
              >
                {renderModelIcon(model)}
                <span className="text-white text-sm text-center leading-tight">{model.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 高级功能区 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-white text-base">✦</span>
          <span className="text-white text-base font-semibold">高级功能</span>
        </div>

        {/* 联网搜索 + Artifact */}
        <div className="bg-[var(--color-bg-secondary)] rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-gray-400" />
              <div>
                <div className="text-white text-sm font-medium">全网搜索</div>
                <div className="text-gray-400 text-xs mt-0.5">允许 AI 根据问题需要访问互联网</div>
              </div>
            </div>
            <button
              onClick={onWebSearchToggle}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                webSearchEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-hover)]'
              }`}
            >
              <div
                className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                  webSearchEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="h-px bg-white/10 my-4" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SquareCode className="w-5 h-5 text-gray-400" />
              <div>
                <div className="text-white text-sm font-medium">Artifact</div>
                <div className="text-gray-400 text-xs mt-0.5">允许 AI 生成可交互的代码预览</div>
              </div>
            </div>
            <button
              onClick={onArtifactToggle}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                artifactEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-hover)]'
              }`}
            >
              <div
                className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                  artifactEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAllModelsView = () => (
    <>
      {/* 顶部导航栏 - 固定在 BottomSheet 顶部 */}
      <div className="shrink-0 bg-[var(--color-bg-primary)] px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleBackToRecommended();
            }}
            className="text-white p-1 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-white text-lg font-semibold">所有模型</h2>
        </div>
      </div>

      {/* 模型列表 - 可滚动区域 */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        {sortedGroups.map((group) => (
          <div key={group} className="mb-6">
            <div className="text-gray-400 text-xs font-medium mb-3 uppercase">{group}</div>
            <div className="space-y-2">
              {grouped[group].map((model) => {
                const isSelected = model.id === selectedModel;
                const icon = getProviderIcon(model.provider);

                return (
                  <button
                    key={model.id}
                    onClick={() => handleModelSelect(model.id)}
                    className={`w-full h-24 rounded-xl px-4 py-5 flex items-center gap-3 transition-all ${
                      isSelected
                        ? 'bg-[var(--color-accent-soft)] border border-[var(--color-accent)]'
                        : 'bg-[var(--color-bg-secondary)] border border-transparent hover:border-white/10'
                    }`}
                  >
                    {icon ? (
                      DARK_ICON_PROVIDERS.includes(model.provider) ? (
                        <div className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-white/70">
                          <img src={icon} alt={model.provider} className="w-6 h-6" />
                        </div>
                      ) : (
                        <img src={icon} alt={model.provider} className="w-10 h-10 shrink-0 rounded-full" />
                      )
                    ) : (
                      <div className="w-10 h-10 shrink-0" />
                    )}
                    <div className="flex-1 text-left">
                      <div className="text-white text-sm font-medium">{model.name}</div>
                      <div className="text-gray-400 text-xs mt-0.5 line-clamp-2">
                        {MODEL_DESCRIPTIONS[model.id] || '高性能 AI 模型，适合多种应用场景'}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                        <span className="text-[var(--color-accent-foreground)] text-xs">✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* 推荐视图 */}
        {(animationState === 'idle' && !showAllModels) || animationState === 'to-all' || animationState === 'to-recommended' ? (
          <div className={`absolute inset-0 flex flex-col ${
            animationState === 'to-all' ? 'animate-slide-out-left' :
            animationState === 'to-recommended' ? 'animate-slide-in-left' : ''
          }`}>
            {renderRecommendedView()}
          </div>
        ) : null}

        {/* 所有模型视图 */}
        {(animationState === 'idle' && showAllModels) || animationState === 'to-all' || animationState === 'to-recommended' ? (
          <div className={`absolute inset-0 flex flex-col ${
            animationState === 'to-all' ? 'animate-slide-in-right' :
            animationState === 'to-recommended' ? 'animate-slide-out-right' : ''
          }`}>
            {renderAllModelsView()}
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
