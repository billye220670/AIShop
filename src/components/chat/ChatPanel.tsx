import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, ChevronRight, X } from 'lucide-react';

import type { Conversation, Message, FileAttachment, ChatFeatureSettings, Model } from '../../types';
import { CHAT_MODELS } from '../../config/models';
import { useArtifact, parseArtifactFromContent } from '../../hooks/useArtifact';
import { useStickToBottom } from '../../hooks/useStickToBottom';
import { useFoldGesture } from '../../hooks/useFoldGesture';
import { getPlainText } from '../../utils/messageText';
import { haptic } from '../../utils/haptics';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import ArtifactPanel from '../artifact/ArtifactPanel';
import CompactionMarker from './CompactionMarker';
import ContextSummarySheet from './ContextSummarySheet';
import type { ContextSegment, ContextSummary } from '../../types';
import type { RoleData } from '../../db';
import type { UsageTotals } from '../../utils/tokenEstimate';

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
  /** 历史记录面板开关（桌面形态透传给 ChatInput 工具栏） */
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
  // 上下文压缩（水位指示已移到顶栏，这里只保留区间标记与摘要面板所需）
  segments?: ContextSegment[];
  onUpdateSegment?: (segmentId: string, summary: ContextSummary) => void;
  /** 外部请求打开某个 segment 的摘要面板（例如压缩完成 toast 的"查看"按钮） */
  openSegmentIdRequest?: string | null;
  onOpenSegmentIdRequestHandled?: () => void;
  // 模型与角色选择（桌面形态透传给 ChatInput 工具栏）
  models?: Model[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  roles?: RoleData[];
  selectedRoleId?: string;
  onRoleSelect?: (roleId: string) => void;
  onRolesChanged?: () => void;
  // 上下文占用环（桌面形态透传给 ChatInput 工具栏）
  realUsage?: UsageTotals;
  contextLimit?: number;
  isCompacting?: boolean;
  isAwaitingUsage?: boolean;
  onCompactActive?: () => void;
  onOpenSegment?: (segmentId: string) => void;
  onDeleteSegment?: (segmentId: string) => void;
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
  segments,
  onUpdateSegment,
  openSegmentIdRequest,
  onOpenSegmentIdRequestHandled,
  models,
  selectedModel,
  onModelChange,
  roles,
  selectedRoleId,
  onRoleSelect,
  onRolesChanged,
  realUsage,
  contextLimit,
  isCompacting,
  isAwaitingUsage,
  onCompactActive,
  onOpenSegment,
  onDeleteSegment,
}: ChatPanelProps) {
  const [openSegmentId, setOpenSegmentId] = useState<string | null>(null);

  // --- 折叠浏览模式 ---
  const [isCollapsed, setIsCollapsed] = useState(false);
  /** 'collapsing' = 正在播塌陷动画，还没换成折叠态 DOM */
  const [foldPhase, setFoldPhase] = useState<'idle' | 'collapsing'>('idle');
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 折叠 / 展开会让内容高度成倍变化，滚动位置必须自己接管。
   * 浏览器对越界的 scrollTop 只做钳位（表现为莫名跳到末尾），而在惯性滚动
   * 进行中连钳位都可能滞后若干帧，停在内容之外就是一整屏空白。
   * 所以切换前先记下锚点消息 + 它当时在视口里的位置，DOM 换完再按锚点落位。
   */
  const foldAnchorRef = useRef<{ id: string; offset: number } | null>(null);
  /** 展开后要平滑滚过去的目标消息（先在原地落位，再滚动过去，避免瞬移） */
  const pendingSmoothLocateRef = useRef<string | null>(null);
  const foldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 滚动冻结循环的 rAF id */
  const scrollPinRef = useRef<number | null>(null);

  /** 塌陷动画时长，和 index.css 里的 fold-collapse-out 保持一致 */
  const FOLD_ANIM_MS = 420;

  const flashMessage = (messageId: string) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashMessageId(messageId);
    flashTimerRef.current = setTimeout(() => setFlashMessageId(null), 1200);
  };

  const locateMessage = (messageId: string) => {
    messageRefs.current.get(messageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashMessage(messageId);
  };

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (foldTimerRef.current) clearTimeout(foldTimerRef.current);
    if (scrollPinRef.current != null) cancelAnimationFrame(scrollPinRef.current);
  }, []);

  // --- 对话内搜索 ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const matches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as { messageId: string; occurrence: number }[];
    const result: { messageId: string; occurrence: number }[] = [];
    for (const msg of messages) {
      const activeVersion = msg.versions?.[msg.activeVersionIndex ?? 0];
      const text = getPlainText(activeVersion ? activeVersion.content : msg.content).toLowerCase();
      let idx = 0;
      let occurrence = 0;
      while (true) {
        const found = text.indexOf(q, idx);
        if (found === -1) break;
        result.push({ messageId: msg.id, occurrence });
        occurrence++;
        idx = found + q.length;
      }
    }
    return result;
  }, [messages, searchQuery]);

  // 关键词变化时把当前项复位到第一个命中
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  const goToMatch = (index: number) => {
    if (matches.length === 0) return;
    const next = ((index % matches.length) + matches.length) % matches.length;
    setCurrentMatchIndex(next);
    // 等高亮 DOM 更新后，直接滚到高亮片段本身（而不是整条消息），并贴到顶部
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const activeMark = messagesContainerRef.current?.querySelector('.search-highlight-active');
        if (activeMark) {
          activeMark.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          locateMessage(matches[next].messageId);
        }
      });
    });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setCurrentMatchIndex(0);
  };

  // Esc 关闭搜索
  useEffect(() => {
    if (!searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  const activeMatch = matches[currentMatchIndex];

  // 外部（toast 的"查看"按钮）请求打开某个 segment
  useEffect(() => {
    if (openSegmentIdRequest) {
      setOpenSegmentId(openSegmentIdRequest);
      onOpenSegmentIdRequestHandled?.();
    }
  }, [openSegmentIdRequest, onOpenSegmentIdRequestHandled]);
  const openSegment = segments?.find(s => s.id === openSegmentId) || null;
  // segment 区间的最后一条消息 id → segment，用于在正确位置插入标记
  const segmentByLastMessage = new Map(
    (segments || []).map(s => [s.toMessageId, s])
  );
  const lastUserMsgIdRef = useRef<string | null>(null);
  const artifactStreamStartedRef = useRef(false);
  // 吸底滚动：解除靠用户输入事件，恢复靠滚回底部，追内容靠 ResizeObserver + rAF 缓动
  const {
    containerRef: messagesContainerRef,
    contentRef: messagesContentRef,
    scrollToBottom,
    isFarFromBottom,
  } = useStickToBottom<HTMLDivElement>({ enabled: !isCollapsed && foldPhase === 'idle' });

  // 连续快速甩动 → 播塌陷动画 → 进入折叠浏览模式
  useFoldGesture({
    containerRef: messagesContainerRef,
    onFold: () => startCollapse(),
    enabled: !isCollapsed && foldPhase === 'idle',
  });

  /**
   * 把滚动位置钉在 getTop() 上若干毫秒。
   * 甩动手势必然带惯性，惯性帧由合成器线程驱动，会持续覆盖我们写进去的
   * scrollTop（单次赋值根本压不住）——所以要逐帧压回来。
   */
  const pinScroll = (getTop: () => number, durationMs: number) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (scrollPinRef.current != null) cancelAnimationFrame(scrollPinRef.current);
    let framesLeft = Math.ceil(durationMs / 16);
    const step = () => {
      const top = getTop();
      if (Math.abs(el.scrollTop - top) > 0.5) el.scrollTop = top;
      scrollPinRef.current = --framesLeft > 0 ? requestAnimationFrame(step) : null;
    };
    scrollPinRef.current = requestAnimationFrame(step);
  };

  const stopPinScroll = () => {
    if (scrollPinRef.current != null) cancelAnimationFrame(scrollPinRef.current);
    scrollPinRef.current = null;
  };

  /**
   * 选定折叠后的落位锚点：离视口顶部最近的那条**用户消息**。
   * 用户气泡在折叠态不会被收起，是唯一高度不变的参照物；AI 回复折叠前后
   * 高度差几十倍，拿它当锚点算出来的位置没有意义。
   */
  function captureFoldAnchor() {
    const el = messagesContainerRef.current;
    if (!el) {
      foldAnchorRef.current = null;
      return;
    }
    const containerTop = el.getBoundingClientRect().top;
    let best: { id: string; offset: number; dist: number } | null = null;
    let firstVisible: { id: string; offset: number } | null = null;
    for (const msg of messages) {
      const node = messageRefs.current.get(msg.id);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const offset = rect.top - containerTop;
      if (!firstVisible && rect.bottom - containerTop > 1) firstVisible = { id: msg.id, offset };
      if (msg.role !== 'user') continue;
      const dist = Math.abs(offset);
      if (!best || dist < best.dist) {
        // 气泡在视口上方时不保留负偏移（那等于要求滚过它很远，折叠后内容
        // 根本没那么长），改成顶到视口顶部
        best = { id: msg.id, offset: Math.max(0, offset), dist };
      }
    }
    foldAnchorRef.current = best
      ? { id: best.id, offset: best.offset }
      : firstVisible;
  }

  /** 触发折叠：先冻住滚动播 200ms 塌陷动画，再换成折叠态 DOM */
  const startCollapse = () => {
    if (isCollapsed || foldPhase === 'collapsing') return;
    const el = messagesContainerRef.current;
    if (!el) return;
    captureFoldAnchor();
    haptic();
    // 动画期间只有 transform / opacity 在变，布局不动，所以钉死当前 scrollTop
    // 就够了；顺带把惯性掐断，用户能安静地看完塌陷过程
    const frozenTop = el.scrollTop;
    pinScroll(() => frozenTop, FOLD_ANIM_MS);
    setFoldPhase('collapsing');
    if (foldTimerRef.current) clearTimeout(foldTimerRef.current);
    foldTimerRef.current = setTimeout(() => {
      setFoldPhase('idle');
      setIsCollapsed(true);
    }, FOLD_ANIM_MS);
  };

  /** 退出折叠：先在原地展开（点中那条不动），再平滑滚到它居中的位置 */
  const exitCollapsed = (targetId: string) => {
    const el = messagesContainerRef.current;
    const node = messageRefs.current.get(targetId);
    if (el && node) {
      // 锚点就是被点中的这条，保持它当前的屏幕位置 → 展开瞬间不会瞬移
      foldAnchorRef.current = {
        id: targetId,
        offset: node.getBoundingClientRect().top - el.getBoundingClientRect().top,
      };
    } else {
      captureFoldAnchor();
    }
    pendingSmoothLocateRef.current = targetId;
    setIsCollapsed(false);
  };

  // 折叠状态切换后：DOM 已按新高度布局，但滚动位置还停在旧内容的坐标上，
  // 必须在浏览器绘制前（useLayoutEffect）按锚点重新落位，否则会闪一帧空白。
  const didMountFoldRef = useRef(false);
  useLayoutEffect(() => {
    if (!didMountFoldRef.current) {
      didMountFoldRef.current = true;
      return;
    }
    const el = messagesContainerRef.current;
    if (!el) return;

    /** 按锚点算出应有的 scrollTop（已钳位到合法区间） */
    const anchorTop = () => {
      const anchor = foldAnchorRef.current;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (!anchor) return Math.min(el.scrollTop, maxTop);
      const node = messageRefs.current.get(anchor.id);
      if (!node) return Math.min(el.scrollTop, maxTop);
      const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top;
      return Math.min(Math.max(el.scrollTop + delta - anchor.offset, 0), maxTop);
    };

    stopPinScroll();
    el.scrollTop = anchorTop();

    if (isCollapsed) {
      // 折叠：钉住锚点直到惯性彻底停下
      pinScroll(anchorTop, 260);
      return;
    }

    // 展开：先原地落位（上面已做），等 markdown / 公式量完最终高度后，
    // 再从当前位置平滑滚到目标消息 —— 用户能看到"滚过去"的过程
    const targetId = pendingSmoothLocateRef.current;
    pendingSmoothLocateRef.current = null;
    if (!targetId) return;

    let rafId = requestAnimationFrame(() => {
      el.scrollTop = anchorTop();
      rafId = requestAnimationFrame(() => {
        el.scrollTop = anchorTop();
        foldAnchorRef.current = null;
        const node = messageRefs.current.get(targetId);
        if (!node) return;
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        const rect = node.getBoundingClientRect();
        // 目标居中；比一屏还高的长回复则对齐到顶部偏下一点
        const pad = Math.max(24, (el.clientHeight - rect.height) / 2);
        const top = el.scrollTop + (rect.top - el.getBoundingClientRect().top) - pad;
        el.scrollTo({ top: Math.min(Math.max(top, 0), maxTop), behavior: 'smooth' });
        flashMessage(targetId);
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [isCollapsed]);
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

  // 切换会话时直接跳到底部，并退出查找
  useEffect(() => {
    lastUserMsgIdRef.current = null;
    scrollToBottom('auto');
    closeSearch();
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
      <div className="relative flex-1 flex flex-col overflow-hidden">
        {/* 对话内搜索栏：紧贴顶栏下方，背景与顶栏一致 */}
        {searchOpen && (
          <div className="px-4 py-2 flex items-center gap-2 shrink-0 bg-[var(--color-bg-base)]">
            <button
              type="button"
              onClick={closeSearch}
              aria-label="关闭搜索"
              className="w-9 h-9 flex items-center justify-center rounded-full text-gray-300 hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') goToMatch(currentMatchIndex + 1); }}
                placeholder="搜索对话内容"
                className="w-full h-10 bg-[var(--color-bg-primary)] rounded-full pl-9 pr-16 text-sm text-white placeholder-gray-500 focus:outline-none"
              />
              {searchQuery.trim() && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 whitespace-nowrap">
                  {matches.length > 0 ? `${currentMatchIndex + 1}/${matches.length}` : '0/0'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => goToMatch(currentMatchIndex + 1)}
              disabled={matches.length === 0}
              aria-label="下一个"
              className="w-9 h-9 flex items-center justify-center rounded-full text-gray-300 hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          data-messages-container
          className="flex-1 overflow-y-auto px-4 py-4"
        >
         <div ref={messagesContentRef} className={foldPhase === 'collapsing' ? 'chat-folding' : undefined}>
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
            // 原文照常渲染；压缩区间末尾追加一条标记，说明这段发给模型时用的是摘要
            const endingSegment = segmentByLastMessage.get(msg.id);
            const isActiveMatchHere = activeMatch?.messageId === msg.id;
            return (
              <div
                key={msg.id}
                data-msg-role={msg.role}
                ref={el => {
                  if (el) messageRefs.current.set(msg.id, el);
                  else messageRefs.current.delete(msg.id);
                }}
                className={flashMessageId === msg.id ? 'message-locate-flash' : undefined}
                onClick={isCollapsed ? () => exitCollapsed(msg.id) : undefined}
                onKeyDown={
                  isCollapsed
                    ? e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          exitCollapsed(msg.id);
                        }
                      }
                    : undefined
                }
              >
              <MessageBubble
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
                collapsed={isCollapsed}
                onOpenSearch={() => setSearchOpen(true)}
                onFold={!isCollapsed && foldPhase === 'idle' ? startCollapse : undefined}
                searchQuery={searchOpen ? searchQuery : undefined}
                activeMatchOccurrence={isActiveMatchHere ? activeMatch.occurrence : undefined}
              />
              {endingSegment && !isCollapsed && (
                <CompactionMarker
                  segment={endingSegment}
                  onOpen={() => setOpenSegmentId(endingSegment.id)}
                />
              )}
              </div>
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

        {/* 上下文占用已移到顶栏的环状按钮（见 TopNavBar / ContextRing） */}

        {/* Input */}
        <ChatInput
          onActiveChange={setIsInputActive}
          onSend={(...args) => { if (searchOpen) closeSearch(); return sendMessage(...args); }}
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
          models={models}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          roles={roles}
          selectedRoleId={selectedRoleId}
          onRoleSelect={onRoleSelect}
          onRolesChanged={onRolesChanged}
          realUsage={realUsage}
          contextLimit={contextLimit}
          isCompacting={isCompacting}
          isAwaitingUsage={isAwaitingUsage}
          conversationId={conversation?.id}
          segments={segments}
          onCompactActive={onCompactActive}
          onOpenSegment={onOpenSegment}
          onDeleteSegment={onDeleteSegment}
        />
      </div>

      {/* Artifact 全屏页面 - 覆盖整个应用（包括顶部和底部导航栏） */}
      <div
        data-swipe-ignore
        className={`fixed inset-0 z-[100] bg-[var(--color-bg-base)] transition-transform duration-300 ease-out ${
          activeArtifact ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ pointerEvents: activeArtifact ? 'auto' : 'none' }}
      >
        {activeArtifact && (
          <ArtifactPanel artifact={activeArtifact} onClose={closeArtifact} isGenerating={isArtifactGenerating} autoPreviewSignal={autoPreviewSignal} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
        )}
      </div>

      {/* 上下文摘要查看/编辑 */}
      <ContextSummarySheet
        open={openSegment !== null}
        segment={openSegment}
        onClose={() => setOpenSegmentId(null)}
        onSave={summary => {
          if (openSegment) onUpdateSegment?.(openSegment.id, summary);
        }}
      />
    </>
  );
}
