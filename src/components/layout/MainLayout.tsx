import { useEffect, useState, useRef, type ReactNode } from 'react';
import Sidebar, { SIDEBAR_WIDTH } from './Sidebar';
import TopNavBar from './TopNavBar';
import BottomNavBar from './BottomNavBar';
import type { TabMode, Conversation, Model } from '../../types';
import { useDrawerSwipe } from '../../hooks/useDrawerSwipe';
import { haptic } from '../../utils/haptics';

interface MainLayoutProps {
  activeTab: TabMode;
  onTabChange: (tab: TabMode) => void;
  children: ReactNode;
  conversations?: Conversation[];
  activeConversationId?: string;
  onSwitchConversation?: (id: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: string) => void;
  onDeleteConversations?: (ids: string[]) => void;
  onToggleConversationFavorite?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  // 模型选择
  models?: Model[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  // 联网搜索
  webSearchEnabled?: boolean;
  onWebSearchToggle?: () => void;
  // Artifact
  artifactEnabled?: boolean;
  onArtifactToggle?: () => void;
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
  onDeleteConversations,
  onToggleConversationFavorite,
  onRenameConversation,
  models,
  selectedModel,
  onModelChange,
  webSearchEnabled,
  onWebSearchToggle,
  artifactEnabled,
  onArtifactToggle,
}: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 检测输入框聚焦，隐藏底部菜单栏
  const handleFocusIn = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') {
      if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
      setInputFocused(true);
    }
  };

  const handleFocusOut = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') {
      // 延迟隐藏，避免切换到同区域其他元素时闪烁
      blurTimerRef.current = setTimeout(() => setInputFocused(false), 100);
    }
  };

  // 监听 ESC 关闭侧边栏
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  // 冻结初始视口高度，防止键盘弹起时 dvh 变化导致整页收缩
  const [frozenHeight] = useState(() => window.innerHeight);

  // 横向滑动手势：任意位置右滑拉出侧边栏、左滑收回
  const { ref: swipeRef, dragging, dragOffset, shouldSuppressClick } = useDrawerSwipe({
    width: SIDEBAR_WIDTH,
    open: sidebarOpen,
    onOpenChange: setSidebarOpen,
    onSettle: () => haptic(),
  });

  // 拖动中用实时位移接管 transform / 遮罩透明度，松手后交还 CSS class
  const progress = dragOffset === null ? (sidebarOpen ? 1 : 0) : dragOffset / SIDEBAR_WIDTH;
  const transition = dragging ? 'none' : undefined;

  return (
    <div
      ref={swipeRef}
      className="bg-[#121211] text-white overflow-hidden fixed inset-x-0 top-0"
      style={{ height: frozenHeight, touchAction: 'manipulation' }}
    >
      {/* 侧边栏 - 绝对定位左侧底层，平时收起在屏幕外 */}
      <div
        className={`absolute top-0 left-0 bottom-0 z-0 transition-transform duration-250 ease-out bg-[#121211] ${
          dragOffset === null ? (sidebarOpen ? 'translate-x-0' : '-translate-x-full') : ''
        }`}
        style={{
          width: `${SIDEBAR_WIDTH}px`,
          transform: dragOffset === null ? undefined : `translateX(${dragOffset - SIDEBAR_WIDTH}px)`,
          transition,
        }}
      >
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSwitchConversation={(id) => { onSwitchConversation?.(id); setSidebarOpen(false); }}
          onNewConversation={onNewConversation}
          onDeleteConversation={onDeleteConversation}
          onDeleteConversations={onDeleteConversations}
          onToggleConversationFavorite={onToggleConversationFavorite}
          onRenameConversation={onRenameConversation}
        />
      </div>

      {/* 内容区 - 全宽，translateX 推出，右侧被 overflow-hidden 裁剪 */}
      <div
        className="h-full flex flex-col relative z-10 transition-transform duration-250 ease-out"
        style={{
          transform: dragOffset !== null
            ? `translateX(${dragOffset}px)`
            : sidebarOpen ? `translateX(${SIDEBAR_WIDTH}px)` : undefined,
          transition,
        }}
        onFocus={handleFocusIn}
        onBlur={handleFocusOut}
      >
        {/* 侧边栏打开时主内容区变暗遮罩 */}
        <div
          className={`absolute inset-0 bg-black/50 z-20 transition-opacity duration-250 ${
            progress > 0 ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          style={{ opacity: progress, transition }}
          onClick={() => {
            // 吞掉横滑手势结束时紧随的 click，否则刚拉开就被遮罩关掉
            if (shouldSuppressClick()) return;
            setSidebarOpen(false);
          }}
        />

        {/* 顶部导航栏 */}
        {models && selectedModel && onModelChange && (
          <TopNavBar
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            models={models}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            onNewConversation={onNewConversation}
            webSearchEnabled={webSearchEnabled}
            onWebSearchToggle={onWebSearchToggle}
            artifactEnabled={artifactEnabled}
            onArtifactToggle={onArtifactToggle}
          />
        )}
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
        {/* 底部导航栏 */}
        {!inputFocused && <BottomNavBar activeTab={activeTab} onTabChange={onTabChange} />}
      </div>
    </div>
  );
}
