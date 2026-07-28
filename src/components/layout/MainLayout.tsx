import { useEffect, useState, type ReactNode } from 'react';
import Sidebar, { SIDEBAR_WIDTH } from './Sidebar';
import TopNavBar from './TopNavBar';
import type { TabMode, Conversation, Model } from '../../types';

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
  // 模型选择
  models?: Model[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
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
  models,
  selectedModel,
  onModelChange,
}: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 监听 ESC 关闭侧边栏
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  return (
    <div className="h-[100dvh] bg-[#121211] text-white overflow-hidden relative" style={{ touchAction: 'manipulation' }}>
      {/* 侧边栏 - 绝对定位左侧底层，平时收起在屏幕外 */}
      <div
        className={`absolute top-0 left-0 bottom-0 z-0 transition-transform duration-250 ease-out bg-[#1e1e1c] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ width: `${SIDEBAR_WIDTH}px` }}
      >
        <Sidebar
          activeTab={activeTab}
          onTabChange={(tab) => { onTabChange(tab); setSidebarOpen(false); }}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSwitchConversation={onSwitchConversation}
          onNewConversation={onNewConversation}
          onDeleteConversation={onDeleteConversation}
          onRenameConversation={onRenameConversation}
          onOpenSettings={onOpenSettings}
          collapsed={false}
          onCollapsedChange={() => {}}
        />
      </div>

      {/* 内容区 - 全宽，translateX 推出，右侧被 overflow-hidden 裁剪 */}
      <div
        className={`h-full flex flex-col relative z-10 transition-transform duration-250 ease-out ${sidebarOpen ? 'translate-x-[300px]' : 'translate-x-0'}`}
        onClick={() => { if (sidebarOpen) setSidebarOpen(false); }}
      >
        {/* 顶部导航栏 */}
        {models && selectedModel && onModelChange && (
          <TopNavBar
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            models={models}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            onNewConversation={onNewConversation}
          />
        )}
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
