import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CHAT_MODELS } from '../../config/models';
import type { MessageVersion } from '../../types';

interface VersionNavigatorProps {
  versions: MessageVersion[];
  activeIndex: number;
  onSwitch: (index: number) => void;
}

const PROVIDER_ICON_MAP: Record<string, string> = {
  Anthropic: 'claude-color.svg',
  OpenAI: 'openai.svg',
  Google: 'gemini-color.svg',
  xAI: 'grok.svg',
  DeepSeek: 'deepseek-color.svg',
  '智谱': 'zhipu-color.svg',
  Moonshot: 'kimi-color.svg',
  Alibaba: 'qwen-color.svg',
  ByteDance: 'bytedance-color.svg',
  Xiaomi: 'xiaomimimo.svg',
};

function getProviderIcon(provider: string): string {
  const icon = PROVIDER_ICON_MAP[provider];
  return icon ? `${import.meta.env.BASE_URL}providers/${icon}` : `${import.meta.env.BASE_URL}providers/openai.svg`;
}

export default function VersionNavigator({
  versions,
  activeIndex,
  onSwitch,
}: VersionNavigatorProps) {
  const currentVersion = versions[activeIndex];
  if (!currentVersion) return null;

  const model = CHAT_MODELS.find((m) => m.id === currentVersion.model);
  const modelName = model?.name || currentVersion.model;
  const modelProvider = model?.provider || '';
  const iconSrc = getProviderIcon(modelProvider);

  const isFirst = activeIndex === 0;
  const isLast = activeIndex === versions.length - 1;

  return (
    <div className="flex items-center justify-between w-full">
      {/* 左侧：模型图标 + 名称 */}
      <div className="flex items-center gap-2">
        <img
          src={iconSrc}
          alt={modelProvider || 'AI'}
          className="w-4 h-4 rounded-sm"
        />
        <span className="text-sm font-medium text-gray-300">{modelName}</span>
      </div>

      {/* 右侧：版本导航 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={isFirst}
          onClick={() => onSwitch(activeIndex - 1)}
          className={`p-0.5 rounded transition-colors ${
            isFirst
              ? 'text-gray-700 cursor-not-allowed'
              : 'text-gray-500 hover:text-gray-300 cursor-pointer'
          }`}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs text-gray-500 min-w-[2rem] text-center">
          {activeIndex + 1}/{versions.length}
        </span>
        <button
          type="button"
          disabled={isLast}
          onClick={() => onSwitch(activeIndex + 1)}
          className={`p-0.5 rounded transition-colors ${
            isLast
              ? 'text-gray-700 cursor-not-allowed'
              : 'text-gray-500 hover:text-gray-300 cursor-pointer'
          }`}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
