import { useCallback, useEffect, useRef, useState } from 'react';

import type { Conversation, Message, FileAttachment, ChatFeatureSettings } from '../../types';
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
  onToggleHistory?: () => void;
  onNewConversation?: () => void;
  streamingArtifact?: { title: string; code: string } | null;
  regenerateMessage?: (messageId: string) => void;
  featureSettings: ChatFeatureSettings;
  onFeatureSettingsChange: (settings: ChatFeatureSettings) => void;
  compareWithModel?: (messageId: string, modelId: string) => void;
  switchVersion?: (messageId: string, index: number) => void;
  webSearchEnabled?: boolean;
  onWebSearchEnabledChange?: (enabled: boolean) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (thumbnail?: string) => void;
}

export default function ChatPanel({
  messages,
  isLoading,
  sendMessage,
  stopGeneration,
  conversation,
  onToggleHistory,
  onNewConversation,
  streamingArtifact,
  regenerateMessage,
  featureSettings,
  onFeatureSettingsChange,
  compareWithModel,
  switchVersion,
  webSearchEnabled = false,
  onWebSearchEnabledChange,
  isFavorite = false,
  onToggleFavorite,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastUserMsgIdRef = useRef<string | null>(null);
  const artifactStreamStartedRef = useRef(false);
  const { activeArtifact, isArtifactGenerating, openArtifact, closeArtifact, startStreamingArtifact, updateStreamingCode, finishStreamingArtifact } = useArtifact();
  const [autoPreviewSignal, setAutoPreviewSignal] = useState(0);
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  // 会话切换时关闭 Artifact 面板
  useEffect(() => {
    closeArtifact();
  }, [conversation?.id]);

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
      // 流式结束，发送信号让面板自动切换到预览模式
      setAutoPreviewSignal(prev => prev + 1);
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
      <div className={`flex flex-col transition-all duration-300 overflow-hidden ${activeArtifact ? 'w-[45%]' : 'w-full'}`}>
        {/* Messages */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-4"
        >
          {messages.length === 0 && (
            <div className="pt-3 pl-1">
              <div className="flex flex-col">
                <span className="text-3xl font-extrabold tracking-tight text-white">
                  你好，
                </span>
                <span className="text-2xl font-bold text-white mt-1">
                  今天我能帮你什么？
                </span>
              </div>
            </div>
          )}
          {messages.map((msg, index) => {
            const isLastAssistant =
              msg.role === 'assistant' && index === messages.length - 1;
            // 版本感知的模型 ID 获取
            const activeVersion = msg.versions?.[msg.activeVersionIndex ?? 0];
            const modelId = activeVersion
              ? activeVersion.model
              : (msg.role === 'assistant' && msg.model)
                ? msg.model
                : conversation?.selectedModel;
            const currentModel = CHAT_MODELS.find(m => m.id === modelId);
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                showSuggestions={isLastAssistant}
                onSuggestionClick={isLastAssistant ? (text) => sendMessage(text) : undefined}
                modelName={currentModel?.name}
                modelProvider={currentModel?.provider}
                onOpenArtifact={openArtifact}
                onRegenerate={msg.role === 'assistant' ? regenerateMessage : undefined}
                onQuote={msg.role === 'assistant' ? (m) => setQuotedMessage(m) : undefined}
                isStreaming={isLoading}
                onCompareWithModel={msg.role === 'assistant' ? compareWithModel : undefined}
                onSwitchVersion={msg.role === 'assistant' ? switchVersion : undefined}
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
          onToggleHistory={onToggleHistory}
          onNewConversation={onNewConversation}
          quotedMessage={quotedMessage}
          onRemoveQuote={() => setQuotedMessage(null)}
          featureSettings={featureSettings}
          onFeatureSettingsChange={onFeatureSettingsChange}
          webSearchEnabled={webSearchEnabled}
          onWebSearchEnabledChange={onWebSearchEnabledChange}
        />
      </div>

      {/* Artifact 面板 - 桌面端 */}
      {activeArtifact && (
        <div className="w-[55%] border-l border-gray-700/50 transition-all duration-300">
          <ArtifactPanel artifact={activeArtifact} onClose={closeArtifact} isGenerating={isArtifactGenerating} autoPreviewSignal={autoPreviewSignal} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
        </div>
      )}
    </div>
  );
}
