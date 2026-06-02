import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
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
  onModelChange?: (modelId: string) => void;
  onOpenSettings?: () => void;
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
}: MainLayoutProps) {
  return (
    <div className="h-[100dvh] flex flex-col bg-[#0d0a1a] text-white overflow-hidden">
      {/* 窗口拖拽区域 - 让用户可以拖动窗口 */}
      <div className="h-[36px] shrink-0 w-full" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
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
        />
        <main className="flex-1 flex flex-col overflow-hidden bg-[#1a1a2e] rounded-2xl m-2 ml-0">{children}</main>
      </div>
    </div>
  );
}
