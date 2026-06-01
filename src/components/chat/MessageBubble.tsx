import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Globe, TriangleAlert, Copy, Check, FileText } from 'lucide-react';
import type { ArtifactBlock } from '../../types';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import type { Message, MessageContent } from '../../types';
import LoadingDots from './LoadingDots';

/* ─── CodeBlock 组件：语法高亮 + 复制按钮 + 语言标签 ─── */
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  let highlighted: string;
  if (language && hljs.getLanguage(language)) {
    highlighted = hljs.highlight(code, { language }).value;
  } else {
    highlighted = hljs.highlightAuto(code).value;
  }

  return (
    <div className="relative group rounded-lg overflow-hidden my-3 border border-gray-700">
      {/* 顶部栏：语言标签 + 复制按钮 */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#1c2128] text-xs text-gray-400">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      {/* 代码区域 */}
      <pre className="!m-0 !rounded-none !bg-[#161b22]">
        <code
          className="block px-4 py-3 overflow-x-auto text-sm !bg-transparent"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

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
  onOpenArtifact?: (artifact: ArtifactBlock) => void;
}

export default function MessageBubble({ message, onSuggestionClick, showSuggestions, modelName, modelProvider, onOpenArtifact }: MessageBubbleProps) {
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
        <div className="prose prose-invert max-w-none prose-headings:text-gray-100 prose-p:text-gray-200 prose-strong:text-white prose-code:text-blue-300 prose-pre:bg-transparent prose-pre:border-none prose-pre:p-0 prose-a:text-blue-400 prose-li:text-gray-200 prose-blockquote:border-gray-600 prose-blockquote:text-gray-300 prose-th:text-gray-200 prose-td:text-gray-300 prose-hr:border-gray-700">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeStr = String(children).replace(/\n$/, '');
                // 有 language 标记视为代码块
                if (match) {
                  return <CodeBlock code={codeStr} language={match[1]} />;
                }
                // 没有 language 但被 pre 包裹的（无语言标注的代码块）
                // react-markdown 对 fenced code block 总会加 className，这里处理行内代码
                return (
                  <code className="bg-gray-700/50 px-1.5 py-0.5 rounded text-sm" {...props}>
                    {children}
                  </code>
                );
              },
              pre({ children }) {
                // 如果子元素已经是 CodeBlock，直接返回，不再包裹 pre
                return <>{children}</>;
              }
            }}
          >
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
      <div className="flex flex-col items-end mb-4">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 max-w-[80%] justify-end">
            {message.attachments.map((file, idx) => (
              <div key={idx} className="flex items-center gap-3 px-3 py-2.5 bg-[#1e2030] border border-gray-700/50 rounded-lg min-w-[200px] max-w-[280px]">
                <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-purple-500/15">
                  <FileText className="w-5 h-5 text-[rgb(127,96,255)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 font-medium truncate">{file.name}</div>
                  <div className="text-xs text-gray-500">File</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="max-w-[80%] rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br px-4 py-3 bg-[rgb(127,96,255)] text-white">
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
        <div className="flex items-center gap-2 mb-4">
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
            {message.artifact && (
              <div
                onClick={() => onOpenArtifact?.(message.artifact!)}
                className="mt-3 p-3 bg-[#1a1a2e] border border-gray-700 rounded-xl cursor-pointer hover:border-purple-500 transition-colors flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-white font-medium text-sm">{message.artifact.title}</div>
                  <div className="text-gray-400 text-xs">点击预览</div>
                </div>
              </div>
            )}
            {showSuggestions &&
              message.suggestions &&
              message.suggestions.length > 0 &&
              !message.isStreaming && (
                <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-gray-700">
                  {message.suggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSuggestionClick?.(suggestion)}
                      className="text-sm px-4 py-2 bg-[rgba(127,96,255,0.15)] hover:bg-[rgba(127,96,255,0.25)] text-gray-200 rounded-full transition-colors border border-[rgba(127,96,255,0.3)] hover:border-[rgba(127,96,255,0.5)]"
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
