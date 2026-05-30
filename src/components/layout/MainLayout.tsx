import { useEffect, useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import ConversationList from '../chat/ConversationList';
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
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: (open: boolean) => void;
}

const MOBILE_TABS: { id: TabMode; label: string; icon: string }[] = [
  { id: 'chat', label: '聊天', icon: '💬' },
  { id: 'image', label: '图片', icon: '🖼️' },
  { id: 'video', label: '视频', icon: '🎬' },
  { id: 'music', label: '音乐', icon: '🎵' },
];

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isDesktop;
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
  mobileDrawerOpen,
  setMobileDrawerOpen,
}: MainLayoutProps) {
  const isDesktop = useIsDesktop();

  const showConversations =
    activeTab === 'chat' &&
    conversations &&
    activeConversationId &&
    onSwitchConversation &&
    onNewConversation &&
    onDeleteConversation &&
    onRenameConversation;

  // 切换 tab 时自动收起抽屉；切换到桌面端也收起以避免残留状态
  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [activeTab, isDesktop, setMobileDrawerOpen]);

  // ESC 关闭抽屉
  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileDrawerOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mobileDrawerOpen, setMobileDrawerOpen]);

  if (isDesktop) {
    return (
      <div className="h-[100dvh] flex bg-gray-950 text-white overflow-hidden">
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

  // 移动端布局：主内容上方 + 底部 Tab + 左侧抽屉(仅聊天)
  return (
    <div className="h-[100dvh] flex flex-col bg-gray-950 text-white overflow-hidden">
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">{children}</main>

      {/* 底部 Tab 栏 */}
      <nav
        className="flex border-t border-gray-700 bg-gray-900 shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {MOBILE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
              activeTab === tab.id
                ? 'text-blue-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className="text-xl leading-none">{tab.icon}</span>
            <span className="text-[10px]">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* 会话历史抽屉：仅聊天模式可用 */}
      {showConversations && (
        <>
          {/* 遮罩 */}
          <div
            onClick={() => setMobileDrawerOpen(false)}
            className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-200 ${
              mobileDrawerOpen
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none'
            }`}
            aria-hidden="true"
          />
          {/* 抽屉本体 */}
          <aside
            className={`fixed top-0 bottom-0 left-0 w-72 max-w-[85%] bg-gray-900 z-50 flex flex-col border-r border-gray-700 shadow-2xl transition-transform duration-200 ease-out ${
              mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-white truncate">
                  AIShop
                </h1>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  AI 综合创作平台
                </p>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg shrink-0"
                aria-label="关闭"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="px-4 mb-2 text-[11px] uppercase tracking-wider text-gray-500">
              历史会话
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              <ConversationList
                conversations={conversations}
                activeId={activeConversationId}
                onSwitch={(id) => {
                  onSwitchConversation(id);
                  setMobileDrawerOpen(false);
                }}
                onNew={() => {
                  onNewConversation();
                  setMobileDrawerOpen(false);
                }}
                onDelete={onDeleteConversation}
                onRename={onRenameConversation}
              />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
