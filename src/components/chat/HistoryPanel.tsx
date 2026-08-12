import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Conversation } from '../../types';
import Sidebar from '../layout/Sidebar';

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  conversations?: Conversation[];
  activeConversationId?: string;
  onSwitchConversation?: (id: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: string) => void;
  onDeleteConversations?: (ids: string[]) => void;
  onToggleConversationFavorite?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  /** BYOC 同步完成后重新加载会话列表（透传给 Sidebar） */
  onRefreshConversations?: () => Promise<void> | void;
}

/** 桌面模式右侧滑出的历史记录面板（仿旧版 electron HistoryPanel 样式）：
 *  固定右侧滑出 + 遮罩 + 标题栏，内容直接复用移动抽屉的 Sidebar
 *  （搜索/收藏筛选/批量删除/长按菜单全部保留） */
export default function HistoryPanel({
  open,
  onClose,
  conversations,
  activeConversationId,
  onSwitchConversation,
  onNewConversation,
  onDeleteConversation,
  onDeleteConversations,
  onToggleConversationFavorite,
  onRenameConversation,
  onRefreshConversations,
}: HistoryPanelProps) {
  // ESC 关闭面板
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* 遮罩层 - 点击关闭面板 */}
      <div
        className={`fixed inset-0 z-[99] bg-black/30 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* 右侧滑出面板 */}
      <aside
        className={`fixed top-0 right-0 bottom-0 w-[380px] z-[100] bg-[var(--color-bg-primary)] border-l border-gray-700/50 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-1 shrink-0">
          <h2 className="text-lg font-bold text-white">聊天历史</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            title="关闭"
          >
            <X className="w-5 h-5 text-gray-400 hover:text-white" />
          </button>
        </div>

        {/* 历史会话列表：复用移动抽屉 Sidebar，功能与左侧面板完全一致 */}
        <div className="flex-1 min-h-0">
          <Sidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSwitchConversation={onSwitchConversation}
            onNewConversation={onNewConversation}
            onDeleteConversation={onDeleteConversation}
            onDeleteConversations={onDeleteConversations}
            onToggleConversationFavorite={onToggleConversationFavorite}
            onRenameConversation={onRenameConversation}
            onRefreshConversations={onRefreshConversations}
          />
        </div>
      </aside>
    </>
  );
}
