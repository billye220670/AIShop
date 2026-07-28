import { useEffect, useState, type ReactNode } from 'react';
import { Home, BarChart3 } from 'lucide-react';
import Sidebar from './Sidebar';
import {
  SIDEBAR_WIDTH,
  COLLAPSED_STORAGE_KEY,
} from './Sidebar';
import type { TabMode, Conversation } from '../../types';

interface MainLayoutProps {
  activeTab: TabMode;
  onTabChange: (tab: TabMode) => void;
  children: ReactNode;
  conversations?: Conversation[];
  activeConversationId?: string;
  onSwitchConversation?: (id: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  onOpenSettings?: () => void;
  onOpenUsage?: () => void;
}

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function MainLayout({
  activeTab,
  onTabChange,
  children,
  conversations,
  activeConversationId,
  onSwitchConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onOpenSettings,
  onOpenUsage,
}: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readStoredCollapsed());

  // 持久化折叠状态
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--color-bg-base)] text-white overflow-hidden">
      {/* 顶部 Tab 栏 - 支持窗口拖拽，高度撑满标题栏区域 */}
      <div
        className="h-[52px] shrink-0 w-full flex pt-2 bg-[var(--color-bg-base)]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* 左侧 Tab 区域 - 与侧边栏等宽，完全撑满 */}
        <div
          className="shrink-0 h-full flex items-center px-3"
          style={{ width: `${SIDEBAR_WIDTH}px` }}
        >
          <div
            className="w-full h-full flex items-center gap-2 px-3 rounded-md bg-white/[0.08] text-white/90 text-sm font-medium select-none cursor-default"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Home className="w-4 h-4" />
            <span>首页</span>
          </div>
        </div>
        {/* 右侧拖拽区域 + 用量按钮 */}
        <div className="flex-1 h-full flex items-center justify-end px-2">
          <button
            onClick={onOpenUsage}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="用量查询"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <BarChart3 className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onTabChange={onTabChange}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSwitchConversation={onSwitchConversation}
          onNewConversation={onNewConversation}
          onDeleteConversation={onDeleteConversation}
          onRenameConversation={onRenameConversation}
          onOpenSettings={onOpenSettings}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
        <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg-primary)] rounded-2xl m-2 ml-0">{children}</main>
      </div>
    </div>
  );
}
