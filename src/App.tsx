import { useState, useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import ChatPanel from './components/chat/ChatPanel';
import ImagePanel from './components/image/ImagePanel';
import SettingsPanel from './components/settings/SettingsPanel';
import FavoritesPanel from './components/artifact/FavoritesPanel';
import { useChat } from './hooks/useChat';
import { useFavoriteArtifacts } from './hooks/useFavoriteArtifacts';
import { CHAT_MODELS } from './config/models';
import { loadTheme } from './services/storage';
import type { TabMode } from './types';

function App() {
  // 应用启动时加载主题
  useEffect(() => {
    const theme = loadTheme();
    document.documentElement.dataset.theme = theme;
  }, []);

  const [activeTab, setActiveTab] = useState<TabMode>('chat');

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
          />
        );
      case 'image':
        return <ImagePanel />;
      case 'favorites':
        return <FavoritesPanel favorites={favorites} onRemoveFavorite={removeFavorite} />;
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
        onDeleteConversation={chat.deleteConversation}
        onRenameConversation={chat.renameConversation}
        models={activeTab === 'chat' ? CHAT_MODELS : undefined}
        selectedModel={activeTab === 'chat' ? (activeConversation?.selectedModel || CHAT_MODELS[0].id) : undefined}
        onModelChange={activeTab === 'chat' ? chat.setSelectedModel : undefined}
      >
        {renderContent()}
      </MainLayout>
    </>
  );
}

export default App;
