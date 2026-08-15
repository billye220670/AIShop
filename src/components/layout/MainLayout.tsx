import { useEffect, useState, useRef, type ReactNode } from 'react';
import Sidebar, { SIDEBAR_WIDTH } from './Sidebar';
import TopNavBar from './TopNavBar';
import BottomNavBar from './BottomNavBar';
import DesktopLayout from './DesktopLayout';
import { useDeviceMode } from '../../platform/useDeviceMode';
import type { TabMode, Conversation, Model, ContextSegment } from '../../types';
import type { RoleData } from '../../db';
import type { UsageTotals } from '../../utils/tokenEstimate';
import { useDrawerSwipe } from '../../hooks/useDrawerSwipe';
import { haptic } from '../../utils/haptics';
import { syncFocusedInputType } from '../../utils/androidBridge';
import { isNativePlatform } from '../../platform/capabilities';

export interface MainLayoutProps {
  activeTab: TabMode;
  onTabChange: (tab: TabMode) => void;
  children: ReactNode;
  conversations?: Conversation[];
  activeConversationId?: string;
  onSwitchConversation?: (id: string) => void;
  onNewConversation?: () => void;
  /** 当前会话是否已有消息；没有时新建按钮置灰禁用 */
  canCreateNewConversation?: boolean;
  onDeleteConversation?: (id: string) => void;
  onDeleteConversations?: (ids: string[]) => void;
  onToggleConversationFavorite?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  /** BYOC 同步完成后重载会话列表（透传给 Sidebar） */
  onRefreshConversations?: () => Promise<void> | void;
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
  // 角色设置
  roles?: RoleData[];
  selectedRoleId?: string;
  onRoleSelect?: (roleId: string) => void;
  onRolesChanged?: () => void;
  // 上下文占用（顶栏环状指示器）
  realUsage?: UsageTotals;
  contextLimit?: number;
  isCompacting?: boolean;
  isAwaitingUsage?: boolean;
  onCompactActive?: () => void;
  segments?: ContextSegment[];
  onOpenSegment?: (segmentId: string) => void;
  onDeleteSegment?: (segmentId: string) => void;
  /** 侧边栏打开时回调（用于触发同步等） */
  onSidebarOpen?: () => void;
}

/** 移动端布局：抽屉侧边栏 + 顶栏 + 底部导航（原 MainLayout 实现） */
function MobileLayout(props: MainLayoutProps) {
  const {
    activeTab,
    onTabChange,
    children,
    conversations,
    activeConversationId,
    onSwitchConversation,
    onNewConversation,
    canCreateNewConversation = true,
    onDeleteConversation,
    onDeleteConversations,
    onToggleConversationFavorite,
    onRenameConversation,
    onRefreshConversations,
    models,
    selectedModel,
    onModelChange,
    webSearchEnabled,
    onWebSearchToggle,
    artifactEnabled,
    onArtifactToggle,
    roles,
    selectedRoleId,
    onRoleSelect,
    onRolesChanged,
    realUsage,
    contextLimit,
    isCompacting,
    isAwaitingUsage,
    onCompactActive,
    segments,
    onOpenSegment,
    onDeleteSegment,
    onSidebarOpen,
  } = props;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 可编辑元素（输入框/文本域/富文本）聚焦：隐藏底部菜单栏并处理键盘遮挡
  const isEditable = (el: HTMLElement) =>
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;

  // 输入框若位于键盘遮挡区，滚动到可见位置（键盘高度由 MainActivity 注入）
  const scrollIntoKeyboardView = (el: HTMLElement) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--native-ime-inset-bottom');
    const ime = parseInt(raw) || 0;
    if (ime <= 0) return;
    const rect = el.getBoundingClientRect();
    const visibleBottom = window.innerHeight - ime;
    if (rect.bottom > visibleBottom - 8 || rect.top < 0) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  // 检测输入框聚焦，隐藏底部菜单栏
  const handleFocusIn = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement;
    if (!isEditable(target)) return;
    if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
    setInputFocused(true);
    // 同步当前输入框类型给原生层（AndroidInputState 桥），密码框长按菜单分流用
    syncFocusedInputType(target as HTMLInputElement);
    // 聊天输入框（TEXTAREA）已有底部 padding 顶起机制，不需要滚动；
    // 设置页等普通输入框主动滚出键盘遮挡区。键盘动画期间 inset 才注入完成，
    // 立即滚一次 + 300ms 后校正一次。
    if (target.tagName !== 'TEXTAREA') {
      scrollIntoKeyboardView(target);
      setTimeout(() => scrollIntoKeyboardView(target), 300);
    }
  };

  const handleFocusOut = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement;
    if (!isEditable(target)) return;
    // 延迟隐藏，避免切换到同区域其他元素时闪烁
    blurTimerRef.current = setTimeout(() => {
      setInputFocused(false);
      syncFocusedInputType(null);
    }, 100);
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

  // Android 壳返回键：侧边栏打开时先关闭并消费事件（否则由 App 层最小化到后台）
  useEffect(() => {
    if (!sidebarOpen) return;
    const onBackRequested = (e: Event) => {
      e.preventDefault();
      setSidebarOpen(false);
    };
    window.addEventListener('back-requested', onBackRequested);
    return () => window.removeEventListener('back-requested', onBackRequested);
  }, [sidebarOpen]);

  // 侧边栏打开时通知上层（触发同步等）
  useEffect(() => {
    if (sidebarOpen) onSidebarOpen?.();
  }, [sidebarOpen, onSidebarOpen]);

  // Android 壳：冻结初始视口高度，防止键盘弹起时 dvh 变化导致整页收缩；
  // iOS Safari/PWA 键盘为覆盖式不改视口，但地址栏收起/展开会动态改变 innerHeight，
  // 冻结会导致底部导航栏偶发被屏幕底边裁掉，故 iOS 走 dvh 动态高度（见下方 style）
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
      className="bg-[var(--color-bg-base)] text-[var(--color-text-primary)] overflow-hidden fixed inset-x-0 top-0 h-[100dvh]"
      style={{
        // Android 壳：键盘弹起视口收缩，必须用冻结高度；其他平台（iOS PWA/Safari）用
        // dvh 实时跟随地址栏展开收起，避免底部导航栏被屏幕底边裁剪（固定 innerHeight 会与动态视口错位）
        height: isNativePlatform() ? frozenHeight : undefined,
        touchAction: 'manipulation',
        // 原生壳（Capacitor）edge-to-edge 全屏渲染：顶部避让系统状态栏，padding 区即页面背景色；
        // 高度由 MainActivity 原生注入的 --native-inset-top 提供（getInfo/env() 在 Android 16 不可靠）
        ...(isNativePlatform() ? { paddingTop: 'var(--native-inset-top, var(--status-bar-height, env(safe-area-inset-top)))' } : {}),
      }}
    >
      {/* 侧边栏 - 绝对定位左侧底层，平时收起在屏幕外 */}
      <div
        className={`absolute top-0 left-0 bottom-0 z-0 transition-transform duration-250 ease-out bg-[var(--color-bg-base)] ${
          dragOffset === null ? (sidebarOpen ? 'translate-x-0' : '-translate-x-full') : ''
        }`}
        style={{
          width: `${SIDEBAR_WIDTH}px`,
          transform: dragOffset === null ? undefined : `translateX(${dragOffset - SIDEBAR_WIDTH}px)`,
          transition,
          // 侧边栏 absolute 定位不随根容器 padding 下移，需自身避让状态栏
          ...(isNativePlatform() ? { paddingTop: 'var(--native-inset-top, var(--status-bar-height, env(safe-area-inset-top)))' } : {}),
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
          onRefreshConversations={onRefreshConversations}
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
          // Android 壳：键盘（IME）弹起时视口不收缩，底部让出键盘高度把输入框顶到键盘上方，
          // 避免依赖 Chromium 的视觉滚动兜底（偶发导致整个页面被顶起）；键盘高度由 MainActivity 实时注入
          ...(isNativePlatform() ? { paddingBottom: 'var(--native-ime-inset-bottom, 0px)' } : {}),
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
            canCreateNewConversation={canCreateNewConversation}
            webSearchEnabled={webSearchEnabled}
            onWebSearchToggle={onWebSearchToggle}
            artifactEnabled={artifactEnabled}
            onArtifactToggle={onArtifactToggle}
            roles={roles}
            selectedRoleId={selectedRoleId}
            onRoleSelect={onRoleSelect}
            onRolesChanged={onRolesChanged}
            realUsage={realUsage}
            contextLimit={contextLimit}
            isCompacting={isCompacting}
            isAwaitingUsage={isAwaitingUsage}
            onCompactActive={onCompactActive}
            segments={segments}
            onOpenSegment={onOpenSegment}
            onDeleteSegment={onDeleteSegment}
            conversationId={activeConversationId}
          />
        )}
        <main className="flex-1 flex flex-col overflow-hidden" data-swipe-ignore={(activeTab === 'me' || activeTab === 'library') ? true : undefined}>{children}</main>
        {/* 底部导航栏 */}
        {!inputFocused && <BottomNavBar activeTab={activeTab} onTabChange={onTabChange} />}
      </div>
    </div>
  );
}

/** 布局分发外壳：按设备形态在桌面/移动布局间切换，两套布局共用同一份 Props */
export default function MainLayout(props: MainLayoutProps) {
  const mode = useDeviceMode();
  if (mode === 'desktop') {
    return <DesktopLayout {...props} />;
  }
  return <MobileLayout {...props} />;
}
