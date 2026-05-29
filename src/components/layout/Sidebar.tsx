import { useCallback, useEffect, useRef, useState } from 'react';
import type { TabMode, Conversation } from '../../types';
import ConversationList from '../chat/ConversationList';

interface SidebarProps {
  activeTab: TabMode;
  onTabChange: (tab: TabMode) => void;
  // 会话相关 (仅聊天模式使用)
  conversations?: Conversation[];
  activeConversationId?: string;
  onSwitchConversation?: (id: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
}

const tabs: { id: TabMode; label: string; icon: string }[] = [
  { id: 'chat', label: '聊天', icon: '💬' },
  { id: 'image', label: '图片', icon: '🖼️' },
  { id: 'video', label: '视频', icon: '🎬' },
  { id: 'music', label: '音乐', icon: '🎵' },
];

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 224; // 对应原先 md:w-56 (14rem)
const STORAGE_KEY = 'sidebar-width';

function clampWidth(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_WIDTH;
    return clampWidth(parseInt(raw, 10));
  } catch {
    return DEFAULT_WIDTH;
  }
}

export default function Sidebar({
  activeTab,
  onTabChange,
  conversations,
  activeConversationId,
  onSwitchConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
}: SidebarProps) {
  const showConversations =
    activeTab === 'chat' &&
    conversations &&
    activeConversationId &&
    onSwitchConversation &&
    onNewConversation &&
    onDeleteConversation &&
    onRenameConversation;

  const [width, setWidth] = useState<number>(() => readStoredWidth());
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);

  // 持久化宽度
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
    } catch {
      // ignore
    }
  }, [width]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
  }, []);

  // 全局监听 mousemove/mouseup —— 拖动期间避免文本选中、保持流畅
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      // 侧边栏靠左，宽度 = 鼠标 X 距离视口左侧的距离
      setWidth(clampWidth(e.clientX));
    };

    const handleUp = () => {
      draggingRef.current = false;
      setIsDragging(false);
    };

    // 拖动时全局禁用文本选中、统一光标
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isDragging]);

  // 折叠态阈值：小于一定宽度时只显示图标（替代原先的 md: 响应式行为）
  const compact = width < 140;

  return (
    <aside
      className="relative bg-gray-900 border-r border-gray-700 flex flex-col py-4 shrink-0"
      style={{ width: `${width}px` }}
    >
      <div className={`px-3 mb-6 ${compact ? 'hidden' : 'block'}`}>
        <h1 className="text-xl font-bold text-white truncate">AIShop</h1>
        <p className="text-xs text-gray-400 mt-1 truncate">AI 综合创作平台</p>
      </div>
      <nav className="space-y-1 px-2 shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            title={tab.label}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <span className="text-lg">{tab.icon}</span>
            {!compact && (
              <span className="text-sm font-medium truncate">{tab.label}</span>
            )}
          </button>
        ))}
      </nav>

      {showConversations && (
        <>
          {!compact && (
            <div className="mt-4 mb-2 px-4 text-[11px] uppercase tracking-wider text-gray-500">
              历史会话
            </div>
          )}
          <div className="flex-1 min-h-0 flex flex-col">
            <ConversationList
              conversations={conversations}
              activeId={activeConversationId}
              onSwitch={onSwitchConversation}
              onNew={onNewConversation}
              onDelete={onDeleteConversation}
              onRename={onRenameConversation}
            />
          </div>
        </>
      )}

      {/* 拖动手柄：放在右边缘，宽 6px 命中区，内部 1px 视觉线 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调节侧边栏宽度"
        onMouseDown={handleMouseDown}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        title="拖动调节宽度，双击重置"
        className={`group absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize z-10 select-none ${
          isDragging ? '' : ''
        }`}
        style={{ touchAction: 'none' }}
      >
        <div
          className={`absolute top-0 right-0 h-full w-px transition-colors duration-150 ${
            isDragging
              ? 'bg-blue-500'
              : 'bg-transparent group-hover:bg-blue-500/70'
          }`}
        />
      </div>
    </aside>
  );
}
