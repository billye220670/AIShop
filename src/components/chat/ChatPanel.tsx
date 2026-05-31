import { useCallback, useEffect, useRef, useState } from 'react';

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
  onToggleHistory?: () => void;
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
  onToggleHistory,
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
            <div className="flex flex-col">
              <span className="text-3xl md:text-5xl font-extrabold tracking-tight text-white">
                你好，
              </span>
              <span className="text-2xl md:text-4xl font-bold text-white mt-2">
                今天我能帮你什么？
              </span>
            </div>
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
        onToggleHistory={onToggleHistory}
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
