import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Download, Pencil, Trash2 } from 'lucide-react';
import PinyinMatch from 'pinyin-match';
import type { Conversation } from '../../types';
import ConfirmModal from '../common/ConfirmModal';
import PromptModal from '../common/PromptModal';
import { haptic } from '../../utils/haptics';

export interface SidebarProps {
  conversations?: Conversation[];
  activeConversationId?: string;
  onSwitchConversation?: (id: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
}

export const SIDEBAR_WIDTH = 360;
export const COLLAPSED_WIDTH = 60;
export const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

export default function Sidebar({
  conversations,
  activeConversationId,
  onSwitchConversation,
  onDeleteConversation,
  onRenameConversation,
}: SidebarProps) {
  const [historySearch, setHistorySearch] = useState('');
  // 三点菜单状态
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // 重命名弹窗状态（弹窗内部自行管理输入值）
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // --- 点击后延迟切换 ---
  /** 点击项先本地高亮，短暂停顿让用户看到选中反馈，再真正切换并收起面板 */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const SELECT_FEEDBACK_MS = 160;
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectConversation = (id: string) => {
    if (selectTimerRef.current) return; // 已有待处理的切换，忽略连点
    setPendingId(id);
    selectTimerRef.current = setTimeout(() => {
      selectTimerRef.current = null;
      setPendingId(null);
      onSwitchConversation?.(id);
    }, SELECT_FEEDBACK_MS);
  };

  useEffect(() => () => {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
  }, []);

  // --- 长按唤出上下文菜单 ---
  const LONG_PRESS_MS = 450;
  /** 超过这个位移视为滚动，取消长按 */
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** 长按已触发，用于吞掉紧随其后的 click，避免顺带切换会话 */
  const suppressClickRef = useRef(false);

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressOriginRef.current = null;
  };

  const handlePressStart = (id: string, e: React.PointerEvent) => {
    // 只响应主键/触摸，忽略右键与多指
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearPressTimer();
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      suppressClickRef.current = true;
      setMenuOpenId(id);
      // 长按已选中的文本会残留，主动清掉
      window.getSelection?.()?.removeAllRanges();
      haptic();
    }, LONG_PRESS_MS);
  };

  const handlePressMove = (e: React.PointerEvent) => {
    const origin = pressOriginRef.current;
    if (!origin || !pressTimerRef.current) return;
    const dx = Math.abs(e.clientX - origin.x);
    const dy = Math.abs(e.clientY - origin.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
      clearPressTimer();
    }
  };

  useEffect(() => () => clearPressTimer(), []);

  // 点击/触摸外部关闭菜单
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = () => setMenuOpenId(null);
    // 捕获阶段监听，保证在菜单项自身的 stopPropagation 之外也能关闭
    document.addEventListener('click', handleClick);
    document.addEventListener('pointerdown', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('pointerdown', handleClick);
    };
  }, [menuOpenId]);

  // Filtered conversations (排除空会话)
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
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

  // 重命名：菜单项点击后弹出输入弹窗
  const enterEdit = (conv: Conversation) => {
    setMenuOpenId(null);
    setRenameTarget(conv);
  };

  return (
    <aside className="h-full bg-transparent flex flex-col overflow-hidden">
      {/* 搜索框
          外层 54px 对齐 TopNavBar 行高：py-2(16) + 最高子元素 ModelSelector 38px
          （text-sm 20 + py-2 16 + border 2）；汉堡按钮 36px 在该行内居中。
          配合 items-center，搜索框与右侧汉堡图标处于同一水平中线 */}
      <div className="px-4 h-[54px] flex items-center shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={historySearch}
            onChange={e => setHistorySearch(e.target.value)}
            placeholder="搜索对话"
            className="w-full h-10 bg-[#121211] border border-gray-700/50 rounded-full pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>
      </div>

      {/* 长按呼出上下文菜单时的背景模糊遮罩：只模糊背景，不拦截列表本身的定位 */}
      {menuOpenId && (
        <div
          className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay"
          onClick={() => setMenuOpenId(null)}
          onPointerDown={() => setMenuOpenId(null)}
        />
      )}

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto overflow-x-visible px-2 pt-2">
        {filteredConversations.length === 0 && historySearch && (
          <div className="text-center text-gray-500 text-sm py-8">无匹配结果</div>
        )}
        {groupedConversations.map(group => (
          <div key={group.label}>
            <div className="px-2 pt-3 pb-1.5 text-xs text-gray-500 font-medium">{group.label}</div>
            {group.items.map(conv => {
              // pendingId 让高亮在真正切换前就先落到被点的项上
              const isActive = pendingId ? conv.id === pendingId : conv.id === activeConversationId;
              const isMenuOpen = menuOpenId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`group relative w-full text-left px-3 py-3 pb-4 rounded-2xl mb-0.5 transition-colors cursor-pointer select-none [-webkit-touch-callout:none] ${
                    isActive
                      ? 'bg-[var(--color-accent-soft)]'
                      : isMenuOpen
                        ? 'bg-white/10'
                        : 'hover:bg-white/5'
                  } ${isMenuOpen ? 'relative z-[201] context-menu-pop' : ''}`}
                  onPointerDown={e => handlePressStart(conv.id, e)}
                  onPointerMove={handlePressMove}
                  onPointerUp={clearPressTimer}
                  onPointerCancel={clearPressTimer}
                  onPointerLeave={clearPressTimer}
                  // 长按在部分浏览器仍会尝试弹出原生菜单/选词，这里一并拦掉
                  onContextMenu={e => e.preventDefault()}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    selectConversation(conv.id);
                  }}
                >
                  {/* 标题行 */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0 text-base font-bold text-white truncate">
                      {conv.title}
                    </div>
                  </div>

                  {/* 预览文本 */}
                  <div className="text-xs text-gray-400 mt-1.5 line-clamp-2">
                    {getLastMessagePreview(conv)}
                  </div>

                  {/* 浮动菜单 */}
                  {isMenuOpen && (
                    <div
                      className="absolute right-3 top-1/2 z-[200] w-48 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2 select-none context-menu-pop"
                      onClick={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          exportConversation(conv);
                          setMenuOpenId(null);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
                      >
                        <Download className="w-5 h-5 flex-shrink-0" />
                        <span>导出</span>
                      </button>
                      <button
                        onClick={() => enterEdit(conv)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
                      >
                        <Pencil className="w-5 h-5 flex-shrink-0" />
                        <span>编辑标题</span>
                      </button>
                      <button
                        onClick={() => {
                          setDeleteTarget(conv.id);
                          setMenuOpenId(null);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-base text-red-400 active:bg-white/10 hover:bg-white/10 transition-colors"
                      >
                        <Trash2 className="w-5 h-5 flex-shrink-0" />
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

      {/* 底部版本号 */}
      <div className="px-4 pb-3 pt-2 mt-auto">
        <p className="text-xs text-gray-500 text-center">
          v{__APP_VERSION__}
        </p>
      </div>

      {/* 重命名弹窗 */}
      <PromptModal
        open={renameTarget !== null}
        title="编辑标题"
        initialValue={renameTarget?.title ?? ''}
        placeholder="新标题"
        confirmText="保存"
        cancelText="取消"
        maxLength={50}
        onConfirm={value => {
          if (renameTarget) onRenameConversation?.(renameTarget.id, value);
          setRenameTarget(null);
        }}
        onCancel={() => setRenameTarget(null)}
      />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="删除会话"
        message="确定要删除这个会话吗？删除后无法恢复。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) onDeleteConversation?.(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}
