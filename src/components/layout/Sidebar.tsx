import { type ComponentType } from 'react';
import { MessageSquare, Image as ImageIcon, Film, Music, Star, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import type { TabMode, Conversation } from '../../types';

type TabIcon = ComponentType<{ className?: string }>;

export interface SidebarProps {
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
  // 折叠状态（由父组件管理）
  collapsed: boolean;
  onCollapsedChange: (c: boolean) => void;
}

const tabs: { id: TabMode; label: string; Icon: TabIcon }[] = [
  { id: 'chat', label: '聊天', Icon: MessageSquare },
  { id: 'image', label: '图片', Icon: ImageIcon },
  { id: 'video', label: '视频', Icon: Film },
  { id: 'music', label: '音乐', Icon: Music },
  { id: 'favorites', label: '收藏', Icon: Star },
];

export const SIDEBAR_WIDTH = 224;
export const COLLAPSED_WIDTH = 60;
export const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

export default function Sidebar({
  activeTab,
  onTabChange,
  onOpenSettings,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  const setCollapsed = onCollapsedChange;
  const currentWidth = collapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <aside
      className="relative bg-transparent flex flex-col shrink-0 overflow-visible transition-all duration-200"
      style={{ width: `${currentWidth}px` }}
    >
      {/* 顶部标题 + 折叠按钮 */}
      <div className={`flex items-center px-5 py-4 mb-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <span className="text-2xl text-white select-none tracking-tight" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>
            PortA<span className="relative inline-block">I<span className="absolute bottom-[6px] -right-[14px] w-[12px] h-[5px] bg-[var(--color-accent)] rounded-[1px]" /></span>
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
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
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors ${
                  collapsed ? 'justify-center' : ''
                } ${
                  activeTab === tab.id
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && (
                  <span className="text-sm font-medium truncate">{tab.label}</span>
                )}
              </button>

              {/* 折叠态自定义 Tooltip */}
              {collapsed && (
                <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-50">
                  {/* 小三角箭头 */}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-[var(--color-bg-elevated)]" />
                  <div className="bg-[var(--color-bg-elevated)] text-white text-sm rounded-md px-3 py-1.5 shadow-lg whitespace-nowrap">
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
            {!collapsed && (
              <span className="text-sm font-medium truncate">设置</span>
            )}
          </button>

          {/* 折叠态自定义 Tooltip */}
          {collapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-50">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-[var(--color-bg-elevated)]" />
              <div className="bg-[var(--color-bg-elevated)] text-white text-sm rounded-md px-3 py-1.5 shadow-lg whitespace-nowrap">
                设置
              </div>
            </div>
          )}
        </div>
      </div>

    </aside>
  );
}
