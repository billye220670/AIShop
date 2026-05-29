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
}: MainLayoutProps) {
  return (
    <div className="h-screen flex bg-gray-950 text-white overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSwitchConversation={onSwitchConversation}
        onNewConversation={onNewConversation}
        onDeleteConversation={onDeleteConversation}
        onRenameConversation={onRenameConversation}
      />
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  );
}
