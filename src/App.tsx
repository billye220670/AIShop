import { useState, useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import MainLayout from './components/layout/MainLayout';
import ChatPanel from './components/chat/ChatPanel';
import HistoryPanel from './components/chat/HistoryPanel';
import ImagePanel from './components/image/ImagePanel';
import SettingsPanel from './components/settings/SettingsPanel';
import FavoritesPanel from './components/artifact/FavoritesPanel';
import Toast from './components/common/Toast';
import { useChat } from './hooks/useChat';
import { useFavoriteArtifacts } from './hooks/useFavoriteArtifacts';
import { CHAT_MODELS } from './config/models';
import { loadTheme, loadMode } from './services/storage';
import { requestPersistentStorage } from './utils/pwa';
import { scheduleAutoSync, safeSync, BYOC_SYNC_DONE_EVENT } from './services/byoc';
import { useDeviceMode } from './platform/useDeviceMode';
import { isNativePlatform } from './platform/capabilities';
import { messageCountOf } from './utils/conversationView';
import type { TabMode } from './types';

function App() {
  // 应用启动时加载主题与亮/暗模式
  useEffect(() => {
    const theme = loadTheme();
    const mode = loadMode();
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;
    // 同步浏览器工具栏颜色（需要适配颜色主题）
    const meta = document.getElementById('meta-theme-color') as HTMLMetaElement | null;
    if (meta) {
      const darkColor = theme === 'purple' ? '#0d0a1a' : '#121211';
      meta.content = mode === 'light' ? '#f5f5f7' : darkColor;
    }
    // Android 壳：状态栏颜色与文字明暗跟随应用主题
    if (isNativePlatform()) {
      const darkColor = theme === 'purple' ? '#0d0a1a' : '#121211';
      void StatusBar.setStyle({ style: mode === 'light' ? Style.Dark : Style.Light });
      void StatusBar.setBackgroundColor({ color: mode === 'light' ? '#f5f5f7' : darkColor });
      // 读取真实状态栏高度（dp，Android WebView 中 1dp = 1 css px）注入 CSS 变量：
      // edge-to-edge 下 env(safe-area-inset-top) 在 WebView 中不可靠，必须显式获取
      void StatusBar.getInfo().then(info => {
        if (info.height > 0) {
          document.documentElement.style.setProperty('--status-bar-height', `${info.height}px`);
        }
      });
    }
  }, []);

  // Android 壳返回键：先发事件给布局层关闭已打开的 UI（侧边栏等），未消费则最小化到后台
  useEffect(() => {
    if (!isNativePlatform()) return;
    const listener = CapApp.addListener('backButton', () => {
      const evt = new CustomEvent('back-requested', { cancelable: true });
      if (!window.dispatchEvent(evt)) return; // 已消费：布局层关闭了某个面板
      void CapApp.minimizeApp();
    });
    return () => {
      void listener.then(l => l.remove());
    };
  }, []);

  // 申请持久化存储，降低数据被系统回收的概率。
  // 安卓/桌面 Chrome 在站点有一定使用度后通常会给；Safari 一律拒绝，
  // 那不是错误——iOS 上只能靠装到主屏幕和导出备份兜底。
  useEffect(() => {
    void requestPersistentStorage();
    // BYOC 自动同步：启动延迟拉取 + 周期推送 + 回前台拉取（内部检查配置）
    scheduleAutoSync();
  }, []);

  const [activeTab, setActiveTab] = useState<TabMode>('chat');
  // 桌面模式右侧历史记录面板开关
  const [historyOpen, setHistoryOpen] = useState(false);
  const mode = useDeviceMode();

  const chat = useChat();
  const { favorites, isFavorite, toggleFavorite, removeFavorite, renameFavorite } = useFavoriteArtifacts();

  // BYOC 同步完成后自动刷新会话列表与角色列表（角色可能从云端拉到/被删除）
  useEffect(() => {
    const handler = () => {
      void chat.reloadConversations();
      void chat.refreshRoles();
    };
    window.addEventListener(BYOC_SYNC_DONE_EVENT, handler);
    return () => window.removeEventListener(BYOC_SYNC_DONE_EVENT, handler);
  }, [chat.reloadConversations, chat.refreshRoles]);

  // 桌面模式历史面板打开时主动同步一次（与移动端抽屉侧边栏打开行为一致）
  useEffect(() => {
    if (historyOpen) void safeSync();
  }, [historyOpen]);

  const activeConversation = chat.conversations.find(
    c => c.id === chat.activeConversationId
  );
  const conversationTitle = activeConversation?.title ?? '';

  // 顶栏「立即压缩」的结果反馈：toast + 点击「查看」跳到对应摘要面板
  const [compactToast, setCompactToast] = useState<{ message: string; type: 'success' | 'error'; segmentId?: string } | null>(null);
  const [openSegmentIdRequest, setOpenSegmentIdRequest] = useState<string | null>(null);

  const handleCompactActive = async () => {
    if (!chat.activeConversationId) return;
    const segment = await chat.compactConversation(chat.activeConversationId);
    if (segment) {
      setCompactToast({
        message: `已压缩 ${segment.messageCount} 条消息`,
        type: 'success',
        segmentId: segment.id,
      });
    } else {
      setCompactToast({ message: '暂无可压缩内容', type: 'error' });
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'chat':
        return (
          <ChatPanel
            messages={chat.messages}
            isLoading={chat.isLoading}
            sendMessage={chat.sendMessage}
            stopGeneration={chat.stopGeneration}
            conversationTitle={conversationTitle}
            conversation={activeConversation}
            onToggleHistory={() => setHistoryOpen(v => !v)}
            onNewConversation={chat.newConversation}
            streamingArtifact={chat.streamingArtifact}
            regenerateMessage={chat.regenerateMessage}
            featureSettings={chat.featureSettings}
            onFeatureSettingsChange={chat.setFeatureSettings}
            compareWithModel={chat.compareWithModel}
            switchVersion={chat.switchVersion}
            webSearchEnabled={chat.webSearchEnabled}
            onWebSearchEnabledChange={chat.setWebSearchEnabled}
            isFavorite={chat.streamingArtifact ? false : (() => { const msgs = chat.messages; for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].artifact) return isFavorite(msgs[i].artifact!.id); } return false; })()}
            onToggleFavorite={(thumbnail) => { const msgs = chat.messages; for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].artifact) { toggleFavorite(msgs[i].artifact!, thumbnail); return; } } }}
            segments={chat.segments}
            onUpdateSegment={(segmentId, summary) => { if (chat.activeConversationId) chat.updateSegment(chat.activeConversationId, segmentId, summary); }}
            openSegmentIdRequest={openSegmentIdRequest}
            onOpenSegmentIdRequestHandled={() => setOpenSegmentIdRequest(null)}
            models={CHAT_MODELS}
            selectedModel={activeConversation?.selectedModel || CHAT_MODELS[0].id}
            onModelChange={chat.setSelectedModel}
            roles={chat.roles}
            selectedRoleId={chat.selectedRoleId}
            onRoleSelect={chat.setSelectedRole}
            onRolesChanged={chat.refreshRoles}
            realUsage={chat.realUsageTotals}
            contextLimit={chat.contextUsage.limit}
            isCompacting={chat.isCompacting}
            isAwaitingUsage={chat.isLoading}
            onCompactActive={handleCompactActive}
            onOpenSegment={setOpenSegmentIdRequest}
            onDeleteSegment={(segmentId) => { if (chat.activeConversationId) chat.revertSegment(chat.activeConversationId, segmentId); }}
          />
        );
      case 'image':
        return <ImagePanel />;
      case 'favorites':
        return <FavoritesPanel favorites={favorites} onRemoveFavorite={removeFavorite} onRenameFavorite={renameFavorite} />;
      case 'me':
        return <SettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <>
      <MainLayout
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        onSwitchConversation={chat.switchConversation}
        onNewConversation={chat.newConversation}
        canCreateNewConversation={activeConversation ? messageCountOf(activeConversation) > 0 : true}
        onDeleteConversation={chat.deleteConversation}
        onDeleteConversations={chat.deleteConversations}
        onToggleConversationFavorite={chat.toggleConversationFavorite}
        onRenameConversation={chat.renameConversation}
        onRefreshConversations={chat.reloadConversations}
        realUsage={activeTab === 'chat' ? chat.realUsageTotals : undefined}
        contextLimit={activeTab === 'chat' ? chat.contextUsage.limit : undefined}
        isCompacting={chat.isCompacting}
        isAwaitingUsage={activeTab === 'chat' ? chat.isLoading : false}
        onCompactActive={handleCompactActive}
        segments={activeTab === 'chat' ? chat.segments : undefined}
        onOpenSegment={setOpenSegmentIdRequest}
        onDeleteSegment={(segmentId) => { if (chat.activeConversationId) chat.revertSegment(chat.activeConversationId, segmentId); }}
        onSidebarOpen={() => void safeSync()}
        models={activeTab === 'chat' ? CHAT_MODELS : undefined}
        selectedModel={activeTab === 'chat' ? (activeConversation?.selectedModel || CHAT_MODELS[0].id) : undefined}
        onModelChange={activeTab === 'chat' ? chat.setSelectedModel : undefined}
        webSearchEnabled={activeTab === 'chat' ? chat.webSearchEnabled : undefined}
        onWebSearchToggle={activeTab === 'chat' ? () => chat.setWebSearchEnabled(!chat.webSearchEnabled) : undefined}
        artifactEnabled={activeTab === 'chat' ? chat.featureSettings.artifactEnabled : undefined}
        onArtifactToggle={activeTab === 'chat' ? () => chat.setFeatureSettings({ ...chat.featureSettings, artifactEnabled: !chat.featureSettings.artifactEnabled }) : undefined}
        roles={activeTab === 'chat' ? chat.roles : undefined}
        selectedRoleId={activeTab === 'chat' ? chat.selectedRoleId : undefined}
        onRoleSelect={activeTab === 'chat' ? chat.setSelectedRole : undefined}
        onRolesChanged={activeTab === 'chat' ? chat.refreshRoles : undefined}
      >
        {renderContent()}
      </MainLayout>
      {compactToast && (
        <Toast
          message={compactToast.message}
          type={compactToast.type}
          duration={4000}
          onClose={() => setCompactToast(null)}
          action={
            compactToast.segmentId
              ? { label: '查看', onClick: () => setOpenSegmentIdRequest(compactToast.segmentId!) }
              : undefined
          }
        />
      )}
      {/* 桌面模式右侧历史记录面板（fixed 定位挂在 App 层，不受布局裁剪；移动端仍用抽屉侧边栏） */}
      {mode === 'desktop' && (
        <HistoryPanel
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          conversations={chat.conversations}
          activeConversationId={chat.activeConversationId}
          onSwitchConversation={(id) => {
            // 历史会话属于聊天：切换时回到聊天模式并收起面板
            setActiveTab('chat');
            chat.switchConversation(id);
            setHistoryOpen(false);
          }}
          onNewConversation={chat.newConversation}
          onDeleteConversation={chat.deleteConversation}
          onDeleteConversations={chat.deleteConversations}
          onToggleConversationFavorite={chat.toggleConversationFavorite}
          onRenameConversation={chat.renameConversation}
          onRefreshConversations={chat.reloadConversations}
        />
      )}
    </>
  );
}

export default App;
