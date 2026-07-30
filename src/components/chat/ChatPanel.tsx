import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import type { Conversation, Message, FileAttachment, ChatFeatureSettings } from '../../types';
import { CHAT_MODELS } from '../../config/models';
import { useArtifact, parseArtifactFromContent } from '../../hooks/useArtifact';
import { useStickToBottom } from '../../hooks/useStickToBottom';
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
  const lastUserMsgIdRef = useRef<string | null>(null);
  const artifactStreamStartedRef = useRef(false);
  // 吸底滚动：解除靠用户输入事件，恢复靠滚回底部，追内容靠 ResizeObserver + rAF 缓动
  const {
    containerRef: messagesContainerRef,
    contentRef: messagesContentRef,
    scrollToBottom,
    isFarFromBottom,
  } = useStickToBottom<HTMLDivElement>();
  const [isInputActive, setIsInputActive] = useState(false);
  // 距底部超过一屏且输入框未激活时，露出“回到底部”按钮
  const showScrollToBottom = isFarFromBottom && !isInputActive;
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

  // 用户发出新消息时，强制恢复吸底（哪怕之前手动上滑过）
  useEffect(() => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg && lastUserMsg.id !== lastUserMsgIdRef.current) {
      lastUserMsgIdRef.current = lastUserMsg.id;
      scrollToBottom('smooth');
    }
  }, [messages, scrollToBottom]);

  // 切换会话时直接跳到底部
  useEffect(() => {
    lastUserMsgIdRef.current = null;
    scrollToBottom('auto');
  }, [conversation?.id, scrollToBottom]);

  // 流式追内容由 useStickToBottom 内部的 ResizeObserver 驱动，此处无需再监听 messages



  // [已屏蔽] 拖拽JSON导入功能 - 改为在ChatInput中实现拖拽上传
  // const handleDragEnter = (e: React.DragEvent) => { ... };
  // const handleDragOver = (e: React.DragEvent) => { ... };
  // const handleDragLeave = (e: React.DragEvent) => { ... };
  // const handleDrop = (e: React.DragEvent) => { ... };

  return (
    <>
      {/* 主聊天区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Messages */}
        <div
          ref={messagesContainerRef}
          data-messages-container
          className="flex-1 overflow-y-auto px-4 py-4"
        >
         <div ref={messagesContentRef}>
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
         </div>
        </div>

        {/* 回到底部按钮 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => scrollToBottom('smooth-long')}
            aria-label="回到底部"
            aria-hidden={!showScrollToBottom}
            tabIndex={showScrollToBottom ? 0 : -1}
            className={`absolute bottom-1 left-1/2 -translate-x-1/2 z-20 w-9 h-9 rounded-full bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] border border-white/5 text-gray-300 shadow-lg flex items-center justify-center transition-all duration-200 ${
              showScrollToBottom
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none translate-y-1'
            }`}
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        {/* Input */}
        <ChatInput
          onActiveChange={setIsInputActive}
          onSend={sendMessage}
          isLoading={isLoading}
          onStop={stopGeneration}
          onNewConversation={onNewConversation}
          quotedMessage={quotedMessage}
          onRemoveQuote={() => setQuotedMessage(null)}
          featureSettings={featureSettings}
          onFeatureSettingsChange={onFeatureSettingsChange}
          webSearchEnabled={webSearchEnabled}
          onWebSearchEnabledChange={onWebSearchEnabledChange}
        />
      </div>

      {/* Artifact 全屏页面 - 覆盖整个应用（包括顶部和底部导航栏） */}
      <div
        className={`fixed inset-0 z-[100] bg-[var(--color-bg-base)] transition-transform duration-300 ease-out ${
          activeArtifact ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ pointerEvents: activeArtifact ? 'auto' : 'none' }}
      >
        {activeArtifact && (
          <ArtifactPanel artifact={activeArtifact} onClose={closeArtifact} isGenerating={isArtifactGenerating} autoPreviewSignal={autoPreviewSignal} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
        )}
      </div>
    </>
  );
}
