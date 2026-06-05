import { useEffect, useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import { X, MessageSquare, Image as ImageIcon, Film, Eye, EyeOff, Check } from 'lucide-react';
import { settingsService } from '../../services/settingsService';
import type { ProviderConfig } from '../../services/settingsService';
import { THEMES } from '../../config/themes';
import { loadTheme, saveTheme } from '../../services/storage';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = 'api' | 'appearance';

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

// 标题栏颜色映射表
const TITLEBAR_COLORS: Record<string, { bg: string; symbol: string }> = {
  purple: { bg: '#0d0a1a', symbol: '#ffffff' },
  green: { bg: 'rgb(18, 18, 17)', symbol: '#e0e0e0' },
};

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [visible, setVisible] = useState(false);
  const mounted = open || visible;

  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('api');

  const [providers, setProviders] = useState<ProviderConfig>({
    llm: 'fastapi',
    image: 'fastapi',
    video: 'fastapi',
    search: 'bocha',
  });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // 主题状态
  const [selectedTheme, setSelectedTheme] = useState<string>('purple');
  const initialThemeRef = useRef<string>('purple');

  // 动画控制
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => setVisible(false), 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 加载设置
  useEffect(() => {
    if (!open) return;
    settingsService.getAllSettings().then(settings => {
      setProviders(settings.providers);
      setApiKeys({ ...settings.apiKeys });
    });
    // 加载主题
    const theme = loadTheme();
    setSelectedTheme(theme);
    initialThemeRef.current = theme;
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  // 实时切换主题预览
  const handleThemeChange = (themeId: string) => {
    setSelectedTheme(themeId);
    document.documentElement.dataset.theme = themeId;
  };

  const handleCancel = () => {
    // 恢复之前的主题
    document.documentElement.dataset.theme = initialThemeRef.current;
    setSelectedTheme(initialThemeRef.current);
    onClose();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const cat of CATEGORIES) {
        await settingsService.setProvider(cat.key, providers[cat.key]);
        const provider = providers[cat.key];
        const key = apiKeys[provider] ?? '';
        await settingsService.setApiKey(provider, key);
      }
      // 保存主题
      saveTheme(selectedTheme);
      initialThemeRef.current = selectedTheme;
      // 通知主进程更新标题栏颜色
      if (window.electronAPI?.updateTitleBarColor) {
        const colors = TITLEBAR_COLORS[selectedTheme] || TITLEBAR_COLORS.purple;
        window.electronAPI.updateTitleBarColor(colors.bg, colors.symbol);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

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

  const TABS: { key: SettingsTab; label: string }[] = [
    { key: 'api', label: 'API 配置' },
    { key: 'appearance', label: '外观' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={overlayStyle}
      onClick={handleCancel}
      role="presentation"
    >
      <div
        className="w-[600px] max-w-[calc(100vw-2rem)] mx-4 h-[70vh] bg-[var(--color-bg-primary)] rounded-2xl shadow-2xl border border-[var(--color-border)] flex flex-col"
        style={panelStyle}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-panel-title"
      >
        {/* 顶部标题 */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--color-border)]">
          <h2 id="settings-panel-title" className="text-white text-lg font-semibold">
            设置
          </h2>
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 左右分栏主体 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* 左侧 Tab 栏 */}
          <div className="w-[140px] shrink-0 bg-[var(--color-bg-base)] py-4 flex flex-col gap-1">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveSettingsTab(tab.key)}
                className={`relative text-left px-4 py-2.5 text-sm transition-colors ${
                  activeSettingsTab === tab.key
                    ? 'bg-[var(--color-bg-primary)] text-white font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {activeSettingsTab === tab.key && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r bg-[var(--color-accent)]" />
                )}
                {tab.label}
              </button>
            ))}
          </div>

          {/* 右侧内容区域 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
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
                      <select
                        value={provider}
                        onChange={e => setProviders(prev => ({ ...prev, [key]: e.target.value }))}
                        className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm text-white focus:border-[var(--color-accent)] focus:outline-none transition-colors appearance-none cursor-pointer"
                      >
                        {(PROVIDER_OPTIONS[key] || PROVIDER_OPTIONS.default).map(opt => (
                          <option key={opt.value} value={opt.value} className="bg-[var(--color-bg-primary)] text-white">
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      {/* API Key 输入 */}
                      <div className="relative">
                        <input
                          type={keyVisible ? 'text' : 'password'}
                          value={apiKey}
                          onChange={e => setApiKeys(prev => ({ ...prev, [provider]: e.target.value }))}
                          placeholder="输入 API Key"
                          className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors"
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

            {activeSettingsTab === 'appearance' && (
              <div className="space-y-5">
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
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end items-center gap-3 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 text-gray-300 border border-[var(--color-border)] transition-colors focus:outline-none"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
