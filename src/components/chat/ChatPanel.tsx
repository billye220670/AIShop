import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, Message } from '../../types';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';

interface ChatPanelProps {
  messages: Message[];
  isLoading: boolean;
  selectedModel: string;
  setSelectedModel: (id: string) => void;
  sendMessage: (
    content:
      | string
      | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
  ) => void;
  stopGeneration: () => void;
  error: string | null;
  conversationTitle?: string;
  webSearchEnabled: boolean;
  setWebSearchEnabled: (enabled: boolean) => void;
  conversation?: Conversation;
  onImportConversation?: (data: Partial<Conversation>) => void;
  onMobileMenuClick?: () => void;
  onNewConversation?: () => void;
}

export default function ChatPanel({
  messages,
  isLoading,
  selectedModel,
  setSelectedModel,
  sendMessage,
  stopGeneration,
  conversationTitle,
  webSearchEnabled,
  setWebSearchEnabled,
  conversation,
  onImportConversation,
  onMobileMenuClick,
  onNewConversation,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastUserMsgIdRef = useRef<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    // 距离底部小于 100px 认为在底部附近
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    shouldAutoScrollRef.current = isNearBottom;
  }, []);

  // 当用户发送新消息时，强制恢复自动滚动
  useEffect(() => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg && lastUserMsg.id !== lastUserMsgIdRef.current) {
      lastUserMsgIdRef.current = lastUserMsg.id;
      shouldAutoScrollRef.current = true;
    }
  }, [messages]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // 点击外部关闭导出菜单
  useEffect(() => {
    if (!showExportMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  const handleExportMd = () => {
    if (messages.length === 0) return;
    setShowExportMenu(false);

    const title = conversationTitle?.trim() || '对话';
    let md = `# ${title}\n\n`;
    md += `> 导出时间: ${new Date().toLocaleString()}\n\n---\n\n`;

    messages.forEach(msg => {
      const role = msg.role === 'user' ? '👤 用户' : '🤖 AI';
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map(part => {
                if (part.type === 'text') return part.text || '';
                if (part.type === 'image_url') return `![image](${part.image_url?.url || ''})`;
                return '';
              })
              .filter(Boolean)
              .join('\n\n') || '[多媒体消息]';
      md += `## ${role}\n\n${content}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (messages.length === 0 || !conversation) return;
    setShowExportMenu(false);

    const title = conversationTitle?.trim() || '对话';

    // 清理消息中的 isStreaming 字段
    const sanitizedMessages: Message[] = conversation.messages.map(m => ({
      ...m,
      isStreaming: false,
    }));

    const exportData = {
      version: 1 as const,
      app: 'AIShop' as const,
      exportedAt: Date.now(),
      conversation: {
        id: conversation.id,
        title: conversation.title,
        messages: sanitizedMessages,
        selectedModel: conversation.selectedModel,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        isRenamed: conversation.isRenamed,
      },
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}_${new Date().toISOString().slice(0, 10)}.aishop.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 拖拽导入
  const handleDragEnter = (e: React.DragEvent) => {
    if (!onImportConversation) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!onImportConversation) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!onImportConversation) return;
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!onImportConversation) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const jsonFile = files.find(f => f.name.endsWith('.aishop.json'));
    if (!jsonFile) return; // 非目标文件，静默忽略

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.app !== 'AIShop' || data.version !== 1 || !data.conversation) {
          alert('不支持的文件格式');
          return;
        }
        onImportConversation(data.conversation as Partial<Conversation>);
      } catch {
        alert('文件解析失败');
      }
    };
    reader.onerror = () => alert('文件读取失败');
    reader.readAsText(jsonFile);
  };

  const canExport = messages.length > 0;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-3 border-b border-gray-700 bg-gray-900/50">
        <div className="flex items-center gap-2 min-w-0">
          {onMobileMenuClick && (
            <button
              onClick={onMobileMenuClick}
              className="md:hidden p-1.5 -ml-1 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg shrink-0"
              aria-label="打开会话历史"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          )}
          <h2 className="text-lg font-semibold truncate">AI 聊天</h2>
        </div>
        {/* 移动端：右上角显示“新建会话”按钮；桌面端：保留导出菜单 */}
        {onNewConversation && (
          <button
            onClick={onNewConversation}
            className="md:hidden p-1.5 -mr-1 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg shrink-0"
            aria-label="新建会话"
            title="新建会话"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        )}
        <div className="relative hidden md:block" ref={exportMenuRef}>
          <button
            onClick={() => canExport && setShowExportMenu(v => !v)}
            disabled={!canExport}
            className="text-sm text-gray-400 hover:text-white px-3 py-1 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
            title={canExport ? '导出会话' : '当前会话为空'}
            aria-label="导出会话"
            aria-haspopup="menu"
            aria-expanded={showExportMenu}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>
          {showExportMenu && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[160px]"
            >
              <button
                role="menuitem"
                onClick={handleExportMd}
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
              >
                导出为 Markdown
              </button>
              <button
                role="menuitem"
                onClick={handleExportJson}
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
              >
                导出为 JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-5xl mb-4">💬</div>
            <p className="text-lg">开始和 AI 对话吧</p>
            <p className="text-sm mt-2">支持多模型切换、图片上传</p>
            <p className="text-xs mt-4 text-gray-600">
              提示：可将 .aishop.json 文件拖入此处导入历史会话
            </p>
          </div>
        )}
        {messages.map((msg, index) => {
          const isLastAssistant =
            msg.role === 'assistant' && index === messages.length - 1;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              showSuggestions={isLastAssistant}
              onSuggestionClick={isLastAssistant ? (text) => sendMessage(text) : undefined}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        isLoading={isLoading}
        onStop={stopGeneration}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        webSearchEnabled={webSearchEnabled}
        onWebSearchToggle={setWebSearchEnabled}
      />

      {/* 拖拽遮罩 */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-600/20 border-2 border-dashed border-blue-400 rounded-lg flex items-center justify-center z-40 pointer-events-none">
          <div className="text-blue-200 text-lg font-medium px-6 py-3 bg-gray-900/80 rounded-lg shadow-lg">
            拖放 .aishop.json 文件导入会话
          </div>
        </div>
      )}
    </div>
  );
}
