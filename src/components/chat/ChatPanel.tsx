import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  Palette,
  Languages,
  FileText,
  LayoutGrid,
  ArrowRight,
} from 'lucide-react';
import type { Conversation, Message } from '../../types';
import { CHAT_MODELS } from '../../config/models';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
interface ChatPanelProps {
  messages: Message[];
  isLoading: boolean;
  sendMessage: (
    content:
      | string
      | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
  ) => void;
  stopGeneration: () => void;
  conversationTitle?: string;
  conversation?: Conversation;
  onImportConversation?: (data: Partial<Conversation>) => void;
  onInputFocusChange?: (focused: boolean) => void;
}

export default function ChatPanel({
  messages,
  isLoading,
  sendMessage,
  stopGeneration,
  conversationTitle,
  conversation,
  onImportConversation,
  onInputFocusChange,
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
      <div className="hidden md:flex items-center justify-between gap-2 px-4 md:px-6 py-3 border-b border-gray-700 bg-gray-900/50">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="hidden md:block text-lg font-semibold truncate">AI 聊天</h2>
        </div>

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
            <Download className="w-5 h-5" />
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
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && (
          <div className="pt-2 md:pt-8 pl-4 md:pl-12">
            <h1 className="leading-tight">
              <span className="text-3xl md:text-5xl font-extrabold tracking-tight text-white sm:text-4xl md:text-6xl">
                你好
              </span>
              <span className="text-sm md:text-base text-white/90 font-normal ml-1.5 md:ml-2">
                ，今天我能帮你什么？
              </span>
            </h1>
            <ul className="mt-5 md:mt-8 space-y-3.5 md:space-y-4 ml-2">
              <li>
                <button
                  type="button"
                  onClick={() => sendMessage('帮我画一张图：')}
                  className="flex items-center gap-3 w-full text-[15px] md:text-base text-gray-100 hover:text-white py-1 px-2 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <Palette className="w-5 h-5 text-orange-400 shrink-0" />
                  <span>画图</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => sendMessage('帮我翻译：')}
                  className="flex items-center gap-3 w-full text-[15px] md:text-base text-gray-100 hover:text-white py-1 px-2 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <Languages className="w-5 h-5 text-[rgb(127,96,255)] shrink-0" />
                  <span>翻译</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => sendMessage('我想就一份 PDF 向你提问：')}
                  className="flex items-center gap-3 w-full text-[15px] md:text-base text-gray-100 hover:text-white py-1 px-2 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <FileText className="w-5 h-5 text-blue-400 shrink-0" />
                  <span>PDF 聊天</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {}}
                  className="flex items-center gap-3 w-full text-[15px] md:text-base text-gray-300 hover:text-white py-1 px-2 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <LayoutGrid className="w-5 h-5 text-gray-400 shrink-0" />
                  <span>新功能许愿</span>
                  <ArrowRight className="w-4 h-4 text-gray-500 ml-auto shrink-0" />
                </button>
              </li>
            </ul>
          </div>
        )}
        {messages.map((msg, index) => {
          const isLastAssistant =
            msg.role === 'assistant' && index === messages.length - 1;
          const currentModel = CHAT_MODELS.find(m => m.id === conversation?.selectedModel);
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              showSuggestions={isLastAssistant}
              onSuggestionClick={isLastAssistant ? (text) => sendMessage(text) : undefined}
              modelName={currentModel?.name}
              modelProvider={currentModel?.provider}
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
        onFocusChange={onInputFocusChange}
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
