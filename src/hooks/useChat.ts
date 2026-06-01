import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, Conversation, FileAttachment, MessageContent } from '../types';
import { streamChat } from '../services/api';
import { CHAT_MODELS } from '../config/models';
import {
  parseArtifactFromContent,
  getDisplayContentWithoutArtifact,
  isArtifactStreaming,
} from './useArtifact';
import {
  loadConversations,
  saveConversations,
  createConversation,
  saveLastModel,
  loadLastModel,
  saveWebSearchEnabled,
  loadWebSearchEnabled,
} from '../services/storage';
import { generateTitle } from '../services/titleGenerator';
import { searchWeb, formatSearchResultsForContext } from '../services/webSearch';

function getLastUsedModel(): string {
  return loadLastModel() || CHAT_MODELS[0].id;
}

function parseSuggestions(content: string): { text: string; suggestions: string[] } {
  // 格式1：完整标记对 <<<SUGGESTIONS>>>...<<<END_SUGGESTIONS>>>
  const fullRegex = /<<<SUGGESTIONS>>>\s*([\s\S]*?)\s*<<<END_SUGGESTIONS>>>/;
  const fullMatch = content.match(fullRegex);
  if (fullMatch) {
    const suggestions = fullMatch[1]
      .split('|||')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const text = content.replace(fullRegex, '').trimEnd();
    return { text, suggestions };
  }

  // 格式2：只有开始标记没有结束标记 <<<SUGGESTIONS>>> 内容（到文本末尾）
  const startOnlyRegex = /<<<SUGGESTIONS>>>\s*([\s\S]*)$/;
  const startMatch = content.match(startOnlyRegex);
  if (startMatch) {
    const suggestions = startMatch[1]
      .split('|||')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const text = content.replace(startOnlyRegex, '').trimEnd();
    if (suggestions.length > 0) {
      return { text, suggestions };
    }
  }

  return { text: content, suggestions: [] };
}

// 用于流式显示时隐藏建议标记，避免 <<<SUGGESTIONS>>> 等中间状态闪现给用户
function getDisplayContent(content: string): string {
  // 先去除 artifact 标记
  let cleaned = getDisplayContentWithoutArtifact(content);

  // 如果正在流式生成 artifact，用提示代替
  if (isArtifactStreaming(content)) {
    const startMarker = '<<<ARTIFACT_START>>>';
    const startIdx = content.indexOf(startMarker);
    cleaned = content.substring(0, startIdx).trimEnd();
    cleaned += '\n\n✨ 正在生成网页...';
  }

  // 一旦看到完整开始标记，截断标记及其后所有内容
  const suggestionsMarker = '<<<SUGGESTIONS>>>';
  const startIdx = cleaned.indexOf(suggestionsMarker);
  if (startIdx !== -1) {
    return cleaned.substring(0, startIdx).trimEnd();
  }
  // 处理标记正在逐字出现的部分匹配：<, <<, <<<, <<<S, <<<SU, ...
  for (let i = Math.min(suggestionsMarker.length - 1, cleaned.length); i >= 1; i--) {
    const partial = suggestionsMarker.substring(0, i);
    if (cleaned.endsWith(partial)) {
      return cleaned.substring(0, cleaned.length - i);
    }
  }
  return cleaned;
}

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const saved = loadConversations();
    if (saved.length === 0) {
      const initial = createConversation(getLastUsedModel());
      return [initial];
    }
    return saved;
  });
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = loadConversations();
    if (saved.length > 0) return saved[0].id;
    return conversations[0].id;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabledState] = useState<boolean>(() => loadWebSearchEnabled());
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeConversation = conversations.find(c => c.id === activeId) || conversations[0];
  const messages = activeConversation?.messages || [];
  const selectedModel = activeConversation?.selectedModel || CHAT_MODELS[0].id;

  // 持久化到 localStorage
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  const updateActiveConversation = useCallback(
    (updater: (conv: Conversation) => Conversation) => {
      setConversations(prev => prev.map(c => (c.id === activeId ? updater(c) : c)));
    },
    [activeId]
  );

  const setSelectedModel = useCallback(
    (modelId: string) => {
      updateActiveConversation(conv => ({ ...conv, selectedModel: modelId, updatedAt: Date.now() }));
      saveLastModel(modelId);
    },
    [updateActiveConversation]
  );

  const setWebSearchEnabled = useCallback((enabled: boolean) => {
    setWebSearchEnabledState(enabled);
    saveWebSearchEnabled(enabled);
  }, []);

  // 异步触发标题生成（fire-and-forget）
  const triggerTitleGeneration = useCallback((conv: Conversation) => {
    const convId = conv.id;
    const msgs = conv.messages.map(m => ({ role: m.role, content: m.content }));
    generateTitle(msgs)
      .then(title => {
        if (!title) return;
        setConversations(prev =>
          prev.map(c =>
            c.id === convId && !c.isRenamed
              ? { ...c, title, updatedAt: Date.now() }
              : c
          )
        );
      })
      .catch(() => { /* 静默失败 */ });
  }, []);

  const sendMessage = useCallback(
    async (
      content:
        | string
        | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>,
      attachments?: FileAttachment[]
    ) => {
      setError(null);

      const userMessage: Message = {
        id: Date.now().toString() + '-user',
        role: 'user',
        content,
        timestamp: Date.now(),
        attachments,
      };

      const assistantMessage: Message = {
        id: Date.now().toString() + '-assistant',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      // 追加用户与占位的 assistant 消息
      updateActiveConversation(conv => {
        const newMessages = [...conv.messages, userMessage, assistantMessage];
        return { ...conv, messages: newMessages, updatedAt: Date.now() };
      });

      setIsLoading(true);

      // 移动端的触觉反馈 - AI 开始回答时触发两次清脆有力的振动
      if ('vibrate' in navigator) {
        setTimeout(() => {
          navigator.vibrate([50, 30, 50]); // 双重短振：50ms 振动 + 30ms 暂停 + 50ms 振动
        }, 100);
      }

      try {
        abortControllerRef.current = new AbortController();

        // 构建带文件上下文的消息用于 API 发送
        let apiContent: string | MessageContent[] = content;
        if (attachments && attachments.length > 0) {
          let fileContext = '';
          attachments.forEach(f => {
            fileContext += `[用户上传了文档「${f.name}」，以下是文档内容]\n---\n${f.textContent}\n---\n\n`;
          });

          if (typeof content === 'string') {
            apiContent = fileContext + content;
          } else {
            // MessageContent[] 模式（含图片时）
            apiContent = (content as MessageContent[]).map(item => {
              if (item.type === 'text') {
                return { ...item, text: fileContext + (item.text || '') };
              }
              return item;
            });
          }
        }

        const apiUserMessage: Message = { ...userMessage, content: apiContent };
        const allMessages = [...messages, apiUserMessage];

        // 联网搜索（可选）
        let searchContext = '';
        let searchSources: Array<{ name: string; url: string; siteName: string }> = [];
        let searchFailed = false;
        if (webSearchEnabled) {
          const userText =
            typeof content === 'string'
              ? content
              : content.find((p) => p.type === 'text')?.text || '';
          if (userText) {
            try {
              const results = await searchWeb(userText);
              if (results.length > 0) {
                searchContext = formatSearchResultsForContext(results);
                searchSources = results.map((r) => ({
                  name: r.name,
                  url: r.url,
                  siteName: r.siteName,
                }));
              } else {
                // 搜索返回空结果（无论是网络错误还是没搜到），标记为失败
                searchFailed = true;
              }
            } catch {
              searchFailed = true;
            }
          }
        }

        let fullContent = '';
        for await (const chunk of streamChat(
          allMessages,
          selectedModel,
          abortControllerRef.current.signal,
          searchContext || undefined
        )) {
          fullContent += chunk;
          const displayContent = getDisplayContent(fullContent);
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const lastIdx = updated.length - 1;
            updated[lastIdx] = { ...updated[lastIdx], content: displayContent };
            return { ...conv, messages: updated };
          });
        }

        // 移动端的触觉反馈 - AI 回答结束时再触发两次清脆有力的振动
        if ('vibrate' in navigator) {
          setTimeout(() => {
            navigator.vibrate([50, 30, 50]); // 双重短振：50ms 振动 + 30ms 暂停 + 50ms 振动
          }, 100);
        }

        updateActiveConversation(conv => {
          const updated = [...conv.messages];
          const lastIdx = updated.length - 1;
          // 先去除 artifact 标记，再解析 suggestions
          const contentWithoutArtifact = getDisplayContentWithoutArtifact(fullContent);
          const { text, suggestions } = parseSuggestions(contentWithoutArtifact);
          const artifact = parseArtifactFromContent(fullContent);
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: text,
            isStreaming: false,
            suggestions,
            artifact: artifact || undefined,
            webSearched: searchSources.length > 0,
            searchResults: searchSources.length > 0 ? searchSources : undefined,
            webSearchFailed: searchFailed,
          };
          return { ...conv, messages: updated, updatedAt: Date.now() };
        });
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        setError(err.message || '请求失败');
        updateActiveConversation(conv => {
          const updated = [...conv.messages];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: '⚠️ 请求失败: ' + (err.message || '未知错误'),
            isStreaming: false,
          };
          return { ...conv, messages: updated };
        });
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, selectedModel, updateActiveConversation, webSearchEnabled]
  );

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }, []);

  const clearMessages = useCallback(() => {
    updateActiveConversation(conv => ({
      ...conv,
      messages: [],
      title: '新对话',
      updatedAt: Date.now(),
    }));
    setError(null);
  }, [updateActiveConversation]);

  const renameConversation = useCallback((id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setConversations(prev =>
      prev.map(c =>
        c.id === id ? { ...c, title: trimmed, isRenamed: true, updatedAt: Date.now() } : c
      )
    );
  }, []);

  const newConversation = useCallback(() => {
    const currentConv = conversations.find(c => c.id === activeId);

    // 当前是空会话，不需要新建，保持现状即可
    if (currentConv && currentConv.messages.length === 0) {
      return;
    }

    // 离开前触发标题生成（如果满足条件）
    if (currentConv && !currentConv.isRenamed && currentConv.messages.length > 0 && currentConv.title === '新对话') {
      triggerTitleGeneration(currentConv);
    }

    const conv = createConversation(getLastUsedModel());
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    setError(null);
  }, [conversations, activeId, triggerTitleGeneration]);

  const switchConversation = useCallback((id: string) => {
    // 离开前触发标题生成（如果满足条件）
    const currentConv = conversations.find(c => c.id === activeId);
    if (currentConv && !currentConv.isRenamed && currentConv.messages.length > 0 && currentConv.title === '新对话') {
      triggerTitleGeneration(currentConv);
    }

    setActiveId(id);
    setError(null);
  }, [conversations, activeId, triggerTitleGeneration]);

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations(prev => {
        const filtered = prev.filter(c => c.id !== id);
        if (filtered.length === 0) {
          const newConv = createConversation(getLastUsedModel());
          if (activeId === id) setActiveId(newConv.id);
          return [newConv];
        }
        if (activeId === id) {
          setActiveId(filtered[0].id);
        }
        return filtered;
      });
    },
    [activeId]
  );

  // 导入会话（来自 .aishop.json 文件）
  const importConversation = useCallback((convData: Partial<Conversation>) => {
    const rawMessages = Array.isArray(convData.messages) ? convData.messages : [];
    // 清理流式状态，避免导入后显示异常
    const sanitizedMessages: Message[] = rawMessages.map(m => ({
      ...m,
      isStreaming: false,
    }));

    const imported: Conversation = {
      id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
      title: convData.title || '导入的对话',
      messages: sanitizedMessages,
      selectedModel: convData.selectedModel || CHAT_MODELS[0].id,
      createdAt: convData.createdAt || Date.now(),
      updatedAt: Date.now(),
      isRenamed: convData.isRenamed ?? true,
    };

    setConversations(prev => [imported, ...prev]);
    setActiveId(imported.id);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    selectedModel,
    setSelectedModel,
    error,
    sendMessage,
    stopGeneration,
    clearMessages,
    webSearchEnabled,
    setWebSearchEnabled,
    // 会话管理
    conversations,
    activeConversationId: activeId,
    newConversation,
    switchConversation,
    deleteConversation,
    renameConversation,
    importConversation,
  };
}
