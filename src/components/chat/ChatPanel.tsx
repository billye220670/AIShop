import { useCallback, useEffect, useRef } from 'react';

import type { Conversation, Message, Model, FileAttachment } from '../../types';
import { CHAT_MODELS } from '../../config/models';
import { useArtifact, parseArtifactFromContent } from '../../hooks/useArtifact';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import ArtifactPanel from '../artifact/ArtifactPanel';

interface ChatPanelProps {
  messages: Message[];
  isLoading: boolean;
  sendMessage: (
    content:
      | string
      | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>,
    attachments?: FileAttachment[]
  ) => void;
  stopGeneration: () => void;
  conversationTitle?: string;
  conversation?: Conversation;
  onInputFocusChange?: (focused: boolean) => void;
  onToggleHistory?: () => void;
  onNewConversation?: () => void;
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  models?: Model[];
  streamingArtifact?: { title: string; code: string } | null;
}

export default function ChatPanel({
  messages,
  isLoading,
  sendMessage,
  stopGeneration,
  conversation,
  onInputFocusChange,
  onToggleHistory,
  onNewConversation,
  selectedModel,
  onModelChange,
  models,
  streamingArtifact,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastUserMsgIdRef = useRef<string | null>(null);
  const artifactStreamStartedRef = useRef(false);
  const { activeArtifact, isArtifactGenerating, openArtifact, closeArtifact, startStreamingArtifact, updateStreamingCode, finishStreamingArtifact } = useArtifact();
  // [已屏蔽] 拖拽JSON导入功能 - 改为在ChatInput中实现拖拽上传
  // const [isDragOver, setIsDragOver] = useState(false);
  // const dragCounterRef = useRef(0);

  // 监听 streamingArtifact 状态变化，控制 artifact 面板
  useEffect(() => {
    if (streamingArtifact) {
      if (!artifactStreamStartedRef.current) {
        // 第一次检测到 - 打开面板
        artifactStreamStartedRef.current = true;
        startStreamingArtifact({
          id: 'streaming_' + Date.now(),
          type: 'html',
          title: streamingArtifact.title,
          code: streamingArtifact.code,
          createdAt: Date.now(),
        });
      } else {
        // 后续更新代码
        updateStreamingCode(streamingArtifact.code);
      }
    } else if (artifactStreamStartedRef.current) {
      // streamingArtifact 变为 null → 流式结束
      artifactStreamStartedRef.current = false;
      // 从最后一条消息中获取完整 artifact
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.artifact) {
        finishStreamingArtifact(lastMsg.artifact);
      } else {
        // 尝试从消息的原始内容解析
        const parsed = typeof lastMsg?.content === 'string' ? parseArtifactFromContent(lastMsg.content) : null;
        if (parsed) {
          finishStreamingArtifact(parsed);
        } else if (activeArtifact) {
          // 保持当前 artifact 但标记为完成
          finishStreamingArtifact(activeArtifact);
        }
      }
    }
  }, [streamingArtifact]);

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

  // [已屏蔽] 拖拽JSON导入功能 - 改为在ChatInput中实现拖拽上传
  // const handleDragEnter = (e: React.DragEvent) => { ... };
  // const handleDragOver = (e: React.DragEvent) => { ... };
  // const handleDragLeave = (e: React.DragEvent) => { ... };
  // const handleDrop = (e: React.DragEvent) => { ... };

  return (
    <div
      className="flex-1 flex overflow-hidden relative"
    >
      {/* 左侧聊天区 */}
      <div className={`flex flex-col transition-all duration-300 overflow-hidden ${activeArtifact ? 'w-full md:w-[45%]' : 'w-full'}`}>
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
                onOpenArtifact={openArtifact}
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
      </div>

      {/* 右侧 Artifact 面板 - 桌面端 */}
      {activeArtifact && (
        <div className="hidden md:block w-[55%] border-l border-gray-700/50 transition-all duration-300">
          <ArtifactPanel artifact={activeArtifact} onClose={closeArtifact} isGenerating={isArtifactGenerating} />
        </div>
      )}

      {/* 移动端 Artifact 面板 - 全屏覆盖 */}
      {activeArtifact && (
        <div className="fixed inset-0 z-50 md:hidden bg-[#0d0a1a]">
          <ArtifactPanel artifact={activeArtifact} onClose={closeArtifact} isGenerating={isArtifactGenerating} />
        </div>
      )}
    </div>
  );
}
