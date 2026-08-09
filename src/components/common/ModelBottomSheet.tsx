import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Globe, SquareCode, Sparkles, Plus, UserRound, Trash2, Check } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { createRole, deleteRole } from '../../db';
import type { Model } from '../../types';
import type { RoleData } from '../../db';

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
  // 角色设置
  roles: RoleData[];
  selectedRoleId: string;
  onRoleSelect: (roleId: string) => void;
  /** 角色创建/删除后通知上层重读列表 */
  onRolesChanged: () => void;
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

/** 底部抽屉内的页面：聊天设置（推荐）/ 所有模型 / 角色列表 / 创建角色 */
type SheetPage = 'recommended' | 'models' | 'roles' | 'create';

/** 每页的上级页面（返回按钮的目标） */
const PARENT_PAGE: Record<SheetPage, SheetPage | null> = {
  recommended: null,
  models: 'recommended',
  roles: 'recommended',
  create: 'roles',
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
  roles = [],
  selectedRoleId = '',
  onRoleSelect = () => {},
  onRolesChanged = () => {},
}: ModelBottomSheetProps) {
  // 多级页面导航：page 是当前页，nextPage 非空时处于切换动画中
  const [page, setPage] = useState<SheetPage>('recommended');
  const [nextPage, setNextPage] = useState<SheetPage | null>(null);
  const [animDir, setAnimDir] = useState<'forward' | 'backward'>('forward');
  const navTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 创建角色页
  const [newRolePrompt, setNewRolePrompt] = useState('');
  const [creating, setCreating] = useState(false);

  // 删除角色：第一次点击进入确认态，3 秒内再点才真正删除
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(navTimer.current), []);
  useEffect(() => () => clearTimeout(deleteTimer.current), []);

  /** 关闭 BottomSheet：先重置所有页面状态，再通知父组件（下次打开回到聊天设置页） */
  const handleClose = () => {
    setPage('recommended');
    setNextPage(null);
    setConfirmDeleteId(null);
    setNewRolePrompt('');
    setCreating(false);
    onClose();
  };

  /** 进入更深一层页面（推荐 → 角色列表 / 角色列表 → 创建） */
  const navigate = (target: SheetPage) => {
    clearTimeout(navTimer.current);
    setAnimDir('forward');
    setNextPage(target);
    navTimer.current = setTimeout(() => {
      setPage(target);
      setNextPage(null);
    }, 300);
  };

  /** 逐级返回上一层页面 */
  const goBack = () => {
    const parent = PARENT_PAGE[page];
    if (!parent) return;
    clearTimeout(navTimer.current);
    setAnimDir('backward');
    setNextPage(parent);
    navTimer.current = setTimeout(() => {
      setPage(parent);
      setNextPage(null);
    }, 300);
  };

  const isPageActive = (p: SheetPage) => page === p || nextPage === p;

  /** 页面切换动画：前进时旧页向左滑出、新页从右滑入；后退相反 */
  const pageAnimClass = (p: SheetPage) => {
    if (!nextPage) return '';
    if (p === page) return animDir === 'forward' ? 'animate-slide-out-left' : 'animate-slide-out-right';
    if (p === nextPage) return animDir === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left';
    return '';
  };

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId);
    handleClose();
  };

  const handleRoleSelect = (roleId: string) => {
    onRoleSelect(roleId);
    handleClose();
  };

  const handleDeleteRole = (roleId: string) => {
    if (confirmDeleteId !== roleId) {
      setConfirmDeleteId(roleId);
      clearTimeout(deleteTimer.current);
      deleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    clearTimeout(deleteTimer.current);
    setConfirmDeleteId(null);
    void deleteRole(roleId)
      .then(() => {
        // 删掉的是当前选中角色 → 回退默认角色
        if (selectedRoleId === roleId) onRoleSelect('');
        onRolesChanged();
      })
      .catch(e => console.warn('[roles] 删除角色失败', e));
  };

  const handleCreateRole = () => {
    const prompt = newRolePrompt.trim();
    if (!prompt || creating) return;
    setCreating(true);
    void createRole(prompt)
      .then(() => {
        setNewRolePrompt('');
        setCreating(false);
        onRolesChanged();
        goBack(); // 创建完成返回角色列表
      })
      .catch(e => {
        console.warn('[roles] 创建角色失败', e);
        setCreating(false);
      });
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

  const renderRecommendedView = () => {
    const currentRoleName = selectedRoleId
      ? (roles.find(r => r.id === selectedRoleId)?.name || '自定义角色')
      : '默认角色 PortAI';

    return (
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
              onClick={() => navigate('models')}
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

          {/* 角色设置 + 联网搜索 + Artifact */}
          <div className="bg-[var(--color-bg-secondary)] rounded-2xl p-4">
            {/* 角色设置：点击进入角色列表 */}
            <button
              onClick={() => navigate('roles')}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-gray-400" />
                <div className="text-left">
                  <div className="text-white text-sm font-medium">角色设置</div>
                  <div className="text-gray-400 text-xs mt-0.5">{currentRoleName}</div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>

            <div className="h-px bg-white/10 my-4" />

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
  };

  const renderAllModelsView = () => (
    <>
      {/* 顶部导航栏 - 固定在 BottomSheet 顶部 */}
      <div className="shrink-0 bg-[var(--color-bg-primary)] px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              goBack();
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

  const renderRolesView = () => (
    <>
      {/* 顶部导航栏 - 固定在顶部 */}
      <div className="shrink-0 bg-[var(--color-bg-primary)] px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              goBack();
            }}
            className="text-white p-1 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-white text-lg font-semibold">角色设置</h2>
        </div>
      </div>

      {/* 角色列表 - 可滚动区域 */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        {/* 默认角色：永远在最顶部 */}
        <div className="text-gray-400 text-xs font-medium mb-3 uppercase">默认角色</div>
        <button
          onClick={() => handleRoleSelect('')}
          className={`w-full rounded-xl px-4 py-4 flex items-center gap-3 transition-all ${
            !selectedRoleId
              ? 'bg-[var(--color-accent-soft)] border border-[var(--color-accent)]'
              : 'bg-[var(--color-bg-secondary)] border border-transparent hover:border-white/10'
          }`}
        >
          <div className="w-10 h-10 shrink-0 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[var(--color-accent-foreground)]" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-white text-sm font-medium">PortAI</div>
            <div className="text-gray-400 text-xs mt-0.5">默认角色，内置全网搜索与 Artifact 等完整能力</div>
          </div>
          {!selectedRoleId && (
            <div className="w-5 h-5 shrink-0 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-[var(--color-accent-foreground)]" />
            </div>
          )}
        </button>

        {/* 自定义角色 */}
        {roles.length > 0 && (
          <>
            <div className="text-gray-400 text-xs font-medium mt-6 mb-3 uppercase">自定义角色</div>
            <div className="space-y-2">
              {roles.map((role) => {
                const isSelected = role.id === selectedRoleId;
                return (
                  <div
                    key={role.id}
                    className={`w-full rounded-xl px-4 py-4 flex items-center gap-3 transition-all ${
                      isSelected
                        ? 'bg-[var(--color-accent-soft)] border border-[var(--color-accent)]'
                        : 'bg-[var(--color-bg-secondary)] border border-transparent'
                    }`}
                  >
                    <button
                      onClick={() => handleRoleSelect(role.id)}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      <div className="w-10 h-10 shrink-0 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center">
                        <UserRound className="w-5 h-5 text-gray-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium truncate">{role.name}</div>
                        <div className="text-gray-400 text-xs mt-0.5 line-clamp-2">{role.systemPrompt}</div>
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 shrink-0 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-[var(--color-accent-foreground)]" />
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteRole(role.id)}
                      title={confirmDeleteId === role.id ? '再次点击确认删除' : '删除角色'}
                      className={`shrink-0 p-2 rounded-lg transition-colors ${
                        confirmDeleteId === role.id
                          ? 'bg-red-500/20 text-red-400'
                          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      {confirmDeleteId === role.id ? (
                        <span className="text-xs font-medium">确认</span>
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* 新角色按钮：固定在列表最底部 */}
        <button
          onClick={() => navigate('create')}
          className="mt-8 w-full rounded-xl py-3.5 flex items-center justify-center gap-2 bg-[var(--color-accent)] text-[var(--color-accent-foreground)] text-sm font-semibold active:opacity-80"
        >
          <Plus className="w-5 h-5" />
          新角色
        </button>
      </div>
    </>
  );

  const renderCreateRoleView = () => (
    <>
      {/* 顶部导航栏 - 固定在顶部 */}
      <div className="shrink-0 bg-[var(--color-bg-primary)] px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              goBack();
            }}
            className="text-white p-1 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-white text-lg font-semibold">创建角色</h2>
        </div>
      </div>

      <div className="flex-1 flex flex-col px-4 pt-4 pb-6 overflow-hidden">
        <textarea
          autoFocus
          value={newRolePrompt}
          onChange={(e) => setNewRolePrompt(e.target.value)}
          placeholder={`输入角色的系统提示词，例如：\n你是一位精通古典诗词创作的诗人，擅长七言绝句，用词凝练、意境深远。`}
          className="flex-1 min-h-[200px] w-full bg-[var(--color-bg-secondary)] rounded-2xl p-4 text-white text-sm placeholder-gray-500 focus:outline-none resize-none leading-relaxed overflow-y-auto"
        />
        <div className="text-gray-500 text-xs mt-2">
          角色名自动取自提示词第一行（最多 20 字），创建后可在聊天设置中随时切换
        </div>
        <button
          onClick={handleCreateRole}
          disabled={!newRolePrompt.trim() || creating}
          className="mt-4 w-full rounded-xl py-3.5 bg-[var(--color-accent)] text-[var(--color-accent-foreground)] text-sm font-semibold disabled:opacity-40"
        >
          {creating ? '创建中…' : '创建'}
        </button>
      </div>
    </>
  );

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose}>
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* 推荐视图（聊天设置） */}
        {isPageActive('recommended') && (
          <div className={`absolute inset-0 flex flex-col ${pageAnimClass('recommended')}`}>
            {renderRecommendedView()}
          </div>
        )}

        {/* 所有模型视图 */}
        {isPageActive('models') && (
          <div className={`absolute inset-0 flex flex-col ${pageAnimClass('models')}`}>
            {renderAllModelsView()}
          </div>
        )}

        {/* 角色列表视图 */}
        {isPageActive('roles') && (
          <div className={`absolute inset-0 flex flex-col ${pageAnimClass('roles')}`}>
            {renderRolesView()}
          </div>
        )}

        {/* 创建角色视图 */}
        {isPageActive('create') && (
          <div className={`absolute inset-0 flex flex-col ${pageAnimClass('create')}`}>
            {renderCreateRoleView()}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
