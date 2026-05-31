import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Palette,
  Languages,
  FileText,
  LayoutGrid,
  ArrowRight,
  Search,
} from 'lucide-react';
import PinyinMatch from 'pinyin-match';
import type { Conversation, Message, Model } from '../../types';
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
  conversations?: Conversation[];
  activeConversationId?: string;
  onSwitchConversation?: (id: string) => void;
  onNewConversation?: () => void;
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  models?: Model[];
}

export default function ChatPanel({
  messages,
  isLoading,
  sendMessage,
  stopGeneration,
  conversation,
  onImportConversation,
  onInputFocusChange,
  conversations,
  activeConversationId,
  onSwitchConversation,
  onNewConversation,
  selectedModel,
  onModelChange,
  models,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastUserMsgIdRef = useRef<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // History panel state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const historyPanelRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
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

  // 点击外部关闭历史面板
  useEffect(() => {
    if (!historyOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (historyPanelRef.current && !historyPanelRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [historyOpen]);

  // Filtered conversations for history panel
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    const keyword = historySearch.trim();
    if (!keyword) return conversations;
    return conversations.filter(conv => {
      if (conv.title.toLowerCase().includes(keyword.toLowerCase())) return true;
      const match = PinyinMatch.match(conv.title, keyword);
      return match !== false;
    });
  }, [conversations, historySearch]);

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
    if (!jsonFile) return;

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

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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

      {/* Desktop history popup panel */}
      {historyOpen && (
        <div
          ref={historyPanelRef}
          className="hidden md:block absolute bottom-[140px] right-4 w-[320px] max-h-[400px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
        >
          <div className="flex flex-col h-full max-h-[400px]">
            {/* Search */}
            <div className="p-3 border-b border-gray-700/50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="搜索会话..."
                  className="w-full bg-gray-800 text-white text-sm rounded-lg pl-9 pr-3 py-2 border border-transparent focus:border-[rgb(127,96,255)] focus:outline-none placeholder-gray-500"
                />
              </div>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto p-2">
              {filteredConversations.length === 0 && historySearch && (
                <div className="text-center text-gray-500 text-sm py-4">无匹配结果</div>
              )}
              {filteredConversations.map(conv => {
                const isActive = conv.id === activeConversationId;
                return (
                  <button
                    key={conv.id}
                    onClick={() => {
                      onSwitchConversation?.(conv.id);
                      setHistoryOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors truncate text-sm ${
                      isActive
                        ? 'bg-[rgb(127,96,255)]/20 text-[rgb(127,96,255)]'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    {conv.title}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        isLoading={isLoading}
        onStop={stopGeneration}
        onFocusChange={onInputFocusChange}
        onToggleHistory={() => setHistoryOpen(v => !v)}
        onNewConversation={onNewConversation}
        models={models}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
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
