import { useState } from 'react';
import MainLayout from './components/layout/MainLayout';
import ChatPanel from './components/chat/ChatPanel';
import HistoryPanel from './components/chat/HistoryPanel';
import ImagePanel from './components/image/ImagePanel';
import VideoPanel from './components/video/VideoPanel';
import MusicPanel from './components/music/MusicPanel';
import AccessGate from './components/auth/AccessGate';
import { useChat } from './hooks/useChat';
import { CHAT_MODELS } from './config/models';
import type { TabMode } from './types';

function App() {
  const [activeTab, setActiveTab] = useState<TabMode>('chat');
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
            sendMessage={chat.sendMessage}
            stopGeneration={chat.stopGeneration}
            conversationTitle={conversationTitle}
            conversation={activeConversation}
            onImportConversation={chat.importConversation}
            onInputFocusChange={setInputFocused}
            onToggleHistory={() => setHistoryOpen(v => !v)}
            onNewConversation={chat.newConversation}
            selectedModel={activeConversation?.selectedModel || CHAT_MODELS[0].id}
            onModelChange={chat.setSelectedModel}
            models={CHAT_MODELS}
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
        onModelChange={chat.setSelectedModel}
        mobileDrawerOpen={mobileDrawerOpen}
        setMobileDrawerOpen={setMobileDrawerOpen}
        inputFocused={inputFocused}
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
      />
    </AccessGate>
  );
}

export default App;
