import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Palette,
  Languages,
  FileText,
  LayoutGrid,
  ArrowRight,
  Search,
  X,
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

  // 时间分组逻辑
  const groupedConversations = useMemo(() => {
    if (!filteredConversations.length) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const groups: { label: string; items: typeof filteredConversations }[] = [
      { label: '今天', items: [] },
      { label: '昨天', items: [] },
      { label: '本月', items: [] },
      { label: '更早', items: [] },
    ];

    for (const conv of filteredConversations) {
      const t = conv.updatedAt;
      if (t >= todayStart) groups[0].items.push(conv);
      else if (t >= yesterdayStart) groups[1].items.push(conv);
      else if (t >= monthStart) groups[2].items.push(conv);
      else groups[3].items.push(conv);
    }

    return groups.filter(g => g.items.length > 0);
  }, [filteredConversations]);

  // 获取会话最后消息预览
  const getLastMessagePreview = (conv: Conversation): string => {
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (!lastMsg) return '';
    if (typeof lastMsg.content === 'string') return lastMsg.content;
    const textPart = lastMsg.content.find(p => p.type === 'text');
    return textPart?.text || '[图片]';
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

      {/* Desktop history sliding panel */}
      <div
        ref={historyPanelRef}
        className={`hidden md:flex flex-col absolute right-0 top-0 bottom-0 w-[380px] z-50 bg-[#1a1a2e] border-l border-gray-700/50 shadow-2xl transition-transform duration-300 ease-in-out ${
          historyOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold text-white">聊天历史</h2>
          <button
            onClick={() => setHistoryOpen(false)}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-gray-400 hover:text-white" />
          </button>
        </div>

        {/* "所有" tab */}
        <div className="px-5 pb-3">
          <span className="text-sm text-white border-b-2 border-[rgb(127,96,255)] pb-1">所有</span>
        </div>

        {/* 搜索框 */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
              placeholder="搜索"
              className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[rgb(127,96,255)]"
            />
          </div>
        </div>

        {/* 会话列表（按时间分组，可滚动） */}
        <div className="flex-1 overflow-y-auto px-3">
          {filteredConversations.length === 0 && historySearch && (
            <div className="text-center text-gray-500 text-sm py-8">无匹配结果</div>
          )}
          {groupedConversations.map(group => (
            <div key={group.label}>
              <div className="px-2 pt-3 pb-1.5 text-xs text-gray-500 font-medium">{group.label}</div>
              {group.items.map(conv => {
                const isActive = conv.id === activeConversationId;
                return (
                  <button
                    key={conv.id}
                    onClick={() => {
                      onSwitchConversation?.(conv.id);
                      setHistoryOpen(false);
                    }}
                    className={`w-full text-left px-3 py-3 rounded-lg mb-1 transition-colors ${
                      isActive
                        ? 'bg-[rgb(127,96,255)]/20'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div className={`text-sm font-medium truncate ${
                      isActive ? 'text-[rgb(127,96,255)]' : 'text-white'
                    }`}>
                      {conv.title}
                    </div>
                    <div className="text-xs text-gray-400 mt-1 line-clamp-2">
                      {getLastMessagePreview(conv)}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 遮罩层 - 点击关闭面板 */}
      {historyOpen && (
        <div
          className="hidden md:block absolute inset-0 z-40"
          onClick={() => setHistoryOpen(false)}
        />
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
