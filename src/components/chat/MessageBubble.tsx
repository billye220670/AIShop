import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Globe, TriangleAlert } from 'lucide-react';
import type { Message, MessageContent } from '../../types';
import LoadingDots from './LoadingDots';

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

function getProviderIcon(provider: string): string {
  const icon = PROVIDER_ICON_MAP[provider];
  return icon ? `/providers/${icon}` : '/providers/openai.svg';
}

interface MessageBubbleProps {
  message: Message;
  onSuggestionClick?: (text: string) => void;
  showSuggestions?: boolean;
  modelName?: string;
  modelProvider?: string;
}

export default function MessageBubble({ message, onSuggestionClick, showSuggestions, modelName, modelProvider }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  // AI消息内容为空且正在流式输出 → 显示加载状态
  const isAiLoading = !isUser && message.isStreaming && (
    typeof message.content === 'string' ? message.content === '' : false
  );

  const renderContent = () => {
    if (typeof message.content === 'string') {
      if (isUser) {
        return <p className="whitespace-pre-wrap">{message.content}</p>;
      }
      return (
        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-gray-100 prose-p:text-gray-200 prose-strong:text-white prose-code:text-blue-300 prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700 prose-a:text-blue-400 prose-li:text-gray-200 prose-blockquote:border-gray-600 prose-blockquote:text-gray-300 prose-th:text-gray-200 prose-td:text-gray-300 prose-hr:border-gray-700">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5" />
          )}
        </div>
      );
    }

    // Multi-part content (text + images)
    const parts = message.content as MessageContent[];
    return (
      <div className="space-y-2">
        {parts.map((part, idx) => {
          if (part.type === 'text' && part.text) {
            return <p key={idx} className="whitespace-pre-wrap">{part.text}</p>;
          }
          if (part.type === 'image_url' && part.image_url) {
            return (
              <img
                key={idx}
                src={part.image_url.url}
                alt="uploaded"
                className="max-w-xs rounded-lg"
              />
            );
          }
          return null;
        })}
      </div>
    );
  };

  // 用户消息：保持原样
  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-blue-600 text-white">
          {renderContent()}
        </div>
      </div>
    );
  }

  // AI消息：无背景、无边框、撑满宽度
  return (
    <div className="flex justify-start mb-4">
      <div className="w-full px-4 py-3 text-gray-100">
        {/* 模型图标 + 名称 */}
        <div className="flex items-center gap-2 mb-2">
          <img
            src={modelProvider ? getProviderIcon(modelProvider) : '/providers/openai.svg'}
            alt={modelProvider || 'AI'}
            className="w-5 h-5"
          />
          <span className="text-sm font-medium text-gray-300">{modelName || 'AI'}</span>
        </div>

        {/* 加载状态 */}
        {isAiLoading && <LoadingDots />}

        {/* 正常内容 */}
        {!isAiLoading && (
          <>
            {message.webSearched && (
              <div className="flex items-center gap-1.5 text-xs text-green-400 mb-2">
                <Globe className="w-3.5 h-3.5" />
                <span>已联网搜索</span>
              </div>
            )}
            {message.webSearchFailed && (
              <div className="flex items-center gap-1.5 text-xs text-yellow-400 mb-2">
                <TriangleAlert className="w-3.5 h-3.5" />
                <span>联网搜索失败，以下回答未参考网络信息</span>
              </div>
            )}
            {renderContent()}
            {message.searchResults &&
              message.searchResults.length > 0 &&
              !message.isStreaming && (
                <div className="mt-3 pt-2 border-t border-gray-700">
                  <div className="text-xs text-gray-400 mb-1.5">参考来源：</div>
                  <div className="flex flex-wrap gap-1.5">
                    {message.searchResults.slice(0, 5).map((source, idx) => (
                      <a
                        key={idx}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-2 py-0.5 bg-gray-700/50 hover:bg-gray-600/50 text-blue-400 hover:text-blue-300 rounded border border-gray-600 transition-colors truncate max-w-[200px]"
                        title={source.name}
                      >
                        {source.siteName || source.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            {showSuggestions &&
              message.suggestions &&
              message.suggestions.length > 0 &&
              !message.isStreaming && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-700">
                  {message.suggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSuggestionClick?.(suggestion)}
                      className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-full transition-colors border border-gray-600 hover:border-gray-500"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
}
