import { useState, useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import ChatPanel from './components/chat/ChatPanel';
import HistoryPanel from './components/chat/HistoryPanel';
import ImagePanel from './components/image/ImagePanel';
import VideoPanel from './components/video/VideoPanel';
import MusicPanel from './components/music/MusicPanel';
import SettingsPanel from './components/settings/SettingsPanel';
import FavoritesPanel from './components/artifact/FavoritesPanel';
import UpdateNotification from './components/common/UpdateNotification';
import { useChat } from './hooks/useChat';
import { useFavoriteArtifacts } from './hooks/useFavoriteArtifacts';
import { CHAT_MODELS } from './config/models';
import { loadTheme } from './services/storage';
import type { TabMode } from './types';

// 标题栏颜色映射表
const titleBarColors: Record<string, { bg: string; symbol: string }> = {
  purple: { bg: '#0d0a1a', symbol: '#ffffff' },
  green: { bg: 'rgb(18, 18, 17)', symbol: '#e0e0e0' },
};

function App() {
  // 应用启动时加载主题
  useEffect(() => {
    const theme = loadTheme();
    document.documentElement.dataset.theme = theme;
    if (window.electronAPI?.updateTitleBarColor) {
      const colors = titleBarColors[theme] || titleBarColors.green;
      window.electronAPI.updateTitleBarColor(colors.bg, colors.symbol);
    }
  }, []);

  const [activeTab, setActiveTab] = useState<TabMode>('chat');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  // 监听自动更新下载完成事件
  useEffect(() => {
    if (!window.electronAPI?.onUpdateDownloaded) return;
    window.electronAPI.onUpdateDownloaded(() => {
      setUpdateReady(true);
    });
  }, []);
  const chat = useChat();
  const { favorites, isFavorite, toggleFavorite, removeFavorite } = useFavoriteArtifacts();

  const activeConversation = chat.conversations.find(
    c => c.id === chat.activeConversationId
  );
  const conversationTitle = activeConversation?.title ?? '';

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
            selectedModel={activeConversation?.selectedModel || CHAT_MODELS[0].id}
            onModelChange={chat.setSelectedModel}
            models={CHAT_MODELS}
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
          />
        );
      case 'image':
        return <ImagePanel />;
      case 'video':
        return <VideoPanel />;
      case 'music':
        return <MusicPanel />;
      case 'favorites':
        return <FavoritesPanel favorites={favorites} onRemoveFavorite={removeFavorite} />;
      default:
        return null;
    }
  };

  return (
    <>
      <MainLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        onSwitchConversation={chat.switchConversation}
        onNewConversation={chat.newConversation}
        onDeleteConversation={chat.deleteConversation}
        onRenameConversation={chat.renameConversation}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {renderContent()}
      </MainLayout>

      {/* History panel at App level - fixed positioning, not clipped by any parent */}
      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        onSwitchConversation={chat.switchConversation}
        onDelete={chat.deleteConversation}
        onRename={chat.renameConversation}
      />

      {/* Settings panel */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 自动更新通知 */}
      <UpdateNotification open={updateReady} onClose={() => setUpdateReady(false)} />
    </>
  );
}

export default App;
