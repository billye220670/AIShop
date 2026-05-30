import { useEffect, useRef, useState } from 'react';
import type { Model } from '../../types';

interface ModelSelectorProps {
  models: Model[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
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

function getProviderIcon(provider: string): string | null {
  const file = PROVIDER_ICON_MAP[provider];
  return file ? `/providers/${file}` : null;
}

export default function ModelSelector({ models, selectedModel, onModelChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = models.find((m) => m.id === selectedModel) ?? models[0];

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
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

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-gray-700 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-600 hover:border-gray-500 focus:outline-none focus:border-blue-500 cursor-pointer"
      >
        {currentIcon ? (
          <img src={currentIcon} alt={current.provider} className="w-4 h-4 shrink-0" />
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <span className="whitespace-nowrap">{current.provider} - {current.name}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 left-0 min-w-full max-h-72 overflow-y-auto bg-gray-800 border border-gray-600 rounded-lg shadow-lg py-1"
        >
          {models.map((model) => {
            const icon = getProviderIcon(model.provider);
            const active = model.id === selectedModel;
            return (
              <li key={model.id}>
                <button
                  type="button"
                  onClick={() => {
                    onModelChange(model.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                    active ? 'bg-blue-600/20 text-blue-300' : 'text-gray-200 hover:bg-gray-700'
                  }`}
                >
                  {icon ? (
                    <img src={icon} alt={model.provider} className="w-4 h-4 shrink-0" />
                  ) : (
                    <span className="w-4 h-4 shrink-0" />
                  )}
                  <span className="whitespace-nowrap">{model.provider} - {model.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
