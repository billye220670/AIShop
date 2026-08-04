import { Menu, MessageSquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Model, ContextSegment } from '../../types';
import ModelSelector from '../common/ModelSelector';
import ContextRing from '../chat/ContextRing';
import ContextPanel from '../chat/ContextPanel';
import type { UsageTotals } from '../../utils/tokenEstimate';

interface TopNavBarProps {
  onToggleSidebar: () => void;
  models: Model[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  onNewConversation?: () => void;
  /** 当前会话是否已有消息；没有时新建按钮置灰禁用 */
  canCreateNewConversation?: boolean;
  webSearchEnabled?: boolean;
  onWebSearchToggle?: () => void;
  artifactEnabled?: boolean;
  onArtifactToggle?: () => void;
  // 上下文占用（仅聊天页传入）
  realUsage?: UsageTotals;
  contextLimit?: number;
  isCompacting?: boolean;
  isAwaitingUsage?: boolean;
  onCompactActive?: () => void;
  segments?: ContextSegment[];
  onOpenSegment?: (segmentId: string) => void;
  onDeleteSegment?: (segmentId: string) => void;
  /** 会话 id，切换会话时重置环的填充动画 */
  conversationId?: string;
}

export default function TopNavBar({
  onToggleSidebar,
  models,
  selectedModel,
  onModelChange,
  onNewConversation,
  canCreateNewConversation = true,
  webSearchEnabled = false,
  onWebSearchToggle,
  artifactEnabled = false,
  onArtifactToggle,
  realUsage,
  contextLimit,
  isCompacting = false,
  isAwaitingUsage = false,
  onCompactActive,
  segments,
  onOpenSegment,
  onDeleteSegment,
  conversationId,
}: TopNavBarProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  // 点击外部关闭面板
  useEffect(() => {
    if (!panelOpen) return;
    const close = () => setPanelOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [panelOpen]);

  // Esc 关闭
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const showRing = Boolean(realUsage && contextLimit);

  return (
    <div className="relative flex items-center justify-between px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shrink-0">
      {/* 左侧：汉堡菜单 + 模型选择器 + 上下文环 */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleSidebar}
          className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg"
          title="菜单"
        >
          <Menu className="w-5 h-5" />
        </button>

        <ModelSelector
          models={models}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          compact={true}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={onWebSearchToggle}
          artifactEnabled={artifactEnabled}
          onArtifactToggle={onArtifactToggle}
        />

        {showRing && (
          <div
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            // 面板展开时把环提到遮罩之上，保持清晰
            className={panelOpen ? 'relative z-[201]' : undefined}
          >
            <ContextRing
              // 按会话重挂载，避免切换时沿用上一个会话的填充量
              key={conversationId}
              realUsage={realUsage!}
              contextLimit={contextLimit!}
              isCompacting={isCompacting}
              isAwaitingUsage={isAwaitingUsage}
              isOpen={panelOpen}
              onClick={() => setPanelOpen(v => !v)}
            />
          </div>
        )}
      </div>

      {/* 右侧：新建对话 */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => canCreateNewConversation && onNewConversation?.()}
          disabled={!canCreateNewConversation}
          className={`p-2 rounded-lg transition-colors ${
            canCreateNewConversation
              ? 'text-gray-400 hover:text-white'
              : 'text-neutral-800 cursor-not-allowed'
          }`}
          title="新建对话"
        >
          <MessageSquarePlus className="w-5 h-5" />
        </button>
      </div>

      {/* 虚焦遮罩：仿长按会话项的上下文菜单，点击任意处关闭 */}
      {panelOpen && showRing && (
        <div
          className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay"
          onClick={() => setPanelOpen(false)}
          onPointerDown={() => setPanelOpen(false)}
        />
      )}

      {/* 上下文详情面板 */}
      {panelOpen && showRing && (
        <ContextPanel
          realUsage={realUsage!}
          contextLimit={contextLimit!}
          isCompacting={isCompacting}
          isAwaitingUsage={isAwaitingUsage}
          onCompact={() => {
            onCompactActive?.();
            setPanelOpen(false);
          }}
          segments={segments}
          onOpenSegment={segmentId => {
            onOpenSegment?.(segmentId);
            setPanelOpen(false);
          }}
          onDeleteSegment={onDeleteSegment}
        />
      )}
    </div>
  );
}
