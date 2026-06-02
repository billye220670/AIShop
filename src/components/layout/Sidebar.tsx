import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { MessageSquare, Image as ImageIcon, Film, Music, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import type { TabMode, Conversation } from '../../types';

type TabIcon = ComponentType<{ className?: string }>;

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
  onOpenSettings?: () => void;
}

const tabs: { id: TabMode; label: string; Icon: TabIcon }[] = [
  { id: 'chat', label: '聊天', Icon: MessageSquare },
  { id: 'image', label: '图片', Icon: ImageIcon },
  { id: 'video', label: '视频', Icon: Film },
  { id: 'music', label: '音乐', Icon: Music },
];

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 224;
const COLLAPSED_WIDTH = 60;
const STORAGE_KEY = 'sidebar-width';
const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

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

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function Sidebar({
  activeTab,
  onTabChange,
  onOpenSettings,
}: SidebarProps) {

  const [width, setWidth] = useState<number>(() => readStoredWidth());
  const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed());
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

  // 持久化折叠状态
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (collapsed) return;
    e.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
  }, [collapsed]);

  // 全局监听 mousemove/mouseup —— 拖动期间避免文本选中、保持流畅
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
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

  // 折叠态阈值：小于一定宽度时只显示图标
  const compact = !collapsed && width < 140;
  const currentWidth = collapsed ? COLLAPSED_WIDTH : width;

  return (
    <aside
      className="relative bg-transparent flex flex-col pt-4 shrink-0 overflow-visible transition-all duration-200"
      style={{ width: `${currentWidth}px` }}
    >
      {/* 顶部标题 + 折叠按钮 */}
      <div className={`flex items-center px-5 py-4 mb-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <span className="text-xl font-bold text-white select-none">AISHOP</span>
        )}
        <button
          onClick={() => setCollapsed(prev => !prev)}
          className="p-1.5 rounded-md text-gray-400 hover:text-white transition-colors"
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-5 h-5" />
          ) : (
            <PanelLeftClose className="w-5 h-5" />
          )}
        </button>
      </div>

      <nav className="flex-1 space-y-1.5 px-2 overflow-visible">
        {tabs.map(tab => {
          const Icon = tab.Icon;
          return (
            <div key={tab.id} className="relative group">
              <button
                onClick={() => onTabChange(tab.id)}
                {...(!collapsed ? { title: tab.label } : {})}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  collapsed ? 'justify-center' : ''
                } ${
                  activeTab === tab.id
                    ? 'bg-[rgb(127,96,255)] text-white'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && !compact && (
                  <span className="text-sm font-medium truncate">{tab.label}</span>
                )}
              </button>

              {/* 折叠态自定义 Tooltip */}
              {collapsed && (
                <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-50">
                  {/* 小三角箭头 */}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-gray-900/95" />
                  <div className="bg-gray-900/95 text-white text-sm rounded-md px-3 py-1.5 shadow-lg whitespace-nowrap">
                    {tab.label}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* 底部设置按钮 */}
      <div className="px-2 pb-4 mt-auto">
        <div className="relative group">
          <button
            onClick={onOpenSettings}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
              collapsed ? 'justify-center' : ''
            } text-gray-400 hover:bg-white/5 hover:text-white`}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!collapsed && !compact && (
              <span className="text-sm font-medium truncate">设置</span>
            )}
          </button>

          {/* 折叠态自定义 Tooltip */}
          {collapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-50">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-gray-900/95" />
              <div className="bg-gray-900/95 text-white text-sm rounded-md px-3 py-1.5 shadow-lg whitespace-nowrap">
                设置
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 拖动手柄 - 折叠态隐藏 */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调节侧边栏宽度"
          onMouseDown={handleMouseDown}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          title="拖动调节宽度，双击重置"
          className="group absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize z-10 select-none"
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
      )}
    </aside>
  );
}
