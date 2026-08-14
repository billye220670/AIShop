import { type ComponentType } from 'react';
import { MessageSquare, Image as ImageIcon, Library, User, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { TabMode } from '../../types';
import { useByocStatus } from '../../hooks/useByocStatus';

export interface DesktopSidebarProps {
  activeTab: TabMode;
  onTabChange: (tab: TabMode) => void;
  /** 折叠状态（由父组件管理并持久化） */
  collapsed: boolean;
  onCollapsedChange: (c: boolean) => void;
}

export const SIDEBAR_WIDTH = 224;
export const COLLAPSED_WIDTH = 60;
export const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

type TabIcon = ComponentType<{ className?: string }>;

/** 左侧模式页签（「我的」不是页签：常驻底部、点击不高亮） */
const MODE_TABS: { id: TabMode; label: string; Icon: TabIcon }[] = [
  { id: 'chat', label: '聊天', Icon: MessageSquare },
  { id: 'image', label: '图片', Icon: ImageIcon },
  { id: 'library', label: '我的库', Icon: Library },
];

/** 桌面侧边栏：模式页签（聊天/图片/我的库）+ 折叠按钮 + 底部「我的」入口；
 *  历史会话列表已移到右侧 HistoryPanel，这里不再展示 */
export default function DesktopSidebar({
  activeTab,
  onTabChange,
  collapsed,
  onCollapsedChange,
}: DesktopSidebarProps) {
  // BYOC 同步状态（右下角小圆点）
  const byoc = useByocStatus();
  const byocDotClass = byoc.tone === 'synced' ? 'bg-green-500' : byoc.tone === 'pending' ? 'bg-amber-400 animate-pulse' : 'bg-gray-500';

  return (
    <aside
      className="relative bg-transparent flex flex-col shrink-0 overflow-visible transition-all duration-200"
      style={{ width: `${collapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH}px` }}
    >
      {/* 顶部：应用名 + 折叠按钮 */}
      <div className={`flex items-center px-4 py-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <span
            className="text-2xl text-white select-none tracking-tight"
            style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}
          >
            AIShop
          </span>
        )}
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="p-1.5 rounded-md text-gray-400 hover:text-white transition-colors cursor-pointer"
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>

      {/* 模式页签 */}
      <nav className="flex-1 space-y-1.5 px-2 overflow-visible">
        {MODE_TABS.map(tab => {
          const Icon = tab.Icon;
          return (
            <div key={tab.id} className="relative group">
              <button
                onClick={() => onTabChange(tab.id)}
                title={collapsed ? tab.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors ${
                  collapsed ? 'justify-center' : ''
                } ${
                  activeTab === tab.id
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span className="text-sm font-medium truncate">{tab.label}</span>}
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

      {/* 底部：「我的」入口（设置页，非模式页签：点击不参与高亮）+ BYOC 同步状态小圆点 */}
      <div className="px-2 pb-4 mt-auto">
        <div className="relative group">
          <button
            onClick={() => onTabChange('me')}
            title={byoc.title}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
              collapsed ? 'justify-center' : ''
            } text-gray-400 hover:bg-white/5 hover:text-white`}
          >
            <span className="relative shrink-0">
              <User className="w-5 h-5" />
              {/* BYOC 同步状态小圆点：绿=已同步 / 琥珀=待同步 / 灰=未启用 */}
              <span
                className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg-base)] ${byocDotClass}`}
              />
            </span>
            {!collapsed && <span className="text-sm font-medium truncate">我的</span>}
          </button>

          {/* 折叠态自定义 Tooltip */}
          {collapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-50">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-[var(--color-bg-elevated)]" />
              <div className="bg-[var(--color-bg-elevated)] text-white text-sm rounded-md px-3 py-1.5 shadow-lg whitespace-nowrap">
                我的
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
