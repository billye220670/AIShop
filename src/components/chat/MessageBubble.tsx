import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Globe, TriangleAlert, Copy, Check, FileText, FileDown, RefreshCw, MessageSquareQuote, ChevronDown, ChevronUp } from 'lucide-react';
import type { ArtifactBlock } from '../../types';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import type { Message, MessageContent } from '../../types';
import LoadingDots from './LoadingDots';
import VersionNavigator from './VersionNavigator';
import CompareButton from './CompareButton';

/* ─── 打开外部链接辅助函数 ─── */
function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

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
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-code-bg)] text-xs text-gray-400">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      {/* 代码区域 */}
      <pre className="!m-0 !rounded-none !bg-[var(--color-code-bg)]">
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
  return icon ? `${import.meta.env.BASE_URL}providers/${icon}` : `${import.meta.env.BASE_URL}providers/openai.svg`;
}


interface MessageBubbleProps {
  message: Message;
  onSuggestionClick?: (text: string) => void;
  showSuggestions?: boolean;
  modelName?: string;
  modelProvider?: string;
  onOpenArtifact?: (artifact: ArtifactBlock) => void;
  onRegenerate?: (messageId: string) => void;
  onQuote?: (message: Message) => void;
  isStreaming?: boolean;
  onCompareWithModel?: (messageId: string, modelId: string) => void;
  onSwitchVersion?: (messageId: string, index: number) => void;
}

export default function MessageBubble({ message, onSuggestionClick, showSuggestions, modelName, modelProvider, onOpenArtifact, onRegenerate, onQuote, isStreaming, onCompareWithModel, onSwitchVersion }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false); // 新增：控制搜索结果展开/折叠

  // 多版本相关
  const hasMultipleVersions = message.versions && message.versions.length > 1;
  const activeVersion = message.versions?.[message.activeVersionIndex ?? 0];

  // 确定要显示的内容（版本感知）
  const displayContent = activeVersion ? activeVersion.content : message.content;
  const displayIsStreaming = activeVersion ? activeVersion.isStreaming : message.isStreaming;
  const displaySuggestions = activeVersion ? activeVersion.suggestions : message.suggestions;
  const displayArtifact = activeVersion ? activeVersion.artifact : message.artifact;
  const displayWebSearched = activeVersion ? activeVersion.webSearched : message.webSearched;
  const displayWebSearchFailed = activeVersion ? activeVersion.webSearchFailed : message.webSearchFailed;
  const displaySearchResults = activeVersion ? activeVersion.searchResults : message.searchResults;
  const displayWebSearching = activeVersion ? activeVersion.webSearching : message.webSearching;

  // AI消息内容为空且正在流式输出 → 显示加载状态
  const isAiLoading = !isUser && displayIsStreaming && (
    typeof displayContent === 'string' ? displayContent === '' : false
  );

  // 预处理内容：将引用标识 [N] 转为可识别的链接格式
  const preprocessCitations = useCallback((text: string) => {
    if (!displaySearchResults || displaySearchResults.length === 0) return text;
    // 匹配 [1], [2] ... [N] 形式的引用标识（排除 markdown 链接语法 [text](url) ）
    return text.replace(/\[(\d+)\](?!\()/g, (match, num) => {
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < displaySearchResults.length) {
        return `[${num}](cite:${num})`;
      }
      return match;
    });
  }, [displaySearchResults]);

  const renderContent = () => {
    if (typeof displayContent === 'string') {
      if (isUser) {
        return <p className="whitespace-pre-wrap">{displayContent}</p>;
      }
      const processedContent = preprocessCitations(displayContent);
      return (
        <div className="prose prose-invert max-w-none prose-headings:text-gray-100 prose-p:text-gray-200 prose-strong:text-white prose-code:text-blue-300 prose-pre:bg-transparent prose-pre:border-none prose-pre:p-0 prose-a:text-blue-400 prose-li:text-gray-200 prose-blockquote:border-gray-600 prose-blockquote:text-gray-300 prose-th:text-gray-200 prose-td:text-gray-300 prose-hr:border-gray-700">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => url}
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
              },
              a({ href, children }) {
                // 引用标识：cite:N 格式 → 渲染为圆形数字按钮
                if (href?.startsWith('cite:')) {
                  const num = href.replace('cite:', '');
                  const idx = parseInt(num, 10) - 1;
                  const url = displaySearchResults?.[idx]?.url;
                  return (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); if (url) openUrl(url); }}
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-[10px] font-bold hover:bg-[var(--color-accent)]/40 hover:text-white transition-colors cursor-pointer align-super mx-0.5 no-underline"
                      title={displaySearchResults?.[idx]?.name || `来源 ${num}`}
                    >
                      {num}
                    </button>
                  );
                }
                // 普通链接：用系统浏览器打开
                return (
                  <a
                    href={href}
                    onClick={(e) => { e.preventDefault(); if (href) openUrl(href); }}
                    className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                  >
                    {children}
                  </a>
                );
              }
            }}
          >
            {processedContent}
          </ReactMarkdown>
          {displayIsStreaming && (
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] animate-[pulse-dot_1.4s_ease-in-out_infinite] ml-1 align-middle shadow-[0_0_8px_var(--color-accent)]" />
          )}
        </div>
      );
    }

    // Multi-part content (text + images)
    const parts = displayContent as MessageContent[];
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
                className="max-w-full rounded-lg"
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
              <div key={idx} className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-secondary)] border border-gray-700/50 rounded-lg min-w-[200px] max-w-[280px]">
                <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-[var(--color-accent-soft)]">
                  <FileText className="w-5 h-5 text-[var(--color-accent)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 font-medium truncate">{file.name}</div>
                  <div className="text-xs text-gray-500">File</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="max-w-[80%] rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-none px-4 py-3 bg-[var(--color-accent)] text-[var(--color-accent-foreground)]">
          {renderContent()}
        </div>
      </div>
    );
  }

  // AI消息：无背景、无边框、撑满宽度
  return (
    <div className="flex justify-start mb-4">
      <div className="w-full px-4 py-3 text-gray-100">
        {/* 模型图标 + 名称 / 版本导航 */}
        <div className="flex items-center gap-2 mb-4">
          {hasMultipleVersions ? (
            <VersionNavigator
              versions={message.versions!}
              activeIndex={message.activeVersionIndex ?? 0}
              onSwitch={(idx) => onSwitchVersion?.(message.id, idx)}
            />
          ) : (
            <>
              <img
                src={modelProvider ? getProviderIcon(modelProvider) : `${import.meta.env.BASE_URL}providers/openai.svg`}
                alt={modelProvider || 'AI'}
                className="w-5 h-5"
              />
              <span className="text-sm font-medium text-gray-300">{modelName || 'AI'}</span>
            </>
          )}
        </div>

        {/* 联网搜索提示 - 始终在最顶部实时显示，不受 loading 状态影响 */}
        {displayWebSearching && (
          <div className="inline-flex items-center py-1.5 px-3 mb-3 rounded-lg">
            <svg className="w-4 h-4 mr-2 text-[var(--color-accent)] animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-base text-gray-400">正在搜索...</span>
          </div>
        )}

        {!displayWebSearching && displayWebSearched && displaySearchResults && displaySearchResults.length > 0 && (
          <div className="inline-flex items-center py-1.5 px-3 mb-3 cursor-pointer hover:bg-gray-800/50 rounded-lg transition-colors group" onClick={() => setShowSearchResults(!showSearchResults)}>
            <span className="text-base text-gray-500">已搜索{displaySearchResults.length}个来源</span>
            <button className="ml-auto p-1 opacity-50 hover:opacity-100 transition-opacity">
              {showSearchResults ? (
                <ChevronUp className="w-4 h-4 ml-1" />
              ) : (
                <ChevronDown className="w-4 h-4 ml-1" />
              )}
            </button>
          </div>
        )}

        {/* 加载状态 - 搜索中时不显示 loading 动画 */}
        {isAiLoading && !displayWebSearching && <LoadingDots />}

        {/* 正常内容 */}
        {!isAiLoading && (
          <>

            {/* 可折叠的搜索结果 */}
            {displaySearchResults && displaySearchResults.length > 0 && !displayWebSearching && (
              <div className={`transition-all duration-300 ease-in-out overflow-hidden ${
                showSearchResults ? 'max-h-[500px] opacity-100 my-3' : 'max-h-0 opacity-0 my-0'
              }`}>
                <div className="p-3 bg-[var(--color-bg-primary)] border border-gray-700 rounded-xl overflow-hidden">
                  <div className="overflow-y-auto max-h-[400px] space-y-2">
                  {displaySearchResults.map((source, idx) => (
                    <div
                      key={idx}
                      onClick={() => openUrl(source.url)}
                      className="flex items-start gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors group cursor-pointer"
                    >
                      <img 
                        src={`https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(source.url)}`}
                        alt="icon"
                        className="w-4 h-4 mt-0.5 flex-shrink-0 rounded-sm"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-300 font-medium line-clamp-1 truncate">{source.name}</div>
                        <div className="text-xs text-gray-500 line-clamp-1 truncate">{source.siteName || source.url}</div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-xs text-blue-400">↗</span>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            )}

            {displayWebSearchFailed && (
              <div className="flex items-center gap-1.5 text-xs text-yellow-400 mb-3">
                <TriangleAlert className="w-3.5 h-3.5" />
                <span>联网搜索失败，以下回答未参考网络信息</span>
              </div>
            )}

            {/* 主要内容 */}
            {renderContent()}

            {displayArtifact && (
              <div
                onClick={() => onOpenArtifact?.(displayArtifact)}
                className="mt-3 p-3 bg-[var(--color-bg-primary)] border border-gray-700 rounded-xl cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-white font-medium text-sm">{displayArtifact.title}</div>
                  <div className="text-gray-400 text-xs">点击预览</div>
                </div>
              </div>
            )}
            {showSuggestions &&
              displaySuggestions &&
              displaySuggestions.length > 0 &&
              !displayIsStreaming && (
                <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-gray-700">
                  {displaySuggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSuggestionClick?.(suggestion)}
                      className="text-sm px-4 py-2 bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/25 text-gray-200 rounded-full transition-colors border border-[var(--color-accent)]/30 hover:border-[var(--color-accent)]/50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            {/* 消息操作按钮组 - 仅 AI 消息且非流式生成中 */}
            {!displayIsStreaming && !isStreaming && (
              <div className="mt-3 pt-3 border-t border-gray-700/30">
                {/* 多模型比较按钮 - 独立一行 */}
                {onCompareWithModel && (
                  <div className="mb-2">
                    <CompareButton
                      messageModelId={activeVersion?.model || message.model || ''}
                      usedModelIds={message.versions?.map(v => v.model) || (message.model ? [message.model] : [])}
                      onCompare={(modelId) => onCompareWithModel(message.id, modelId)}
                      disabled={isStreaming || displayIsStreaming || (message.versions?.some(v => v.isStreaming) ?? false)}
                    />
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {/* 复制 */}
                  <button
                    onClick={() => {
                      const text = typeof displayContent === 'string'
                        ? displayContent
                        : (displayContent as MessageContent[]).filter(p => p.type === 'text').map(p => p.text).join('\n');
                      navigator.clipboard.writeText(text);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                    title="复制"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                  {/* 保存为 Markdown */}
                  <button
                    onClick={async () => {
                      const content = typeof displayContent === 'string'
                        ? displayContent
                        : (displayContent as MessageContent[]).filter(p => p.type === 'text').map(p => p.text).join('\n');
                      const defaultName = content.slice(0, 20).replace(/[\\/:*?"<>|\n]/g, '_').trim() || 'message';
                      const fileName = `${defaultName}.md`;

                      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = fileName;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                    title="保存为 Markdown"
                  >
                    <FileDown className="w-4 h-4" />
                  </button>
                  {/* 重新生成 */}
                  <button
                    onClick={() => onRegenerate?.(message.id)}
                    className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                    title="重新生成"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  {/* 引用 */}
                  <button
                    onClick={() => onQuote?.(message)}
                    className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                    title="引用"
                  >
                    <MessageSquareQuote className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
