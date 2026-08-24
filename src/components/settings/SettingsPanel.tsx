import { useEffect, useState } from 'react';
import { MessageSquare, Image as ImageIcon, Eye, Check, ChevronLeft, ChevronRight, KeyRound, MessageCircle, Database, Palette, Sun, Moon, Cloud, CheckCircle, AlertCircle, MapPin } from 'lucide-react';
import PasswordInput from './PasswordInput';
import { settingsService, DEFAULT_COMPACT_SETTINGS } from '../../services/settingsService';
import type { ProviderConfig, CompactSettings } from '../../services/settingsService';
import { getCachedCity, getCitySource, setManualCity, clearManualCity, ensureCity } from '../../services/locationService';
import { THEMES } from '../../config/themes';
import { loadTheme, saveTheme, loadMode, saveMode, type ColorMode } from '../../services/storage';
import { syncElectronTitleBar } from '../../utils/electronTitleBar';
import { CHAT_MODELS } from '../../config/models';
import { PIX2REAL_DEFAULT_BASE_URL } from '../../config/providers';
import DataSettings from './DataSettings';
import ByocSettings from './ByocSettings';
import { getByocConfig, testConnection, validateConfig, SETTINGS_SYNCED_EVENT } from '../../services/byoc';
import CustomSelect from '../common/CustomSelect';
import { haptic } from '../../utils/haptics';
import { useDeviceMode } from '../../platform/useDeviceMode';

type SettingsTab = 'api' | 'context' | 'data' | 'byoc' | 'appearance';

type CategoryKey = keyof ProviderConfig | 'location';

const PROVIDER_OPTIONS: Record<string, { value: string; label: string }[]> = {
  default: [
    { value: 'fastapi', label: '接口 AI' },
  ],
  image: [
    { value: 'fastapi', label: '接口 AI' },
    { value: 'falai', label: 'Fal AI' },
    { value: 'pix2real', label: 'Pix2Real' },
  ],
  search: [
    { value: 'bocha', label: '博查 AI 搜索' },
    { value: 'tavily', label: 'Tavily' },
  ],
};

const CATEGORIES: { key: CategoryKey; label: string; desc: string; Icon: typeof MessageSquare }[] = [
  { key: 'llm', label: 'LLM 提供商', desc: '对话使用的模型服务', Icon: MessageSquare },
  { key: 'image', label: '图片提供商', desc: '图片生成服务', Icon: ImageIcon },
  { key: 'search', label: '联网搜索', desc: '联网检索服务', Icon: Eye },
  { key: 'location', label: '位置信息', desc: '所在城市，天气等本地问题', Icon: MapPin },
];

export default function SettingsPanel() {
  const mode = useDeviceMode();
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('api');

  const [providers, setProviders] = useState<ProviderConfig>({
    llm: 'fastapi',
    image: 'fastapi',
    search: 'bocha',
  });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  // 自建提供商（Pix2Real）的服务地址；留空则用内置默认值
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});

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
      setBaseUrls({ ...(settings.baseUrls || {}) });
    });
    // BYOC 同步拉回云端 API 设置时重读（换设备场景：配好 BYOC 后 key 自动带过来）
    const onSettingsSynced = () => {
      settingsService.getAllSettings().then(settings => {
        setProviders(settings.providers);
        setApiKeys({ ...settings.apiKeys });
        setBaseUrls({ ...(settings.baseUrls || {}) });
      });
    };
    window.addEventListener(SETTINGS_SYNCED_EVENT, onSettingsSynced);
    const theme = loadTheme();
    setSelectedTheme(theme);
    setColorMode(loadMode());
    setCompact(settingsService.getCompactSettings());
    try {
      const raw = localStorage.getItem('chat-feature-settings');
      if (raw) setAutoCompactEnabled(JSON.parse(raw).autoCompactEnabled ?? true);
    } catch { /* 用默认值 */ }
    return () => window.removeEventListener(SETTINGS_SYNCED_EVENT, onSettingsSynced);
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
    // Electron：窗口标题栏 overlay 颜色同步（Web 下为 no-op）
    syncElectronTitleBar(selectedTheme, mode);
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
    // Electron：窗口标题栏 overlay 颜色同步（Web 下为 no-op）
    syncElectronTitleBar(themeId, colorMode);
  };

  // 切换提供商并自动保存（位置信息分类不经过这里）
  const handleProviderChange = (category: keyof ProviderConfig | 'location', value: string) => {
    if (category === 'location') return;
    setProviders(prev => ({ ...prev, [category]: value }));
    settingsService.setProvider(category, value);
  };

  // 修改 API Key 并自动保存
  const handleApiKeyChange = (provider: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [provider]: value }));
    settingsService.setApiKey(provider, value);
  };

  // 修改自建提供商服务地址并自动保存（留空即回落内置默认值）
  const handleBaseUrlChange = (provider: string, value: string) => {
    setBaseUrls(prev => ({ ...prev, [provider]: value }));
    void settingsService.setBaseUrl(provider, value);
  };

  const TABS: { key: SettingsTab; label: string; desc: string; Icon: typeof MessageSquare }[] = [
    { key: 'api', label: 'API 配置', desc: 'LLM、图片与搜索提供商', Icon: KeyRound },
    { key: 'context', label: '上下文', desc: '自动压缩与摘要设置', Icon: MessageCircle },
    { key: 'data', label: '数据', desc: '备份、恢复与存储用量', Icon: Database },
    { key: 'byoc', label: 'BYOC', desc: '自带 S3 云同步设置', Icon: Cloud },
    { key: 'appearance', label: '外观', desc: '主题色', Icon: Palette },
  ];
  const [activeTabMeta, setActiveTabMeta] = useState<(typeof TABS)[number] | null>(null);
  // API 分类三级页：进入分类详情时非空，支撑「逐层返回」与三级页面渲染
  const [activeCategory, setActiveCategory] = useState<(typeof CATEGORIES)[number] | null>(null);

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

  // 挂载（进入设置面板）即检测一次 BYOC 连通性：否则只有进 BYOC 页（ByocSettings 挂载）才触发检测，
  // 一级列表的对勾/警告图标要进出一次才显示
  useEffect(() => {
    if (validateConfig(getByocConfig()) !== null) return; // 配置不完整：保持未检测（不显示图标）
    let alive = true;
    testConnection()
      .then(() => { if (alive) setByocStatus(true); })
      .catch(() => { if (alive) setByocStatus(false); });
    return () => { alive = false; };
  }, []);

  const openTab = (tab: (typeof TABS)[number]) => {
    setActiveSettingsTab(tab.key);
    setActiveTabMeta(tab);
    // 切换一级分类时回到分类列表（不残留三级页）
    setActiveCategory(null);
  };

  // 逐层返回：三级（分类详情）→ 二级（分类列表）→ 一级（设置分类）
  const goBack = () => {
    if (activeCategory) {
      setActiveCategory(null);
    } else {
      setActiveTabMeta(null);
    }
  };

  // 位置信息状态：当前生效城市与来源（手动/自动），手动设置覆盖自动定位
  const [cityInput, setCityInput] = useState('');
  const [currentCity, setCurrentCity] = useState<string | null>(() => getCachedCity());
  const [citySource, setCitySource] = useState<'manual' | 'auto' | null>(() => getCitySource());

  const handleCitySave = () => {
    setManualCity(cityInput);
    setCurrentCity(cityInput.trim());
    setCitySource('manual');
    setCityInput('');
    haptic();
  };

  const handleCityClear = () => {
    clearManualCity();
    setCurrentCity(null);
    setCitySource(null);
    // 清除手动设置后立即重新自动定位，完成后刷新显示
    ensureCity().then(city => {
      setCurrentCity(city);
      setCitySource(city ? 'auto' : null);
    });
    haptic();
  };

  // API 分类详情页数据（activeCategory 非空时使用；位置信息分类不涉及提供商）
  const activeProvider =
    activeCategory && activeCategory.key !== 'location' ? providers[activeCategory.key] : '';
  // 提供商分支使用的分类（已排除位置信息，key 收窄为 keyof ProviderConfig，供 JSX 闭包内安全引用）
  const activeCat = activeCategory && activeCategory.key !== 'location' ? activeCategory : null;
  const activeApiKey = activeCategory ? (apiKeys[activeProvider] ?? '') : '';
  // Pix2Real 是自建服务，地址随部署（本机 / frp 公网）变化，需要额外一个地址输入框
  const needsBaseUrl = activeProvider === 'pix2real';
  const activeBaseUrl = needsBaseUrl ? (baseUrls[activeProvider] ?? '') : '';

  // 移动端为通栏布局：页面背景需与底部菜单栏一致（bg-base）；桌面端是悬浮卡片，保留提亮一档的 bg-primary
  // settings-panel 标识：浅色模式下卡片背景与分割线整体再淡一档（见 index.css [data-mode="light"] 覆盖）
  return (
    <div className={`settings-panel flex flex-col h-full ${mode === 'mobile' ? 'bg-[var(--color-bg-base)]' : 'bg-[var(--color-bg-primary)]'}`}>
      {/* 顶部标题 */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0">
        {activeTabMeta && (
          <button
            type="button"
            onClick={goBack}
            className="p-1 -ml-1 text-gray-400 hover:text-white transition-colors"
            aria-label="返回"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <h2 className="text-white text-lg font-semibold flex items-center gap-2">
          {activeCategory ? activeCategory.label : activeTabMeta ? activeTabMeta.label : '设置'}
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
            !activeTabMeta ? 'translate-x-full' : activeCategory ? '-translate-x-full pointer-events-none' : 'translate-x-0'
          }`}
        >
          {activeSettingsTab === 'api' && (
            /* API 分类入口：iOS 设置列表风格，点击进入分类详情 */
            <div className="rounded-xl overflow-hidden bg-white/5 divide-y divide-[var(--color-border)]">
              {CATEGORIES.map(({ key, label, desc, Icon }) => {
                if (key === 'location') {
                  // 位置信息分类：右侧显示当前城市与来源，不涉及提供商
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveCategory({ key, label, desc, Icon })}
                      className="w-full flex items-center gap-3 px-4 py-5 text-left hover:bg-white/5 transition-colors"
                    >
                      <Icon className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white">{label}</div>
                        <div className="text-xs text-gray-400 mt-0.5 truncate">{desc}</div>
                      </div>
                      <span className="text-sm text-gray-400 truncate">
                        {currentCity
                          ? `当前：${currentCity}${citySource === 'manual' ? '（手动）' : ''}`
                          : '自动定位'}
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                    </button>
                  );
                }
                const provider = providers[key];
                const current = (PROVIDER_OPTIONS[key] || PROVIDER_OPTIONS.default).find(o => o.value === provider);
                return (
                  <button
                    key={key}
                    onClick={() => setActiveCategory({ key, label, desc, Icon })}
                    className="w-full flex items-center gap-3 px-4 py-5 text-left hover:bg-white/5 transition-colors"
                  >
                    <Icon className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white">{label}</div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{desc}</div>
                    </div>
                    <span className="text-sm text-gray-400 truncate">{current?.label ?? provider}</span>
                    <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                  </button>
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
                  onClick={() => { haptic(); handleAutoCompactToggle(); }}
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

        {/* 三级页面：API 分类详情（提供商选择 + API Key；位置信息分类为城市设置） */}
        <div
          className={`absolute inset-0 overflow-y-auto px-4 py-5 transition-transform duration-300 ease-out ${
            activeCategory ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {activeCategory && activeCategory.key === 'location' ? (
            <div className="space-y-6">
              {/* 分区标题 */}
              <div className="flex items-center gap-2 text-white">
                <MapPin className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="text-sm font-medium">位置信息</span>
              </div>

              <p className="text-xs text-gray-400 leading-relaxed">
                天气、出行等本地实时问题需要知道您所在的城市，城市会注入系统提示词并用于搜索词。
                默认按 IP 自动定位；定位不准时可手动填写，手动设置会覆盖自动定位。
              </p>

              <div className="text-xs text-gray-400">
                当前：
                {currentCity ? <span className="text-white">{currentCity}</span> : '未获取'}
                {citySource === 'manual' && (
                  <span className="text-[var(--color-accent)] ml-1">（手动设置）</span>
                )}
                {citySource === 'auto' && (
                  <span className="text-gray-500 ml-1">（自动定位）</span>
                )}
              </div>

              <input
                value={cityInput}
                onChange={e => setCityInput(e.target.value)}
                placeholder="例：深圳 / Shenzhen"
                className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-3.5 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={handleCitySave}
                disabled={!cityInput.trim()}
                className="w-full rounded-xl py-3.5 bg-[var(--color-accent)] text-[var(--color-accent-foreground)] text-sm font-semibold disabled:opacity-40"
              >
                保存城市
              </button>
              {citySource === 'manual' && (
                <button
                  type="button"
                  onClick={handleCityClear}
                  className="w-full rounded-xl py-3.5 bg-white/5 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  清除手动设置，恢复自动定位
                </button>
              )}
            </div>
          ) : activeCat ? (
            <div className="space-y-6">
              {/* 分区标题 */}
              <div className="flex items-center gap-2 text-white">
                <activeCat.Icon className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="text-sm font-medium">{activeCat.label}</span>
              </div>

              {/* 提供商选择 */}
              <CustomSelect
                value={activeProvider}
                onChange={value => handleProviderChange(activeCat.key, value)}
                options={PROVIDER_OPTIONS[activeCat.key] || PROVIDER_OPTIONS.default}
              />

              {/* API Key 输入（PasswordInput：带明暗切换，密码框长按弹自定义粘贴菜单） */}
              <PasswordInput
                value={activeApiKey}
                onValueChange={v => handleApiKeyChange(activeProvider, v)}
                placeholder="输入 API Key"
                className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-3.5 pr-10 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors"
              />

              {/* 自建提供商服务地址（Pix2Real）：留空用默认本机地址 */}
              {needsBaseUrl && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={activeBaseUrl}
                    onChange={e => handleBaseUrlChange(activeProvider, e.target.value)}
                    placeholder={PIX2REAL_DEFAULT_BASE_URL}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-3.5 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors"
                  />
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Pix2Real 服务地址。留空使用本机默认 {PIX2REAL_DEFAULT_BASE_URL}；
                    公网接入填 http://VPS_IP:3000/api/v1。
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
