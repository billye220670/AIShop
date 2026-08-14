/**
 * 云同步（BYOC）设置区块。
 *
 * 用户自带 S3 兼容存储（COS/OSS/R2/MinIO/自定义），配置凭证后数据直接
 * 同步到自己的桶。凭证只存本机 localStorage、请求现场签名，不出设备；
 * 代价是需要用户在自己的存储控制台配置 CORS（见失败提示文案）。
 */
import { useEffect, useState } from 'react';
import PasswordInput from './PasswordInput';
import { haptic } from '../../utils/haptics';
import {
  getByocConfig,
  updateByocConfig,
  testConnection,
  validateConfig,
  BYOC_STATUS_EVENT,
} from '../../services/byoc';
import { BYOC_PROVIDER_PRESETS, type ByocConfig, type ByocProvider } from '../../services/byoc/types';
import { settingsService } from '../../services/settingsService';
import CustomSelect from '../common/CustomSelect';

const PROVIDER_OPTIONS = [
  { value: 'cos', label: '腾讯云 COS' },
  { value: 'oss', label: '阿里云 OSS' },
  { value: 'r2', label: 'Cloudflare R2' },
  { value: 'minio', label: 'MinIO（自建）' },
  { value: 'b2', label: 'Backblaze B2' },
  { value: 'custom', label: '自定义 S3' },
];

const ENDPOINT_HINTS: Record<ByocProvider, string> = {
  cos: 'cos.ap-guangzhou.myqcloud.com',
  oss: 'oss-cn-hangzhou.aliyuncs.com',
  r2: '你的账户ID.r2.cloudflarestorage.com',
  minio: '192.168.1.10:9000',
  b2: 's3.us-west-004.backblazeb2.com',
  custom: 's3.example.com',
};

export default function ByocSettings() {
  const [cfg, setCfg] = useState<ByocConfig>(getByocConfig());
  const [syncApiSettings, setSyncApiSettings] = useState(settingsService.getSyncApiSettings());

  // 配置变更后防抖自动检测连通性，结果通过自定义事件上报给 SettingsPanel 显示状态图标
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (validateConfig(cfg) !== null) {
        window.dispatchEvent(new CustomEvent('aishop:byoc-connection-status', { detail: null }));
        return;
      }
      try {
        await testConnection(cfg);
        window.dispatchEvent(new CustomEvent('aishop:byoc-connection-status', { detail: true }));
      } catch {
        window.dispatchEvent(new CustomEvent('aishop:byoc-connection-status', { detail: false }));
      }
    };
    const handle = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 800);
    };
    // 首次挂载立即检测一次（不等防抖）
    run();
    window.addEventListener(BYOC_STATUS_EVENT, handle);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(BYOC_STATUS_EVENT, handle);
    };
  }, [cfg]);

  const patch = (p: Partial<ByocConfig>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    updateByocConfig(p);
  };

  const handleProviderChange = (value: string) => {
    const provider = value as ByocProvider;
    const preset = BYOC_PROVIDER_PRESETS[provider as keyof typeof BYOC_PROVIDER_PRESETS];
    const p: Partial<ByocConfig> = { provider };
    if (preset) {
      p.region = preset.region;
      p.pathStyle = preset.pathStyle;
      // 没填过 endpoint 时用预设的占位提示（cos/oss/r2/b2 的 endpoint 是空模板）
      if (!cfg.endpoint.trim()) p.endpoint = preset.endpoint;
    }
    patch(p);
  };

  const inputClass =
    'w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-4 py-4 pr-10 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors';

  return (
    <section className="space-y-4">
      {/* 自动同步开关 */}
      <div className="flex items-center justify-between gap-4 rounded-xl bg-white/5 px-4 py-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">自动同步</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={cfg.enabled}
          aria-label="自动同步"
          onClick={() => { haptic(); patch({ enabled: !cfg.enabled }); }}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            cfg.enabled ? 'bg-[var(--color-accent)]' : 'bg-white/15'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              cfg.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 同步 API 设置开关：API Key 与供应商选择随同步带到其他设备（明文存于用户自己的桶） */}
      <div className="flex items-center justify-between gap-4 rounded-xl bg-white/5 px-4 py-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">同步 API 设置</div>
          <div className="mt-1 text-xs leading-relaxed text-gray-400">
            API Key 与供应商选择将明文存储在你的云桶中，换设备后自动带过去
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={syncApiSettings}
          aria-label="同步 API 设置"
          onClick={() => {
            haptic();
            const next = !syncApiSettings;
            setSyncApiSettings(next);
            settingsService.setSyncApiSettings(next);
          }}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            syncApiSettings ? 'bg-[var(--color-accent)]' : 'bg-white/15'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              syncApiSettings ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 服务商与连接参数 */}
      <div className="space-y-2">
        <CustomSelect
          value={cfg.provider}
          onChange={handleProviderChange}
          options={PROVIDER_OPTIONS}
        />
        <input
          value={cfg.endpoint}
          onChange={e => patch({ endpoint: e.target.value })}
          placeholder={`Endpoint（如 ${ENDPOINT_HINTS[cfg.provider]}）`}
          className={inputClass}
        />
        <div className="flex gap-2">
          <input
            value={cfg.region}
            onChange={e => patch({ region: e.target.value })}
            placeholder="Region（如 ap-guangzhou）"
            className="flex-1 min-w-0 bg-white/5 border border-[var(--color-border)] rounded-lg px-4 py-4 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors"
          />
          <input
            value={cfg.bucket}
            onChange={e => patch({ bucket: e.target.value })}
            placeholder="Bucket 名称"
            className="flex-1 min-w-0 bg-white/5 border border-[var(--color-border)] rounded-lg px-4 py-4 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* 凭证 */}
      <div className="space-y-2">
        <input
          value={cfg.accessKey}
          onChange={e => patch({ accessKey: e.target.value })}
          placeholder="Access Key"
          className={inputClass}
        />
        {/* Secret Key（PasswordInput：带明暗切换，密码框长按弹自定义粘贴菜单） */}
        <PasswordInput
          value={cfg.secretKey}
          onValueChange={v => patch({ secretKey: v })}
          placeholder="Secret Key"
          className={inputClass}
        />
      </div>
    </section>
  );
}
