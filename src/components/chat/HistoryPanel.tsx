import { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import PinyinMatch from 'pinyin-match';
import type { Conversation } from '../../types';

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSwitchConversation: (id: string) => void;
}

export default function HistoryPanel({
  open,
  onClose,
  conversations,
  activeConversationId,
  onSwitchConversation,
}: HistoryPanelProps) {
  const [historySearch, setHistorySearch] = useState('');
  const historyPanelRef = useRef<HTMLDivElement>(null);

  // Filtered conversations
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
        className={`hidden md:flex flex-col fixed top-0 right-0 bottom-0 w-[380px] z-[100] bg-[#1a1a2e] border-l border-gray-700/50 shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
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
                      onSwitchConversation(conv.id);
                      onClose();
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
    </>
  );
}
