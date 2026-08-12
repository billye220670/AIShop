import { useEffect, useState } from 'react';
import { Home } from 'lucide-react';
import DesktopSidebar, {
  SIDEBAR_WIDTH,
  COLLAPSED_WIDTH,
  COLLAPSED_STORAGE_KEY,
} from './DesktopSidebar';
import type { MainLayoutProps } from './MainLayout';

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** 桌面布局：52px 顶栏（仅左侧首页区，保持干净）+ 可折叠侧边栏（模式页签）+ 主内容卡片区；
 *  历史会话列表在右侧 HistoryPanel，不在左侧展示 */
export default function DesktopLayout(props: MainLayoutProps) {
  const { activeTab, onTabChange, children } = props;
  // 侧边栏折叠状态（localStorage 持久化，刷新后保持）
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readStoredCollapsed());

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  const sidebarWidth = sidebarCollapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--color-bg-base)] text-[var(--color-text-primary)] overflow-hidden">
      {/* 顶部 52px 栏：左侧首页区（与侧边栏等宽，折叠时同步收窄），右侧留白 */}
      <div className="h-[52px] shrink-0 w-full flex pt-2">
        <div
          className="shrink-0 h-full flex items-center px-3 transition-all duration-200"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="w-full h-full flex items-center gap-2 px-3 rounded-md bg-white/[0.08] text-white/90 text-sm font-medium select-none cursor-default">
            <Home className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>首页</span>}
          </div>
        </div>
        <div className="flex-1 h-full" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <DesktopSidebar
          activeTab={activeTab}
          onTabChange={onTabChange}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
        <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg-primary)] rounded-2xl m-2 ml-0">
          {children}
        </main>
      </div>
    </div>
  );
}
