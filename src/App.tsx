import { useState, useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import ChatPanel from './components/chat/ChatPanel';
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
    </>
  );
}

export default App;
