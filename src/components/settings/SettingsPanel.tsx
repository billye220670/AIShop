import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { X, MessageSquare, Image as ImageIcon, Film, Eye, EyeOff } from 'lucide-react';
import { settingsService } from '../../services/settingsService';
import type { ProviderConfig } from '../../services/settingsService';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const PROVIDER_OPTIONS = [
  { value: 'fastapi', label: '接口AI' },
];

const CATEGORIES: { key: keyof ProviderConfig; label: string; Icon: typeof MessageSquare }[] = [
  { key: 'llm', label: 'LLM 提供商', Icon: MessageSquare },
  { key: 'image', label: '图片提供商', Icon: ImageIcon },
  { key: 'video', label: '视频提供商', Icon: Film },
];

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [visible, setVisible] = useState(false);
  const mounted = open || visible;

  const [providers, setProviders] = useState<ProviderConfig>({
    llm: 'fastapi',
    image: 'fastapi',
    video: 'fastapi',
  });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

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
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const cat of CATEGORIES) {
        await settingsService.setProvider(cat.key, providers[cat.key]);
        const provider = providers[cat.key];
        const key = apiKeys[provider] ?? '';
        await settingsService.setApiKey(provider, key);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={overlayStyle}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-w-[480px] w-full mx-4 bg-[#1a1a2e] rounded-2xl shadow-2xl border border-white/10 flex flex-col max-h-[85vh]"
        style={panelStyle}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-panel-title"
      >
        {/* 顶部标题 */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h2 id="settings-panel-title" className="text-white text-lg font-semibold">
            设置
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 主体内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {CATEGORIES.map(({ key, label, Icon }) => {
            const provider = providers[key];
            const apiKey = apiKeys[provider] ?? '';
            const keyVisible = showKeys[key] ?? false;

            return (
              <div key={key} className="space-y-3">
                {/* 分区标题 */}
                <div className="flex items-center gap-2 text-white">
                  <Icon className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-medium">{label}</span>
                </div>

                {/* 提供商选择 */}
                <select
                  value={provider}
                  onChange={e => setProviders(prev => ({ ...prev, [key]: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none transition-colors appearance-none cursor-pointer"
                >
                  {PROVIDER_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-[#1a1a2e] text-white">
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
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none transition-colors"
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

        {/* 底部按钮 */}
        <div className="flex justify-end items-center gap-3 px-6 py-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition-colors focus:outline-none"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
