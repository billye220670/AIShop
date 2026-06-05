import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, MoreVertical, Download, Pencil, Trash2 } from 'lucide-react';
import PinyinMatch from 'pinyin-match';
import type { Conversation } from '../../types';
import ConfirmModal from '../common/ConfirmModal';

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSwitchConversation: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
}

export default function HistoryPanel({
  open,
  onClose,
  conversations,
  activeConversationId,
  onSwitchConversation,
  onDelete,
  onRename,
}: HistoryPanelProps) {
  const [historySearch, setHistorySearch] = useState('');
  const historyPanelRef = useRef<HTMLDivElement>(null);

  // 三点菜单状态
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // 编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);
  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = () => setMenuOpenId(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [menuOpenId]);

  // 编辑模式自动聚焦
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Filtered conversations (排除空会话/无消息的会话)
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    // 过滤掉没有消息的空会话（无论标题是什么）
    const nonEmpty = conversations.filter(conv => conv.messages && conv.messages.length > 0);
    const keyword = historySearch.trim();
    if (!keyword) return nonEmpty;
    return nonEmpty.filter(conv => {
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

  // 导出会话为 JSON
  const exportConversation = (conv: Conversation) => {
    const data = {
      app: 'PortAI',
      version: 1,
      conversation: conv,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title}.portai.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 编辑操作
  const enterEdit = (conv: Conversation) => {
    setMenuOpenId(null);
    setEditingId(conv.id);
    setEditText(conv.title);
  };

  const commitEdit = (id: string) => {
    const trimmed = editText.trim();
    if (trimmed) {
      onRename(id, trimmed);
    }
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  return (
    <>
      {/* 遮罩层 - 点击关闭面板 */}
      {open && (
        <div
          className="hidden md:block fixed inset-0 z-[99]"
          onClick={onClose}
        />
      )}

      {/* Desktop history sliding panel */}
      <div
        ref={historyPanelRef}
        className={`hidden md:flex flex-col fixed top-[44px] right-0 bottom-0 w-[380px] z-[100] bg-[var(--color-bg-primary)] border-l border-gray-700/50 shadow-2xl transform transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 顶部标题栏 - 增加 pt-4 以避免与 Electron 窗口拖拽区域冲突 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-lg font-bold text-white">聊天历史</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-gray-400 hover:text-white" />
          </button>
        </div>

        {/* "所有" tab */}
        <div className="px-5 pb-3">
          <span className="text-sm text-white border-b-2 border-[var(--color-accent)] pb-1">所有</span>
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
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </div>

        {/* 会话列表（按时间分组，可滚动） */}
        <div className="flex-1 overflow-y-auto overflow-x-visible px-3">
          {filteredConversations.length === 0 && historySearch && (
            <div className="text-center text-gray-500 text-sm py-8">无匹配结果</div>
          )}
          {groupedConversations.map(group => (
            <div key={group.label}>
              <div className="px-2 pt-3 pb-1.5 text-xs text-gray-500 font-medium">{group.label}</div>
              {group.items.map(conv => {
                const isActive = conv.id === activeConversationId;
                const isEditing = editingId === conv.id;
                const isMenuOpen = menuOpenId === conv.id;
                return (
                  <div
                    key={conv.id}
                    className={`group relative w-full text-left px-3 py-3 rounded-lg mb-1 transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[var(--color-accent-soft)]'
                        : 'hover:bg-white/5'
                    }`}
                    onClick={() => {
                      if (!isEditing) {
                        onSwitchConversation(conv.id);
                        onClose();
                      }
                    }}
                  >
                    {/* 标题行 */}
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          onBlur={() => commitEdit(conv.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitEdit(conv.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEdit();
                            }
                          }}
                          maxLength={50}
                          className="flex-1 min-w-0 bg-gray-800 text-white text-sm px-2 py-0.5 rounded border border-[var(--color-accent)] outline-none"
                        />
                      ) : (
                        <div className="flex-1 min-w-0 text-sm font-bold text-white truncate">
                          {conv.title}
                        </div>
                      )}

                      {/* 三点菜单按钮 */}
                      {!isEditing && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setMenuOpenId(isMenuOpen ? null : conv.id);
                          }}
                          className={`flex-shrink-0 p-1 rounded-md transition-all ${
                            isMenuOpen
                              ? 'opacity-100 bg-white/10'
                              : 'opacity-0 group-hover:opacity-100 hover:bg-white/10'
                          }`}
                        >
                          <MoreVertical className="w-4 h-4 text-gray-400" />
                        </button>
                      )}
                    </div>

                    {/* 预览文本 */}
                    {!isEditing && (
                      <div className="text-xs text-gray-400 mt-1 line-clamp-2">
                        {getLastMessagePreview(conv)}
                      </div>
                    )}

                    {/* 浮动菜单 */}
                    {isMenuOpen && (
                      <div
                        className="absolute right-2 top-10 z-[200] w-40 bg-[var(--color-bg-secondary)] border border-gray-700/60 rounded-lg shadow-xl py-1"
                        onClick={e => e.stopPropagation()}
                      >
                        {/* 导出 */}
                        <button
                          onClick={() => {
                            exportConversation(conv);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          <span>导出</span>
                        </button>
                        {/* 编辑标题 */}
                        <button
                          onClick={() => enterEdit(conv)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                          <span>编辑标题</span>
                        </button>
                        {/* 删除 */}
                        <button
                          onClick={() => {
                            setDeleteTarget(conv.id);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-white/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>删除</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="删除会话"
        message="确定要删除这个会话吗？删除后无法恢复。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
