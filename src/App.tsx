import { useState } from 'react';
import MainLayout from './components/layout/MainLayout';
import ChatPanel from './components/chat/ChatPanel';
import ImagePanel from './components/image/ImagePanel';
import VideoPanel from './components/video/VideoPanel';
import MusicPanel from './components/music/MusicPanel';
import AccessGate from './components/auth/AccessGate';
import { useChat } from './hooks/useChat';
import type { TabMode } from './types';

function App() {
  const [activeTab, setActiveTab] = useState<TabMode>('chat');
  const chat = useChat();

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
            selectedModel={chat.selectedModel}
            setSelectedModel={chat.setSelectedModel}
            sendMessage={chat.sendMessage}
            stopGeneration={chat.stopGeneration}
            error={chat.error}
            conversationTitle={conversationTitle}
            webSearchEnabled={chat.webSearchEnabled}
            setWebSearchEnabled={chat.setWebSearchEnabled}
            conversation={activeConversation}
            onImportConversation={chat.importConversation}
          />
        );
      case 'image':
        return <ImagePanel />;
      case 'video':
        return <VideoPanel />;
      case 'music':
        return <MusicPanel />;
      default:
        return null;
    }
  };

  return (
    <AccessGate>
      <MainLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        onSwitchConversation={chat.switchConversation}
        onNewConversation={chat.newConversation}
        onDeleteConversation={chat.deleteConversation}
        onRenameConversation={chat.renameConversation}
      >
        {renderContent()}
      </MainLayout>
    </AccessGate>
  );
}

export default App;
