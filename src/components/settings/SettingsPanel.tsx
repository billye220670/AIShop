import { useEffect, useState } from 'react';
import { MessageSquare, Image as ImageIcon, Film, Eye, EyeOff, Check, ChevronLeft, ChevronRight, KeyRound, MessageCircle, Database, Palette, Sun, Moon, Cloud, CheckCircle, AlertCircle } from 'lucide-react';
import { settingsService, DEFAULT_COMPACT_SETTINGS } from '../../services/settingsService';
import type { ProviderConfig, CompactSettings } from '../../services/settingsService';
import { THEMES } from '../../config/themes';
import { loadTheme, saveTheme, loadMode, saveMode, type ColorMode } from '../../services/storage';
import { CHAT_MODELS } from '../../config/models';
import DataSettings from './DataSettings';
import ByocSettings from './ByocSettings';
import { getByocConfig, validateConfig } from '../../services/byoc';
import CustomSelect from '../common/CustomSelect';

type SettingsTab = 'api' | 'context' | 'data' | 'byoc' | 'appearance';

const PROVIDER_OPTIONS: Record<string, { value: string; label: string }[]> = {
  default: [
    { value: 'fastapi', label: '接口 AI' },
  ],
  search: [
    { value: 'bocha', label: '博查 AI 搜索' },
    { value: 'tavily', label: 'Tavily' },
  ],
};

const CATEGORIES: { key: keyof ProviderConfig; label: string; Icon: typeof MessageSquare }[] = [
  { key: 'llm', label: 'LLM 提供商', Icon: MessageSquare },
  { key: 'image', label: '图片提供商', Icon: ImageIcon },
  { key: 'video', label: '视频提供商', Icon: Film },
  { key: 'search', label: '联网搜索', Icon: Eye },
];

export default function SettingsPanel() {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('api');

  const [providers, setProviders] = useState<ProviderConfig>({
    llm: 'fastapi',
    image: 'fastapi',
    video: 'fastapi',
    search: 'bocha',
  });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // 主题状态
  const [selectedTheme, setSelectedTheme] = useState<string>('purple');

  // 亮/暗模式状态
  const [colorMode, setColorMode] = useState<ColorMode>('dark');

  // 上下文压缩设置
  const [compact, setCompact] = useState<CompactSettings>(DEFAULT_COMPACT_SETTINGS);
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(true);

  // 加载设置
  useEffect(() => {
    settingsService.getAllSettings().then(settings => {
      setProviders(settings.providers);
      setApiKeys({ ...settings.apiKeys });
    });
    const theme = loadTheme();
    setSelectedTheme(theme);
    setColorMode(loadMode());
    setCompact(settingsService.getCompactSettings());
    try {
      const raw = localStorage.getItem('chat-feature-settings');
      if (raw) setAutoCompactEnabled(JSON.parse(raw).autoCompactEnabled ?? true);
    } catch { /* 用默认值 */ }
  }, []);

  const handleCompactChange = (patch: Partial<CompactSettings>) => {
    setCompact(prev => ({ ...prev, ...patch }));
    settingsService.setCompactSettings(patch);
    window.dispatchEvent(new CustomEvent('aishop:feature-settings-changed'));
  };

  // 自动压缩开关存在 featureSettings 里（useChat 消费），这里直接改同一个 key
  const handleAutoCompactToggle = () => {
    const next = !autoCompactEnabled;
    setAutoCompactEnabled(next);
    try {
      const raw = localStorage.getItem('chat-feature-settings');
      const parsed = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        'chat-feature-settings',
        JSON.stringify({ ...parsed, autoCompactEnabled: next })
      );
      // useChat 把 featureSettings 存在 state 里，需要显式通知它重读
      window.dispatchEvent(new CustomEvent('aishop:feature-settings-changed'));
    } catch { /* ignore */ }
  };

  // 切换亮/暗模式
  const handleModeChange = (mode: ColorMode) => {
    setColorMode(mode);
    document.documentElement.dataset.mode = mode;
    saveMode(mode);
    // 同步浏览器工具栏颜色（需要适配颜色主题）
    const meta = document.getElementById('meta-theme-color') as HTMLMetaElement | null;
    if (meta) {
      const darkColor = selectedTheme === 'purple' ? '#0d0a1a' : '#121211';
      meta.content = mode === 'light' ? '#f5f5f7' : darkColor;
    }
  };

  // 实时切换主题并自动保存
  const handleThemeChange = (themeId: string) => {
    setSelectedTheme(themeId);
    document.documentElement.dataset.theme = themeId;
    saveTheme(themeId);
    // 切换颜色主题时也更新状态栏 meta
    const meta = document.getElementById('meta-theme-color') as HTMLMetaElement | null;
    if (meta && colorMode === 'dark') {
      meta.content = themeId === 'purple' ? '#0d0a1a' : '#121211';
    }
  };

  // 切换提供商并自动保存
  const handleProviderChange = (category: keyof ProviderConfig, value: string) => {
    setProviders(prev => ({ ...prev, [category]: value }));
    settingsService.setProvider(category, value);
  };

  // 修改 API Key 并自动保存
  const handleApiKeyChange = (provider: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [provider]: value }));
    settingsService.setApiKey(provider, value);
  };

  const TABS: { key: SettingsTab; label: string; desc: string; Icon: typeof MessageSquare }[] = [
    { key: 'api', label: 'API 配置', desc: 'LLM、图片、视频与搜索提供商', Icon: KeyRound },
    { key: 'context', label: '上下文', desc: '自动压缩与摘要设置', Icon: MessageCircle },
    { key: 'data', label: '数据', desc: '备份、恢复与存储用量', Icon: Database },
    { key: 'byoc', label: 'BYOC', desc: '自带 S3 云同步设置', Icon: Cloud },
    { key: 'appearance', label: '外观', desc: '主题色', Icon: Palette },
  ];
  const [activeTabMeta, setActiveTabMeta] = useState<(typeof TABS)[number] | null>(null);

  // BYOC 连接状态：null=未检测（配置不完整），true=可用，false=不可用
  const [byocStatus, setByocStatus] = useState<boolean | null>(
    () => validateConfig(getByocConfig()) === null ? null : null
  );
  useEffect(() => {
    const handler = (e: Event) => {
      setByocStatus((e as CustomEvent<boolean | null>).detail);
    };
    window.addEventListener('aishop:byoc-connection-status', handler);
    return () => window.removeEventListener('aishop:byoc-connection-status', handler);
  }, []);

  const openTab = (tab: (typeof TABS)[number]) => {
    setActiveSettingsTab(tab.key);
    setActiveTabMeta(tab);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)]">
      {/* 顶部标题 */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0">
        {activeTabMeta && (
          <button
            type="button"
            onClick={() => setActiveTabMeta(null)}
            className="p-1 -ml-1 text-gray-400 hover:text-white transition-colors"
            aria-label="返回"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <h2 className="text-white text-lg font-semibold flex items-center gap-2">
          {activeTabMeta ? activeTabMeta.label : '设置'}
          {activeTabMeta?.key === 'byoc' && byocStatus !== null && (
            byocStatus
              ? <CheckCircle className="w-4 h-4 text-green-500" />
              : <AlertCircle className="w-4 h-4 text-amber-500" />
          )}
        </h2>
      </div>

      {/* 一级/二级页面容器：横向滑动切换 */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* 一级列表：分类入口 */}
        <div
          className={`absolute inset-0 overflow-y-auto px-4 py-2 transition-transform duration-300 ease-out ${
            activeTabMeta ? '-translate-x-full pointer-events-none' : 'translate-x-0'
          }`}
        >
          <div className="rounded-xl overflow-hidden bg-white/5 divide-y divide-[var(--color-border)]">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => openTab(tab)}
                className="w-full flex items-center gap-3 px-4 py-5 text-left hover:bg-white/5 transition-colors"
              >
                <tab.Icon className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{tab.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">{tab.desc}</div>
                </div>
                {tab.key === 'byoc' && byocStatus !== null && (
                  byocStatus
                    ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                )}
                <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* 二级页面：分类详情 */}
        <div
          className={`absolute inset-0 overflow-y-auto px-4 py-5 transition-transform duration-300 ease-out ${
            activeTabMeta ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {activeSettingsTab === 'api' && (
            <div className="space-y-6">
              {CATEGORIES.map(({ key, label, Icon }) => {
                const provider = providers[key];
                const apiKey = apiKeys[provider] ?? '';
                const keyVisible = showKeys[key] ?? false;

                return (
                  <div key={key} className="space-y-3">
                    {/* 分区标题 */}
                    <div className="flex items-center gap-2 text-white">
                      <Icon className="w-4 h-4 text-[var(--color-accent)]" />
                      <span className="text-sm font-medium">{label}</span>
                    </div>

                    {/* 提供商选择 */}
                    <CustomSelect
                      value={provider}
                      onChange={value => handleProviderChange(key, value)}
                      options={PROVIDER_OPTIONS[key] || PROVIDER_OPTIONS.default}
                    />

                    {/* API Key 输入 */}
                    <div className="relative">
                      <input
                        type={keyVisible ? 'text' : 'password'}
                        value={apiKey}
                        onChange={e => handleApiKeyChange(provider, e.target.value)}
                        placeholder="输入 API Key"
                        className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-3.5 pr-10 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeys(prev => ({ ...prev, [key]: !keyVisible }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white transition-colors"
                      >
                        {keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeSettingsTab === 'context' && (
            <div className="space-y-6">
              <p className="text-xs text-gray-400 leading-relaxed">
                对话变长后，较早的消息会被压缩成结构化摘要再发给模型，以此控制成本和延迟。
                原文始终保留在本地，随时可以查看或恢复。
              </p>

              {/* 自动压缩开关 */}
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">自动压缩</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    接近上下文上限时自动执行，不打断输入
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoCompactEnabled}
                  aria-label="自动压缩"
                  onClick={handleAutoCompactToggle}
                  className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
                    autoCompactEnabled ? 'bg-[var(--color-accent)]' : 'bg-white/15'
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      autoCompactEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* 压缩模型 */}
              <div className="space-y-2">
                <label htmlFor="compact-model" className="block text-sm font-medium text-white">
                  压缩模型
                </label>
                <CustomSelect
                  id="compact-model"
                  value={compact.model}
                  onChange={value => handleCompactChange({ model: value })}
                  options={CHAT_MODELS.map(m => ({ value: m.id, label: m.name }))}
                />
                <p className="text-xs text-gray-500">
                  摘要质量取决于此模型。小模型足够便宜，但长对话下可能丢细节。
                </p>
              </div>

              {/* 触发阈值 */}
              <div className="space-y-2">
                <label htmlFor="compact-threshold" className="block text-sm font-medium text-white">
                  触发阈值：{Math.round(compact.threshold * 100)}%
                </label>
                <input
                  id="compact-threshold"
                  type="range"
                  min={30}
                  max={90}
                  step={5}
                  value={Math.round(compact.threshold * 100)}
                  onChange={e => handleCompactChange({ threshold: Number(e.target.value) / 100 })}
                  className="w-full accent-[var(--color-accent)]"
                />
                <p className="text-xs text-gray-500">
                  压缩会改写请求前缀、使缓存命中失效，所以阈值不宜太低——攒到较高水位一次压掉一大段更划算。
                </p>
              </div>

              {/* 热窗口 */}
              <div className="space-y-2">
                <label htmlFor="compact-hot-window" className="block text-sm font-medium text-white">
                  保留最近消息：{compact.hotWindowSize} 条
                </label>
                <input
                  id="compact-hot-window"
                  type="range"
                  min={4}
                  max={40}
                  step={2}
                  value={compact.hotWindowSize}
                  onChange={e => handleCompactChange({ hotWindowSize: Number(e.target.value) })}
                  className="w-full accent-[var(--color-accent)]"
                />
                <p className="text-xs text-gray-500">
                  这些消息永远逐字发送，不会被压缩。
                </p>
              </div>
            </div>
          )}

          {activeSettingsTab === 'data' && <DataSettings />}

          {activeSettingsTab === 'byoc' && <ByocSettings />}

          {activeSettingsTab === 'appearance' && (
            <div className="space-y-6">
              {/* 亮/暗模式切换 */}
              <div className="space-y-3">
                <h3 className="text-white text-sm font-medium">显示模式</h3>
                <div className="flex rounded-xl bg-white/5 p-1 gap-1">
                  <button
                    onClick={() => handleModeChange('light')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      colorMode === 'light'
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    浅色
                  </button>
                  <button
                    onClick={() => handleModeChange('dark')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      colorMode === 'dark'
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    深色
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-white text-sm font-medium">主题色</h3>
                <div className="grid grid-cols-2 gap-3">
                {THEMES.map(theme => (
                  <button
                    key={theme.id}
                    onClick={() => handleThemeChange(theme.id)}
                    className={`relative flex items-center gap-3 p-4 rounded-xl border transition-all ${
                      selectedTheme === theme.id
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                        : 'border-[var(--color-border)] bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {/* 预览色圆点 */}
                    <span
                      className="w-8 h-8 rounded-full shrink-0 ring-2 ring-white/10"
                      style={{ backgroundColor: theme.previewColor }}
                    />
                    <span className="text-sm text-white font-medium">{theme.name}</span>
                    {/* 选中勾选 */}
                    {selectedTheme === theme.id && (
                      <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
