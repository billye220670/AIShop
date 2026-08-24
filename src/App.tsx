import { useState, useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import MainLayout from './components/layout/MainLayout';
import ChatPanel from './components/chat/ChatPanel';
import HistoryPanel from './components/chat/HistoryPanel';
import ImagePanel from './components/image/ImagePanel';
import SettingsPanel from './components/settings/SettingsPanel';
import LibraryPanel from './components/artifact/LibraryPanel';
import Toast from './components/common/Toast';
import UpdateNotification from './components/common/UpdateNotification';
import { useChat } from './hooks/useChat';
import { useAssets } from './hooks/useAssets';
import { CHAT_MODELS } from './config/models';
import { loadTheme, loadMode } from './services/storage';
import { syncElectronTitleBar } from './utils/electronTitleBar';
import { requestPersistentStorage } from './utils/pwa';
import { scheduleAutoSync, safeSync, BYOC_SYNC_DONE_EVENT } from './services/byoc';
import { useDeviceMode } from './platform/useDeviceMode';
import { isElectron, isNativePlatform } from './platform/capabilities';
import { POST_IMAGE_MESSAGE_EVENT } from './services/imageContextActions';
import { messageCountOf } from './utils/conversationView';
import { getPlainText } from './utils/messageText';
import type { TabMode } from './types';

function App() {
  // 应用启动时加载主题与亮/暗模式
  useEffect(() => {
    const theme = loadTheme();
    const mode = loadMode();
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;
    // 平台标记：Electron 桌面端弹出上下文菜单时背景不做模糊（CSS 按此标记禁用 backdrop-filter）
    document.documentElement.dataset.platform = isElectron() ? 'electron' : '';
    // 同步浏览器工具栏颜色（需要适配颜色主题）
    const meta = document.getElementById('meta-theme-color') as HTMLMetaElement | null;
    if (meta) {
      const darkColor = theme === 'purple' ? '#0d0a1a' : '#121211';
      meta.content = mode === 'light' ? '#f5f5f7' : darkColor;
    }
    // Electron：窗口标题栏 overlay 颜色跟随主题/模式（Web 下为 no-op）
    syncElectronTitleBar(theme, mode);
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

  // Electron：新版本下载完成提示 + 启动静默检查更新（开发环境无发布源，失败静默）
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.onUpdateDownloaded(() => setUpdateReady(true));
    api.checkForUpdate().catch(() => { /* 静默 */ });
  }, []);

  // Electron：target=_blank 外链交给系统默认浏览器打开（Web 下 electronAPI 不存在，不影响原生行为）
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
      if (a && a.target === '_blank' && window.electronAPI?.openExternal) {
        e.preventDefault();
        void window.electronAPI.openExternal(a.href);
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  // Electron：主进程转发的 Ctrl+F → 切回对话 Tab 并递增信号，ChatPanel 据此打开搜索栏
  const [findSignal, setFindSignal] = useState(0);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onFindRequested) return;
    return api.onFindRequested(() => {
      setActiveTab('chat');
      setFindSignal(s => s + 1);
    });
  }, []);

  const chat = useChat();
  const { assets, isSaved, toggleArtifact, removeAsset, renameAsset, saveMarkdown, saveImage, refresh: refreshAssets } = useAssets();

  // 图片处理（高清放大 / 去背景）的结果插入当前会话：接收图片上下文菜单发来的事件，交给 useChat 追加一条 AI 图片消息
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ title: string; urls: string[] }>).detail;
      if (detail && Array.isArray(detail.urls) && detail.urls.length > 0) {
        chat.postImageMessage(detail.title, detail.urls);
      }
    };
    window.addEventListener(POST_IMAGE_MESSAGE_EVENT, handler);
    return () => window.removeEventListener(POST_IMAGE_MESSAGE_EVENT, handler);
  }, [chat.postImageMessage]);

  // 聊天内生成的图片自动存入「我的库」：按消息 id 去重（同一消息只入库一次），
  // 入库链路复用 useAssets.saveImage——其内部落库后触发 3 秒防抖 BYOC 同步，即"合适的同步时机"
  const savedChatImageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const conv of chat.conversations) {
      for (const msg of conv.messages) {
        const images = msg.generatedImages;
        if (!images || images.length === 0) continue;
        if (savedChatImageIdsRef.current.has(msg.id)) continue;
        savedChatImageIdsRef.current.add(msg.id);
        saveImage({
          id: `chat-img-${msg.id}`,
          urls: images,
          prompt: msg.generatedImage?.prompt || getPlainText(msg.content) || '聊天生成图片',
          model: msg.generatedImage?.model || '',
          timestamp: msg.timestamp,
        });
      }
    }
  }, [chat.conversations, saveImage]);

  // BYOC 同步完成后自动刷新会话/角色/资产列表（三者都可能从云端拉到/被删除）
  useEffect(() => {
    const handler = () => {
      void chat.reloadConversations();
      void chat.refreshRoles();
      void refreshAssets();
    };
    window.addEventListener(BYOC_SYNC_DONE_EVENT, handler);
    return () => window.removeEventListener(BYOC_SYNC_DONE_EVENT, handler);
  }, [chat.reloadConversations, chat.refreshRoles, refreshAssets]);

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
            isFavorite={chat.streamingArtifact ? false : (() => { const msgs = chat.messages; for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].artifact) return isSaved(msgs[i].artifact!.id); } return false; })()}
            onToggleFavorite={(thumbnail) => { const msgs = chat.messages; for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].artifact) { toggleArtifact(msgs[i].artifact!, thumbnail); return; } } }}
            onSaveMarkdown={(messageId, title, content) => saveMarkdown(messageId, title, content)}
            segments={chat.segments}
            onUpdateSegment={(segmentId, summary) => { if (chat.activeConversationId) chat.updateSegment(chat.activeConversationId, segmentId, summary); }}
            openSegmentIdRequest={openSegmentIdRequest}
            onOpenSegmentIdRequestHandled={() => setOpenSegmentIdRequest(null)}
            findSignal={findSignal}
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
      case 'library':
        return <LibraryPanel assets={assets} onRemoveAsset={removeAsset} onRenameAsset={renameAsset} />;
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
        onToggleConversationHidden={chat.toggleConversationHidden}
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
      {/* Electron：自动更新就绪提示 */}
      {window.electronAPI && (
        <UpdateNotification open={updateReady} onClose={() => setUpdateReady(false)} />
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
          onToggleConversationHidden={chat.toggleConversationHidden}
          onRenameConversation={chat.renameConversation}
          onRefreshConversations={chat.reloadConversations}
        />
      )}
    </>
  );
}

export default App;
