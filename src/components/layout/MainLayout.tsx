import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Menu, MessageSquare, Image as ImageIcon, Film, MessageSquarePlus, Search, Trash2 } from 'lucide-react';
import PinyinMatch from 'pinyin-match';
import Sidebar from './Sidebar';
import ConfirmModal from '../common/ConfirmModal';
import ModelSelector from '../common/ModelSelector';
import { CHAT_MODELS } from '../../config/models';
import type { TabMode, Conversation } from '../../types';

type TabIcon = ComponentType<{ className?: string }>;

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
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: (open: boolean) => void;
  inputFocused?: boolean;
}

const MOBILE_TABS: { id: TabMode; label: string; Icon: TabIcon }[] = [
  { id: 'chat', label: '聊天', Icon: MessageSquare },
  { id: 'image', label: '图片', Icon: ImageIcon },
  { id: 'video', label: '视频', Icon: Film },
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

/* ========== 移动端抽屉组件 ========== */
interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string;
  onSwitchConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

function MobileDrawer({
  open,
  onClose,
  conversations,
  activeConversationId,
  onSwitchConversation,
  onDeleteConversation,
}: MobileDrawerProps) {
  const [searchText, setSearchText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredConversations = useMemo(() => {
    const keyword = searchText.trim();
    if (!keyword) return conversations;
    return conversations.filter(conv => {
      if (conv.title.toLowerCase().includes(keyword.toLowerCase())) return true;
      const match = PinyinMatch.match(conv.title, keyword);
      return match !== false;
    });
  }, [conversations, searchText]);

  // 获取会话最后一条消息预览
  const getLastMessagePreview = (conv: Conversation): string => {
    const msgs = conv.messages;
    if (!msgs || msgs.length === 0) return '暂无消息';
    const lastMsg = msgs[msgs.length - 1];
    if (typeof lastMsg.content === 'string') {
      return lastMsg.content.slice(0, 60);
    }
    // MessageContent[] 类型
    const textPart = lastMsg.content.find(c => c.type === 'text');
    if (textPart && 'text' in textPart) return (textPart.text as string).slice(0, 60);
    return '[图片]';
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />
      {/* 抽屉本体 */}
      <aside
        className={`fixed top-0 bottom-0 left-0 w-[85%] max-w-[360px] bg-[#0a0a0a] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* 搜索框 */}
        <div className="px-4 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="搜索会话..."
              className="w-full bg-gray-900 text-white text-sm rounded-xl pl-9 pr-3 py-2.5 border border-transparent focus:border-[rgb(127,96,255)] focus:outline-none placeholder-gray-500"
            />
          </div>
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
          {filteredConversations.length === 0 && searchText && (
            <div className="text-center text-gray-500 text-sm py-8">无匹配结果</div>
          )}
          {filteredConversations.map(conv => {
            const isActive = conv.id === activeConversationId;
            return (
              <div
                key={conv.id}
                onClick={() => onSwitchConversation(conv.id)}
                className={`group relative rounded-xl px-3.5 py-3 mb-1.5 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-[rgb(127,96,255)] text-white'
                    : 'text-gray-300 active:bg-gray-800'
                }`}
              >
                <div className={`text-sm font-medium truncate ${
                  isActive ? 'text-white' : 'text-gray-200'
                }`}>
                  {conv.title}
                </div>
                <div className={`text-xs truncate mt-0.5 ${
                  isActive ? 'text-white/70' : 'text-gray-500'
                }`}>
                  {getLastMessagePreview(conv)}
                </div>
                {/* 删除按钮 */}
                {!isActive && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setDeleteTarget(conv.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <ConfirmModal
        open={deleteTarget !== null}
        title="删除会话"
        message="确定要删除这个会话吗？删除后无法恢复。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) onDeleteConversation(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
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
  onModelChange,
  mobileDrawerOpen,
  setMobileDrawerOpen,
  inputFocused,
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
      <div className="h-[100dvh] flex bg-black text-white overflow-hidden">
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

  // 移动端布局：主内容上方 + 底部 Tab + 左侧抽屉 (仅聊天)
  return (
    <div className="h-[100dvh] flex flex-col bg-black text-white overflow-hidden">
      {/* 顶部导航栏 - 靠右排列以留出空间 */}
      <header className="flex items-center justify-between py-3 px-4 shrink-0 bg-transparent">
        {/* 左侧容器 - 汉堡菜单 + 模型选择器 */}
        <div className="flex items-center gap-4">
          {/* 左侧汉堡菜单 */}
          {showConversations && (
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="p-1.5 -ml-1 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg shrink-0"
              aria-label="打开会话历史"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}  
        
          {/* 模型选择器（胶囊形状） */}
          <ModelSelector
            models={CHAT_MODELS}
            selectedModel={conversations?.find(c => c.id === activeConversationId)?.selectedModel || CHAT_MODELS[0].id}
            onModelChange={onModelChange || (() => {})}
            compact={true}
          />
        </div>
      
        {/* 右侧新建会话按钮 */}
        {onNewConversation && (
          <button
            onClick={onNewConversation}
            className="p-1.5 -mr-1 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg shrink-0"
            aria-label="新建会话"
            title="新建会话"
          >
            <MessageSquarePlus className="w-5 h-5" />
          </button>
        )}
      </header>
  
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">{children}</main>

      {/* 底部 Tab 栏 */}
      <nav
        className={`flex bg-transparent shrink-0 transition-all duration-300 ease-in-out ${
          inputFocused ? 'max-h-0 overflow-hidden opacity-0' : 'max-h-20 opacity-100'
        }`}
        style={{ paddingBottom: inputFocused ? '0' : 'env(safe-area-inset-bottom)' }}
      >
        {MOBILE_TABS.map(tab => {
          const Icon = tab.Icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
                activeTab === tab.id
                  ? 'text-[rgb(127,96,255)]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </nav>

      {/* 会话历史抽屉：仅聊天模式可用 */}
      {showConversations && (
        <MobileDrawer
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSwitchConversation={(id) => {
            onSwitchConversation(id);
            setMobileDrawerOpen(false);
          }}
          onDeleteConversation={onDeleteConversation}
        />
      )}
    </div>
  );
}
