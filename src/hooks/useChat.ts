import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, MessageVersion, Conversation, FileAttachment, MessageContent, ChatFeatureSettings, ContextSegment, ContextSummary, TokenUsage } from '../types';
import { streamChat } from '../services/api';
import { haptic } from '../utils/haptics';
import { CHAT_MODELS } from '../config/models';
import { BASE_SYSTEM_PROMPT, ARTIFACT_PROMPT, WEB_SEARCH_PROMPT, buildContextInfo } from '../config/prompts';
import {
  parseArtifactFromContent,
  getDisplayContentWithoutArtifact,
  isArtifactStreaming,
  extractStreamingArtifact,
} from './useArtifact';
import {
  saveLastModel,
  loadLastModel,
  saveWebSearchEnabled,
  loadWebSearchEnabled,
  saveLastActiveConversationId,
  loadLastActiveConversationId,
  saveSelectedRoleId,
  loadSelectedRoleId,
} from '../services/storage';
import {
  loadConversationList,
  createAndPersistConversation,
  hydrateConversation,
  loadOlderMessages,
  persistConversation,
  flushPendingWrites,
} from '../services/conversationStore';
import {
  deleteConversation as dbDeleteConversation,
  newConversationId,
  getAllMessages,
  listRoles,
} from '../db';
import type { RoleData } from '../db';
import { generateTitle } from '../services/titleGenerator';
import { searchWeb, formatSearchResultsForContext } from '../services/webSearch';
import { judgeSearchNeed } from '../services/searchJudge';
import { judgeImageIntent } from '../services/imageIntentJudge';
import {
  generateViaPix2Real,
  PIX2REAL_MODEL_ID,
  PIX2REAL_PROVIDER,
  PIX2REAL_MAX_IMAGES,
  Pix2RealClarificationError,
} from '../services/pix2realApi';
import { AUTO_MODEL_ID, ROUTER_MODEL, judgeRoute, quickAnswer } from '../services/routeJudge';
import { optimizeImagePrompt } from '../services/promptOptimizer';
import { generateImage as apiGenerateImage, processImage as apiProcessImage, type ImageProcessKind } from '../services/imageApi';
import { ensureCity, prefetchCity } from '../services/locationService';
import { settingsService } from '../services/settingsService';
import { syncNow, getByocConfig, validateConfig, recordLocalDeletions, recordLocalRoleDeletions, BYOC_SYNC_DONE_EVENT } from '../services/byoc';
import { compactMessages } from '../services/contextCompactor';
import { buildApiMessages } from '../utils/buildApiMessages';
import { monotonicNow } from '../utils/monotonic';
import { planCompaction, getContextUsage, isCompactionViable } from '../utils/compactPlan';
import { estimateMessagesTokens, estimateSummaryTokens, sumRealUsage } from '../utils/tokenEstimate';
import { migrateSummary } from '../utils/contextSummary';
import { messageCountOf } from '../utils/conversationView';
import { inlineBlobsForApi } from '../db';

/** 聊天内生成图片默认使用的模型：Nanobanana 2（速度快、成本低，够日常出图） */
const CHAT_IMAGE_MODEL = 'gemini-3.1-flash';
/** 聊天内生成图片失败时的确认回复兜底文案（正常由小模型生成） */
const CHAT_IMAGE_REPLY_FALLBACK = '好的，我来为你生成图片～';
/** 聊天内图片编辑（用户带图改图）的确认回复兜底文案（正常由小模型生成） */
const CHAT_IMAGE_EDIT_REPLY_FALLBACK = '好的，我来为您做出对应修改～';

/** 聊天内编辑生图支持的比例（与 gemini-3.1-flash 编辑接口 aspect_ratio 支持列表一致，含超宽/超长比例） */
const EDIT_ASPECT_RATIOS = [
  '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9',
];

/** 从编辑接口支持的比例列表里选与目标宽高比最接近的一个 */
function closestAspectRatio(width: number, height: number): string {
  const target = width / height;
  let best = '1:1';
  let bestDiff = Infinity;
  for (const ratio of EDIT_ASPECT_RATIOS) {
    const [rw, rh] = ratio.split(':').map(Number);
    if (!rw || !rh) continue;
    const diff = Math.abs(rw / rh - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ratio;
    }
  }
  return best;
}

/** 按图片最长边选最接近的 Gemini 输出尺寸等级（0.5K≈512px / 1K≈1024px / 2K≈2048px / 4K≈4096px，相邻等级中点分界） */
function sizeForMaxEdge(maxEdge: number): string {
  if (maxEdge <= 768) return '0.5K';
  if (maxEdge <= 1536) return '1K';
  if (maxEdge <= 3072) return '2K';
  return '4K';
}

/** 读取第一张图片的像素尺寸（aishop-blob:/data:/http 均可），失败返回 null */
async function getFirstImageSize(urls: string[]): Promise<{ width: number; height: number } | null> {
  try {
    const inlined = await inlineBlobsForApi(
      urls.map(url => ({ type: 'image_url' as const, image_url: { url } }))
    );
    const first = (Array.isArray(inlined) ? inlined : []).find(
      p => p.type === 'image_url' && p.image_url?.url
    );
    const url = first && first.type === 'image_url' ? first.image_url?.url : undefined;
    if (!url) return null;
    return await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } catch {
    return null;
  }
}

function getLastUsedModel(): string {
  return loadLastModel() || CHAT_MODELS[0].id;
}

function buildSystemPrompt(
  artifactEnabled: boolean,
  webSearchEnabled: boolean,
  modelId: string,
  role: RoleData | null
): string {
  const modelName = CHAT_MODELS.find(m => m.id === modelId)?.name;
  const contextInfo = buildContextInfo(modelName);
  if (!role) {
    // 默认角色（PortAI）：完整能力已内置在系统提示词里，只按 artifact 开关拼接
    const base = artifactEnabled ? BASE_SYSTEM_PROMPT + '\n\n' + ARTIFACT_PROMPT : BASE_SYSTEM_PROMPT;
    return contextInfo + '\n\n' + base;
  }
  // 自定义角色：system prompt 完全用角色的提示词，再按功能开关
  // 把 artifact / 全网搜索的能力提示词动态拼接到后面
  const parts = [role.systemPrompt];
  if (artifactEnabled) parts.push(ARTIFACT_PROMPT);
  if (webSearchEnabled) parts.push(WEB_SEARCH_PROMPT);
  return contextInfo + '\n\n' + parts.join('\n\n');
}

// 智能清理过度使用的反引号：只保留真正的代码/技术内容
function cleanExcessiveBackticks(content: string): string {
  // 保护代码块（```），不处理
  const codeBlocks: string[] = [];
  let cleaned = content.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // 处理行内反引号：移除明显不应该是代码的内容
  // 规则：如果反引号内容是中文为主的长句（>15字）或包含标点密集的描述性文本，则移除反引号
  cleaned = cleaned.replace(/`([^`\n]{1,200})`/g, (match, inner) => {
    // 保留：纯英文、短内容、包含特殊字符（代码特征）
    if (
      inner.length <= 15 ||
      /^[a-zA-Z0-9_\-./\\:]+$/.test(inner) || // 文件名、函数名、命令
      /[<>{}[\]()=>$#]/.test(inner) || // 代码符号
      /^[a-zA-Z]+\(/.test(inner) // 函数调用
    ) {
      return match; // 保留原始反引号
    }

    // 移除：中文长句、描述性文本
    const chineseCount = (inner.match(/[一-龥]/g) || []).length;
    if (chineseCount > 5 || inner.length > 30) {
      return inner; // 移除反引号
    }

    return match; // 默认保留
  });

  // 恢复代码块
  codeBlocks.forEach((block, i) => {
    cleaned = cleaned.replace(`__CODE_BLOCK_${i}__`, block);
  });

  return cleaned;
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
  // IndexedDB 是异步的，所以初始为空，由下面的启动 effect 填充。
  // 期间 activeConversation 为 undefined，各处已有 ?. 兜底。
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isBooting, setIsBooting] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabledState] = useState<boolean>(() => loadWebSearchEnabled());
  const [roles, setRoles] = useState<RoleData[]>([]);
  // 上一次加载的角色列表快照：refreshRoles 用它检测创建/删除等变更，null = 首次加载
  const rolesRef = useRef<RoleData[] | null>(null);
  const [selectedRoleId, setSelectedRoleIdState] = useState<string>(() => loadSelectedRoleId());
  const [streamingArtifact, setStreamingArtifact] = useState<{ title: string; code: string } | null>(null);
  const [featureSettings, setFeatureSettings] = useState<ChatFeatureSettings>(() => {
    const saved = localStorage.getItem('chat-feature-settings');
    const parsed = saved ? JSON.parse(saved) : {};
    return {
      artifactEnabled: parsed.artifactEnabled ?? true,
      autoCompactEnabled: parsed.autoCompactEnabled ?? true,
    };
  });
  const [compactSettings, setCompactSettingsState] = useState(() =>
    settingsService.getCompactSettings()
  );
  const [compactingId, setCompactingId] = useState<string | null>(null);
  /** 对话变更信号（自增计数）：非 0 时触发变更后自动同步，防抖合并多次变更 */
  const [pendingSyncTick, setPendingSyncTick] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeConversation = conversations.find(c => c.id === activeId) || conversations[0];
  const messages = activeConversation?.messages || [];
  const selectedModel = activeConversation?.selectedModel || CHAT_MODELS[0].id;

  // 供 async 回调读取最新会话，避免把 conversations 放进依赖导致回调频繁重建
  const conversationsRef = useRef(conversations);
  /** 智能路由兜底：auto 之前最近一次实际使用的具体模型 id（判断/直答失败时回落目标） */
  const lastConcreteModelRef = useRef<string>('');
  /** 上一次落盘的版本，用于 diff 出真正变化的消息 */
  const persistedRef = useRef<Map<string, Conversation>>(new Map());

  /**
   * 启动：读会话列表（只含元数据），优先恢复上次停留的会话。
   *
   * 手机上切后台一段时间后系统很可能直接杀掉进程，下次打开其实是冷启动，
   * 会重新跑一遍这个 effect——所以这里要能把用户拉回切出去前的那个会话，
   * 而不是每次都扔进一个新对话。找不到（比如那个会话被删了）才回退到
   * 复用空会话/新建的老逻辑。
   *
   * 复用已有的空会话而不是无脑新建，否则反复启动会攒下一堆空记录。
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let list = await loadConversationList();
        if (cancelled) return;

        const lastId = loadLastActiveConversationId();
        let activeConv = lastId ? list.find(c => c.id === lastId) : undefined;

        // 上次那个会话有实际内容才值得恢复，加载它最近的消息
        if (activeConv && messageCountOf(activeConv) > 0) {
          try {
            const { messages, segments, totalMessageCount, hasMore } =
              await hydrateConversation(activeConv.id);
            if (cancelled) return;
            activeConv = {
              ...activeConv,
              messages,
              segments,
              totalMessageCount,
              hasMoreMessages: hasMore,
              hydrated: true,
            };
          } catch (e) {
            console.error('[useChat] 恢复上次会话失败，回退到新对话', e);
            activeConv = undefined;
          }
        } else {
          activeConv = undefined; // 不是有效目标（没找到 / 是空会话），走下面的兜底逻辑重新选
        }

        if (!activeConv) {
          // 列表按 lastMessageAt 倒序，空会话的 lastMessageAt 就是它的创建时间，
          // 所以真有空会话的话它就在最前面。
          const reusable = list.find(c => messageCountOf(c) === 0);
          activeConv = reusable;
          if (!activeConv) {
            activeConv = await createAndPersistConversation(getLastUsedModel());
            if (cancelled) return;
            list = [activeConv, ...list];
          }
        }
        // 未加载消息的兜底会话（新建的/复用的空会话）直接标记为已加载，省掉一次查库
        if (!activeConv.hydrated) {
          activeConv = { ...activeConv, messages: [], segments: [], hydrated: true, hasMoreMessages: false };
        }

        const activeId = activeConv.id;
        list = list.map(c => (c.id === activeId ? activeConv : c));

        // 记下初始快照，避免启动后立刻把刚读出来的内容又整体写回一遍
        persistedRef.current = new Map(list.map(c => [c.id, c]));
        conversationsRef.current = list;
        setConversations(list);
        setActiveId(activeId);
        // 界面已经可用，先解除 booting 再做补标题这类后台收尾，
        // 否则持久化 effect 会一直停摆。
        setIsBooting(false);

        // 补齐漏掉的标题。标题生成本来挂在「离开会话」上，但刷新页面/冷启动不经过
        // switchConversation，如果刚好停在一个还没生成过标题的会话上，它就永远
        // 不会被「离开」一次，标题会永久卡在「新对话」。这里扫一遍补上。
        const needTitle = list.filter(
          c => !c.isRenamed && c.title === '新对话' && messageCountOf(c) > 0
        );
        for (const conv of needTitle) {
          if (cancelled) return;
          try {
            // 历史会话的消息此时还没加载，单独取
            const msgs = conv.messages.length
              ? conv.messages
              : await getAllMessages(conv.id);
            if (!msgs.length) continue;
            const title = await generateTitle(
              msgs.map(m => ({ role: m.role, content: m.content }))
            );
            if (cancelled || !title) continue;
            setConversations(prev =>
              prev.map(c => (c.id === conv.id && !c.isRenamed ? { ...c, title } : c))
            );
          } catch {
            /* 静默失败，下次启动再试 */
          }
        }
      } catch (e) {
        console.error('[useChat] 启动加载失败', e);
        setError('加载对话记录失败');
      } finally {
        if (!cancelled) setIsBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 启动后台预热：IP 定位用户城市并写缓存，让首次发消息时系统提示词就能带上城市
  useEffect(() => {
    prefetchCity();
  }, []);

  /**
   * 持久化：diff 出变化的部分定向写入。
   *
   * 原实现是每次 state 变化就把所有会话 JSON.stringify 后同步写 localStorage，
   * 历史一长就在流式输出时卡主线程。
   */
  useEffect(() => {
    conversationsRef.current = conversations;
    if (isBooting) return;

    let changed = false;
    for (const conv of conversations) {
      const prev = persistedRef.current.get(conv.id);
      if (prev === conv) continue;
      persistedRef.current.set(conv.id, conv);
      // 刚新建还没开始聊的空会话不构成变更，不触发同步
      if (!prev && conv.messages.length === 0) continue;
      changed = true;
      void persistConversation(prev, conv).catch(e =>
        console.error('[useChat] 持久化失败', e)
      );
    }
    // 删除的会话由 deleteConversation 直接操作库，这里只需清理快照
    const alive = new Set(conversations.map(c => c.id));
    for (const id of persistedRef.current.keys()) {
      if (!alive.has(id)) persistedRef.current.delete(id);
    }

    // 对话发生真实变更（发消息/标题/重命名/收藏/压缩等）→ 防抖触发一次 BYOC 同步
    if (changed) setTimeout(() => setPendingSyncTick(t => t + 1), 0);
  }, [conversations, isBooting]);

  // 记住当前停留的会话，切后台被系统杀掉进程后冷启动也能恢复回来
  useEffect(() => {
    if (isBooting || !activeId) return;
    saveLastActiveConversationId(activeId);
  }, [activeId, isBooting]);

  // 切后台/关页面前把挂起的流式内容立刻写掉，避免安卓上切走应用丢失长回复
  useEffect(() => {
    const flush = () => { void flushPendingWrites(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // 持久化 featureSettings
  useEffect(() => {
    localStorage.setItem('chat-feature-settings', JSON.stringify(featureSettings));
  }, [featureSettings]);

  // 设置面板直接改 localStorage，这里响应它的通知重读
  useEffect(() => {
    const reload = () => {
      try {
        const raw = localStorage.getItem('chat-feature-settings');
        if (raw) {
          const parsed = JSON.parse(raw);
          setFeatureSettings(prev => ({ ...prev, ...parsed }));
        }
      } catch { /* ignore */ }
      setCompactSettingsState(settingsService.getCompactSettings());
    };
    window.addEventListener('aishop:feature-settings-changed', reload);
    return () => window.removeEventListener('aishop:feature-settings-changed', reload);
  }, []);

  // 角色列表：启动时加载；创建/删除/云同步后由外部调 refreshRoles 重读。
  // 加载时对比上次快照：检测到本地角色变更（创建/删除）就记删除 tombstone
  // 并触发防抖同步，让角色像会话一样创建后 3 秒内自动上云、删除自动传播。
  const refreshRoles = useCallback(async () => {
    try {
      const list = await listRoles();
      setRoles(list);
      const prev = rolesRef.current;
      if (prev) {
        const removed = prev.filter(r => !list.some(c => c.id === r.id)).map(r => r.id);
        const changed =
          list.length !== prev.length ||
          list.some((r, i) => {
            const p = prev[i];
            return !p || p.name !== r.name || p.systemPrompt !== r.systemPrompt || p.createdAt !== r.createdAt;
          });
        if (removed.length) void recordLocalRoleDeletions(removed);
        if (removed.length || changed) setPendingSyncTick(t => t + 1);
      }
      rolesRef.current = list;
    } catch (e) {
      console.warn('[roles] 角色列表加载失败', e);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refreshRoles(), 0);
    return () => clearTimeout(t);
  }, [refreshRoles]);

  // 切换角色：同步写 localStorage（空串 = 默认角色 PortAI）
  const setSelectedRole = useCallback((roleId: string) => {
    setSelectedRoleIdState(roleId);
    saveSelectedRoleId(roleId);
  }, []);

  /**
   * 重新从 IndexedDB 读会话列表（BYOC 手动同步后调用，刷新侧栏数据）。
   * 列表只含元数据；当前会话额外 hydrate，让云端拉取的新消息进入内存。
   * 同步后的列表作为新的落盘基准，避免持久化 diff 把刚拉取的内容再写回。
   *
   * 两个防护：
   * 1. 先 flush 挂起的落盘再读库——persist 是 fire-and-forget，若在写入未完成时
   *    读库，新会话的 messageCount 还是 0，会被当成空会话从侧栏过滤掉。
   * 2. 无条件 hydrate 当前会话并把内存中尚未落盘的消息合并回来，避免"库快照
   *    替换内存"时把刚发的消息弄丢（侧栏立即消失、当前对话变空白）。
   */
  const reloadConversations = useCallback(async () => {
    await flushPendingWrites();
    const list = await loadConversationList();
    const active = list.find(c => c.id === activeId);
    let result = list;
    if (active) {
      try {
        const { messages, segments, totalMessageCount } =
          await hydrateConversation(active.id);
        // 内存版优先：流式中的消息（isStreaming 中间态、未落盘的 dataURL 图片）
        // 一定比库里的快照新，库版只补云端有而内存没有的消息。
        // 注意不能反过来——库里读回的消息 isStreaming 恒为 false（该字段不落盘），
        // 用它替换内存会把正在流式的回复打成"圆点消失+空白"，直到下一 chunk 才恢复。
        const mem = conversationsRef.current.find(c => c.id === activeId);
        const merged = [...(mem?.messages ?? [])];
        const seen = new Set(merged.map(m => m.id));
        for (const m of messages) {
          if (!seen.has(m.id)) merged.push(m);
          seen.add(m.id);
        }
        merged.sort((a, b) => a.timestamp - b.timestamp);
        const total = Math.max(totalMessageCount, merged.length);
        result = list.map(c =>
          c.id === active.id
            ? { ...c, messages: merged, segments, totalMessageCount: total, hasMoreMessages: merged.length < total, hydrated: true }
            : c
        );
      } catch (e) {
        console.warn('[useChat] 同步后刷新当前会话失败', e);
      }
    }
    persistedRef.current = new Map(result.map(c => [c.id, c]));
    conversationsRef.current = result;
    setConversations(result);
  }, [activeId]);

  /**
   * 变更后自动同步（BYOC）：对话数据一变就防抖触发，3 秒内合并多次变更成一次。
   * 动作与侧栏「同步」按钮一致：先拉后推 + 重载会话列表。
   * 未启用/配置不完整时跳过，scheduleAutoSync 的 60 秒轮询继续兜底。
   *
   * 原本「跳过即放弃」的两种情形改为短间隔重试，避免一等就是 60 秒轮询：
   * - 流式进行中：3 秒后重新挂号，直到流式结束（等效于流式一结束就补同步）；
   * - 同步失败：最多重试 2 次（间隔 3 秒），再往后才交给 60 秒轮询。
   */
  const syncRetryRef = useRef(0);
  useEffect(() => {
    if (pendingSyncTick === 0) return;
    const timer = setTimeout(() => {
      // 流式进行中（含带图请求的上传与等待首 token）不抢带宽：同步会
      // 抢占移动端带宽拖垮大请求体，reloadConversations 还会用库里快照
      // 替换正在流式的内存状态。但也不放弃：3 秒后重新挂号，流式结束自然补上。
      if (abortControllerRef.current) {
        setPendingSyncTick(t => t + 1);
        return;
      }
      const cfg = getByocConfig();
      if (!cfg.enabled || validateConfig(cfg)) return;
      void (async () => {
        try {
          // 先排空落盘写链，避免推送时读到"消息还没写入"的中间态
          await flushPendingWrites();
          await syncNow(cfg);
          await reloadConversations();
          // 这一轮同步同样可能拉到别端的资产/角色/图片历史，
          // 不广播的话「我的库」与角色列表不会刷新（只有 safeSync 会发）。
          window.dispatchEvent(new CustomEvent(BYOC_SYNC_DONE_EVENT));
          syncRetryRef.current = 0;
        } catch (e) {
          console.warn('[useChat] 变更后自动同步失败', e);
          // 失败短间隔重试：最多补 2 次，之后交给 60 秒轮询兜底
          if (syncRetryRef.current < 2) {
            syncRetryRef.current += 1;
            setPendingSyncTick(t => t + 1);
          } else {
            syncRetryRef.current = 0;
          }
        }
      })();
    }, 3000);
    return () => clearTimeout(timer);
  }, [pendingSyncTick, reloadConversations]);

  const updateActiveConversation = useCallback(
    (updater: (conv: Conversation) => Conversation) => {
      setConversations(prev => prev.map(c => (c.id === activeId ? updater(c) : c)));
    },
    [activeId]
  );

  /**
   * 按会话 + 消息 id 精确定位打补丁。
   *
   * 生图是异步完成的，期间用户可能已切到别的会话——updateActiveConversation
   * 绑定的是发起时的 activeId，此时会写到错误的目标上。这里用显式 id 定位，
   * 无论用户切到哪，结果都回到生成它的那条消息。
   */
  const patchMessage = useCallback((convId: string, msgId: string, patch: Partial<Message>) => {
    setConversations(prev =>
      prev.map(c => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.map(m => (m.id === msgId ? { ...m, ...patch } : m)),
          updatedAt: Date.now(),
        };
      })
    );
  }, []);

  /**
   * 往当前会话追加一条 AI 图片消息（结果图片以 generatedImages 形式回显，与聊天生图一致）。
   * 图片上下文菜单的"高清处理 / 去除背景"结果经此插入会话；落盘由 conversations 持久化 effect 自动完成，
   * 且 App 层的存库 effect 会把带 generatedImages 的消息自动收录进「我的库」。
   */
  const postImageMessage = useCallback(
    (title: string, urls: string[]) => {
      if (!urls || urls.length === 0) return;
      updateActiveConversation(conv => {
        const now = monotonicNow();
        const msg: Message = {
          id: `${now}-image`,
          role: 'assistant',
          content: title,
          timestamp: now,
          isStreaming: false,
          generatedImages: urls,
          // 智能路由下记录回落模型，避免消息 model 出现 'auto' 伪 id
          model: selectedModel === AUTO_MODEL_ID
            ? (lastConcreteModelRef.current || CHAT_MODELS[0].id)
            : selectedModel,
        };
        return { ...conv, messages: [...conv.messages, msg], updatedAt: Date.now() };
      });
    },
    [updateActiveConversation, selectedModel]
  );

  const setSelectedModel = useCallback(
    (modelId: string) => {
      updateActiveConversation(conv => ({ ...conv, selectedModel: modelId, updatedAt: Date.now() }));
      saveLastModel(modelId);
      if (modelId === AUTO_MODEL_ID) {
        // 切到智能路由：记住切换前的具体模型，路由判断失败时兜底用
        if (selectedModel !== AUTO_MODEL_ID) lastConcreteModelRef.current = selectedModel;
      } else {
        lastConcreteModelRef.current = modelId;
      }
    },
    [updateActiveConversation, selectedModel]
  );

  const setWebSearchEnabled = useCallback((enabled: boolean) => {
    setWebSearchEnabledState(enabled);
    saveWebSearchEnabled(enabled);
  }, []);

  // 正在生成标题的会话 id，避免同一会话在流式结束与离开会话两个时机并发重复触发
  const titlePendingRef = useRef<Set<string>>(new Set());

  // 异步触发标题生成（fire-and-forget）
  const triggerTitleGeneration = useCallback((conv: Conversation) => {
    const convId = conv.id;
    if (titlePendingRef.current.has(convId)) return;
    titlePendingRef.current.add(convId);
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
      .catch(() => { /* 静默失败 */ })
      .finally(() => {
        titlePendingRef.current.delete(convId);
      });
  }, []);

  /**
   * Pix2Real 生图分支：**提示词与参考图全程透传**。
   *
   * Pix2Real 服务端自己带 Grok 路由——它读用户原话来选工作流、补参数、必要时反问。
   * 前端再做一轮提示词优化会破坏它的判断依据，所以这里既不调 optimizeImagePrompt，
   * 也不拼「参考图说明」，更不挑比例/尺寸（这些都由服务端按工作流决定）。
   * 特殊处理（放大/抠图）同样交给服务端路由，不走 Fal 的 processImage 分支。
   *
   * 参考图顺序有语义（第一张主图、第二张脸图）：用户本条上传的图在前，
   * 需要延续上一张 AI 图时把它接在后面，与其余分支的顺序约定保持一致。
   */
  const runPix2RealGeneration = useCallback(
    async (args: {
      userText: string;
      reply?: string;
      editImages?: string[];
      editPrevious: boolean;
      messages: Message[];
      userMessage: Message;
      assistantMessage: Message;
      convId: string;
    }): Promise<void> => {
      const {
        userText, reply, editImages, editPrevious,
        messages: history, userMessage, assistantMessage, convId,
      } = args;
      const assistantMessageId = assistantMessage.id;

      let prevAiImages: string[] | undefined;
      if (editPrevious) {
        for (let i = history.length - 1; i >= 0; i--) {
          const m = history[i];
          if (m.role === 'assistant' && m.generatedImages && m.generatedImages.length > 0) {
            prevAiImages = m.generatedImages;
            break;
          }
        }
      }
      const hasEditImages = !!editImages && editImages.length > 0;
      const refSource = hasEditImages && editImages
        ? (editPrevious && prevAiImages ? [...editImages, ...prevAiImages] : editImages)
        : prevAiImages;

      const confirmReply = reply
        || (refSource && refSource.length > 0 ? CHAT_IMAGE_EDIT_REPLY_FALLBACK : CHAT_IMAGE_REPLY_FALLBACK);
      // prompt 记原话：这就是真正发给服务端的内容，回显时不该看到被改写过的版本
      const genMeta = { model: PIX2REAL_MODEL_ID, prompt: userText, aspectRatio: 'auto' };

      // 1) 先落确认回复，并在气泡下方挂起骨架
      updateActiveConversation(conv => {
        const updated = [...conv.messages];
        const lastIdx = updated.length - 1;
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: confirmReply,
          isStreaming: false,
          imageGenerating: true,
          generatedImage: genMeta,
        };
        return { ...conv, messages: updated, updatedAt: Date.now() };
      });

      // 新会话第一轮对聊完成，立即生成标题（与 LLM 流式完成后的行为一致）。
      // 用入参拼消息而不是读 conversationsRef：上面的 setState 可能还没落到 ref 上。
      if (history.length === 0) {
        const snapshot = conversationsRef.current.find(c => c.id === convId);
        if (snapshot && !snapshot.isRenamed && snapshot.title === '新对话') {
          triggerTitleGeneration({
            ...snapshot,
            messages: [
              ...history,
              userMessage,
              { ...assistantMessage, content: confirmReply, isStreaming: false },
            ],
          });
        }
      }

      // 2) 非阻塞发起生成，骨架期间保持显示
      void (async () => {
        try {
          // 参考图落盘后是 aishop-blob: 引用，先还原成 data URL 再透传
          let images: string[] = [];
          if (refSource && refSource.length > 0) {
            const inlined = await inlineBlobsForApi(
              refSource.map(url => ({ type: 'image_url' as const, image_url: { url } }))
            );
            images = (Array.isArray(inlined) ? inlined : [])
              .map(p => (p.type === 'image_url' ? p.image_url?.url || '' : ''))
              .filter(Boolean);
          }
          const result = await generateViaPix2Real(userText, images);
          // 服务端选了哪个工作流是有用信息，附在确认回复后面；
          // 超上限被丢掉的参考图也要明说，不能默默少传
          const notes: string[] = [];
          if (result.droppedImages > 0) {
            notes.push(`（Pix2Real 最多支持 ${PIX2REAL_MAX_IMAGES} 张参考图，已用前 ${PIX2REAL_MAX_IMAGES} 张）`);
          }
          if (result.reason) notes.push(result.reason);
          patchMessage(convId, assistantMessageId, {
            imageGenerating: false,
            generatedImages: result.urls,
            generatedImage: genMeta,
            ...(notes.length > 0 ? { content: `${confirmReply}\n\n${notes.join('\n')}` } : {}),
          });
        } catch (err) {
          // 服务端判定素材不足：把追问原样落成 AI 回复，不显示成生成失败
          if (err instanceof Pix2RealClarificationError) {
            patchMessage(convId, assistantMessageId, {
              imageGenerating: false,
              content: err.message,
              generatedImage: undefined,
            });
            return;
          }
          patchMessage(convId, assistantMessageId, {
            imageGenerating: false,
            imageGenerateError:
              err instanceof Error ? err.message : '图片生成失败，请稍后重试',
          });
        }
      })();
    },
    [updateActiveConversation, patchMessage, triggerTitleGeneration]
  );

  const setCompactSettings = useCallback((patch: Partial<typeof compactSettings>) => {
    settingsService.setCompactSettings(patch);
    setCompactSettingsState(settingsService.getCompactSettings());
  }, []);

  /**
   * 压缩指定会话的冷区间。返回是否真的压缩了。
   * 原文不删除，只打 compressedInto 标记并追加 segment。
   */
  const compactConversation = useCallback(
    async (convId: string): Promise<ContextSegment | null> => {
      const settings = settingsService.getCompactSettings();
      const conv = conversationsRef.current.find(c => c.id === convId);
      if (!conv) return null;

      const target = planCompaction(conv, settings.hotWindowSize);
      if (!target.length) return null;

      setCompactingId(convId);
      try {
        const result = await compactMessages(target, {
          focusHint: conv.compactFocusHint,
        });
        if (!result) return null;

        const segment: ContextSegment = {
          id: `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          fromMessageId: target[0].id,
          toMessageId: target[target.length - 1].id,
          messageCount: target.length,
          summary: result.summary,
          tokensBefore: estimateMessagesTokens(target),
          tokensAfter: estimateSummaryTokens(result.summary),
          model: result.model,
          createdAt: Date.now(),
          userEdited: false,
        };

        const targetIds = new Set(target.map(m => m.id));
        setConversations(prev =>
          prev.map(c => {
            if (c.id !== convId) return c;
            return {
              ...c,
              messages: c.messages.map(m =>
                targetIds.has(m.id) ? { ...m, compressedInto: segment.id } : m
              ),
              segments: [...(c.segments || []), segment],
            };
          })
        );
        return segment;
      } finally {
        setCompactingId(null);
      }
    },
    []
  );

  /** 用户手改摘要。改过之后该段不再被自动重压。 */
  const updateSegment = useCallback(
    (convId: string, segmentId: string, summary: ContextSummary) => {
      setConversations(prev =>
        prev.map(c => {
          if (c.id !== convId) return c;
          return {
            ...c,
            segments: (c.segments || []).map(s =>
              s.id === segmentId
                ? { ...s, summary, tokensAfter: estimateSummaryTokens(summary), userEdited: true }
                : s
            ),
          };
        })
      );
    },
    []
  );

  /** 撤销压缩，恢复原文。因为原文一直在，这里只是删标记。 */
  const revertSegment = useCallback((convId: string, segmentId: string) => {
    setConversations(prev =>
      prev.map(c => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.map(m =>
            m.compressedInto === segmentId ? { ...m, compressedInto: undefined } : m
          ),
          segments: (c.segments || []).filter(s => s.id !== segmentId),
        };
      })
    );
  }, []);

  const setCompactFocusHint = useCallback((convId: string, hint: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === convId ? { ...c, compactFocusHint: hint || undefined } : c))
    );
  }, []);

  const sendMessage = useCallback(
    async (
      content:
        | string
        | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>,
      attachments?: FileAttachment[]
    ) => {
      setError(null);

      // 发请求前检查水位。压缩失败不阻塞发送——宁可这轮贵一点，也不能卡住用户。
      // 拿返回的 segment 而不是回读 state：setState 未必已经刷新。
      let freshSegment: ContextSegment | null = null;
      if (featureSettings.autoCompactEnabled) {
        const conv = conversationsRef.current.find(c => c.id === activeId);
        if (conv) {
          // 智能路由下用回落模型做上下文估算（'auto' 会被保守估成 32000，误触发压缩）
          const compactModel = conv.selectedModel === AUTO_MODEL_ID
            ? (lastConcreteModelRef.current || CHAT_MODELS[0].id)
            : conv.selectedModel;
          const usage = getContextUsage(
            conv,
            compactModel,
            compactSettings.threshold,
            compactSettings.hotWindowSize
          );

          // 判断水位优先用上一轮的真实 promptTokens——它精确反映了上下文规模。
          // 只有还没有任何真实数据时（会话第一轮）才退回估算。
          const real = sumRealUsage(conv.messages, compactModel);
          const overThreshold =
            real.lastPromptTokens > 0
              ? real.lastPromptTokens / usage.limit >= compactSettings.threshold
              : usage.overThreshold;

          // 压完塞不进去就别压：热窗口是逐字发送的硬地板，压缩救不了
          // 「大上下文切小模型」这种落差，白花调用还毁掉 prompt 缓存。
          const viable = isCompactionViable(
            conv,
            compactModel,
            compactSettings.hotWindowSize,
            compactSettings.threshold
          );

          if (overThreshold && usage.compactable && viable) {
            freshSegment = await compactConversation(conv.id);
          }
        }
      }

      // 同一毫秒内 Date.now() 会返回相同值：user/assistant 的 timestamp 相等
      // 会让所有按 timestamp 的排序（同步后合并、预留的 by_conv_time 索引）
      // 失去区分度，id 前缀也会相同。用严格单调递增的时钟，保证
      // user < assistant 恒成立、id 恒唯一——排序在任何路径下都能纠错。
      const userNow = monotonicNow();
      const userMessage: Message = {
        id: userNow.toString() + '-user',
        role: 'user',
        content,
        timestamp: userNow,
        attachments,
      };

      const assistantNow = monotonicNow();
      const assistantMessage: Message = {
        id: assistantNow.toString() + '-assistant',
        role: 'assistant',
        content: '',
        timestamp: assistantNow,
        isStreaming: true,
        model: selectedModel,
      };

      // 追加用户与占位的 assistant 消息
      updateActiveConversation(conv => {
        const newMessages = [...conv.messages, userMessage, assistantMessage];
        return { ...conv, messages: newMessages, updatedAt: Date.now() };
      });

      setIsLoading(true);

      // 移动端的触觉反馈 - AI 开始回答：与点击汉堡菜单图标一致的短促轻触感
      setTimeout(() => haptic(), 100);

      try {
        abortControllerRef.current = new AbortController();

        // ---- 小模型意图判断：用户是否想生成图片 ----
        // 判断失败静默返回 needImage=false，走下方原有 LLM 流式，不影响聊天主流程。
        const userText =
          typeof content === 'string'
            ? content
            : content.find(p => p.type === 'text')?.text || '';
        // 用户带图请求（编辑/改图）：收集 content 里的图片地址，生图接口走编辑模式
        const editImages =
          typeof content !== 'string'
            ? content
                .filter(p => p.type === 'image_url' && p.image_url?.url)
                .map(p => p.image_url!.url)
            : undefined;
        const hasEditImages = !!editImages && editImages.length > 0;
        const imageIntent = await judgeImageIntent(
          userText,
          messages,
          hasEditImages ? editImages!.length : 0
        );

        if (imageIntent.needImage) {
          // Pix2Real 提供商：服务端自带 Grok 路由，会读用户原话选工作流、补参数。
          // 前端再做提示词优化只会破坏它的判断依据，因此这条分支全程透传原话与原图，
          // 也不走 upscale/bgRemove 的 Fal 专用分支（放大/抠图同样交给服务端路由）。
          const imageProvider = await settingsService.getProvider('image');
          if (imageProvider === PIX2REAL_PROVIDER) {
            await runPix2RealGeneration({
              userText,
              reply: imageIntent.reply,
              editImages,
              editPrevious: imageIntent.editPrevious === true,
              messages,
              userMessage,
              assistantMessage,
              convId: activeId,
            });
            return; // Pix2Real 路径不走 LLM 流式
          }

          // 判断为"修改/合并上一张 AI 图"：从历史里找最近一条带 generatedImages 的 AI 消息
          let prevAiImages: string[] | undefined;
          if (imageIntent.editPrevious) {
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i];
              if (m.role === 'assistant' && m.generatedImages && m.generatedImages.length > 0) {
                prevAiImages = m.generatedImages;
                break;
              }
            }
          }
          // 编辑参考图来源：用户新上传的图，+（判断为合并时）上一张 AI 生成的图。
          // 合并场景（如"让她坐在沙发上"：带室内图 + 指代之前编辑过的人物图）
          // 两张都要传给编辑接口，参考图顺序与下方 prompt 说明保持一致（用户图在前）
          const editSource =
            hasEditImages && editImages
              ? imageIntent.editPrevious && prevAiImages
                ? [...editImages, ...prevAiImages]
                : editImages
              : prevAiImages;
          const isEditMode = !!editSource && editSource.length > 0;

          // ---- 特殊图像处理（高清放大 / 去除背景）：判断器输出 process 意图时走独立分支 ----
          // 处理模型只吃单张参考图：优先用户本条上传的图，其次上一张 AI 生成的图。
          // 若无参考图（用户没带图也没有上一张 AI 图）则无法处理，回落普通生图/编辑流程。
          const processKind = imageIntent.process as ImageProcessKind | undefined;
          const processSourceUrl = processKind ? (editSource && editSource[0]) || undefined : undefined;
          if (processKind && processSourceUrl) {
            const processReply =
              imageIntent.reply ||
              (processKind === 'upscale' ? '好的，我来为您高清放大～' : '好的，正在为您去除背景～');
            const processPrompt =
              processKind === 'upscale'
                ? '将参考图高清放大'
                : '移除参考图的背景，保留主体';

            updateActiveConversation(conv => {
              const updated = [...conv.messages];
              const lastIdx = updated.length - 1;
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: processReply,
                isStreaming: false,
                imageGenerating: true,
                generatedImage: {
                  model: CHAT_IMAGE_MODEL,
                  prompt: processPrompt,
                  aspectRatio: 'auto',
                },
              };
              return { ...conv, messages: updated, updatedAt: Date.now() };
            });

            const targetConvId = activeId;
            const targetMsgId = assistantMessage.id;
            void (async () => {
              try {
                // 参考图落盘为 aishop-blob: 引用，先还原成 data URL 再交给处理服务
                const inlined = await inlineBlobsForApi([
                  { type: 'image_url' as const, image_url: { url: processSourceUrl } },
                ]);
                const src = Array.isArray(inlined) && inlined[0] && inlined[0].type === 'image_url'
                  ? inlined[0].image_url?.url || ''
                  : '';
                if (!src) throw new Error('参考图读取失败');
                const resultUrl = await apiProcessImage(processKind, src);
                patchMessage(targetConvId, targetMsgId, {
                  imageGenerating: false,
                  generatedImages: [resultUrl],
                  generatedImage: { model: CHAT_IMAGE_MODEL, prompt: processPrompt, aspectRatio: 'auto' },
                });
              } catch (err) {
                patchMessage(targetConvId, targetMsgId, {
                  imageGenerating: false,
                  imageGenerateError:
                    err instanceof Error ? err.message : '图片处理失败，请稍后重试',
                });
              }
            })();

            return; // 处理路径不走 LLM 流式
          }

          const reply =
            imageIntent.reply ||
            (isEditMode ? CHAT_IMAGE_EDIT_REPLY_FALLBACK : CHAT_IMAGE_REPLY_FALLBACK);

          // 编辑模式（用户带图 或 修改上一张 AI 图）：读第一张参考图的实际尺寸，
          // 从 API 支持的比例/尺寸列表里选最接近的传参，让输出与原图保持一致
          // （多张图时以第一张为准）；取不到尺寸才回落 auto（保持原图比例）。
          // 无图文生图：比例取小模型按用户要求判断出的合法比例，默认 1:1。
          // 比例同时落给骨架占位，保证图片回传后尺寸不跳变
          let genAspectRatio: string;
          let genSize = '1K';
          if (isEditMode && editSource) {
            const firstSize = await getFirstImageSize(editSource);
            if (firstSize && firstSize.width > 0 && firstSize.height > 0) {
              genAspectRatio = closestAspectRatio(firstSize.width, firstSize.height);
              genSize = sizeForMaxEdge(Math.max(firstSize.width, firstSize.height));
            } else {
              genAspectRatio = 'auto';
            }
          } else {
            genAspectRatio = imageIntent.aspectRatio || '1:1';
          }
          // ---- 生图提示词：由用户当前模型整理优化（小模型只做调度判断，不负责提示词） ----
          // 优化在 shimmer 挂起期间完成（下方生图块内），确认回复先落回退版；
          // 优化失败静默回退原文 + 参考图说明，生图流程不中断。
          const sceneNote = isEditMode
            ? imageIntent.editPrevious && prevAiImages && prevAiImages.length > 0
              ? '用户上传的图片在前，之前 AI 生成的图片在后；需要组合使用两张参考图，保持之前生成图片中主体（人物等）的外观特征一致'
              : hasEditImages
                ? `用户上传了 ${editImages!.length} 张图片，需要基于这些图片进行修改`
                : '上一张 AI 生成的图片，需要基于这张图片进行修改'
            : undefined;
          const fallbackPrompt = sceneNote
            ? `【参考图说明】${sceneNote}。\n${userText}`
            : userText;
          const genMeta = { model: CHAT_IMAGE_MODEL, prompt: fallbackPrompt, aspectRatio: genAspectRatio };

          // 1) 先回复确认文案（非流式，一次落定），并在气泡下方挂起 shimmer 骨架
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const lastIdx = updated.length - 1;
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: reply,
              isStreaming: false,
              imageGenerating: true,
              generatedImage: genMeta,
            };
            return { ...conv, messages: updated, updatedAt: Date.now() };
          });

          // 新会话第一轮对聊完成，立即生成标题（与 LLM 流式完成后的行为一致）
          if (messages.length === 0) {
            const snapshot = conversationsRef.current.find(c => c.id === activeId);
            if (snapshot && !snapshot.isRenamed && snapshot.title === '新对话') {
              triggerTitleGeneration({
                ...snapshot,
                messages: [...messages, userMessage, { ...assistantMessage, content: reply, isStreaming: false }],
              });
            }
          }

          // 2) 紧接着发起生图（非阻塞：不 await，生成期间 shimmer 持续显示）。
          //    回调按 convId + msgId 精确定位，避免用户切走会话后写错目标。
          const targetConvId = activeId;
          const targetMsgId = assistantMessage.id;

          void (async () => {
            try {
              // 生图提示词：用用户当前模型整理优化（失败静默回退原文+参考图说明）
              const optimized = await optimizeImagePrompt({
                userText,
                // 智能路由下用回落模型做提示词优化（'auto' 不是真实模型 id，不能直接请求）
                model: selectedModel === AUTO_MODEL_ID
                  ? (lastConcreteModelRef.current || CHAT_MODELS[0].id)
                  : selectedModel,
                aspectRatio: isEditMode ? undefined : genAspectRatio !== '1:1' ? genAspectRatio : undefined,
                sceneNote,
              });
              const genPrompt = optimized || fallbackPrompt;
              // 参考图落盘后是 aishop-blob: 引用，先还原成 data URL 再发给上游
              let images: string[] | undefined;
              if (isEditMode && editSource) {
                const inlined = await inlineBlobsForApi(
                  editSource.map(url => ({ type: 'image_url' as const, image_url: { url } }))
                );
                images = (Array.isArray(inlined) ? inlined : [])
                  .map(p => (p.type === 'image_url' ? p.image_url?.url || '' : ''))
                  .filter(Boolean);
              }
              const urls = await apiGenerateImage({
                prompt: genPrompt,
                model: CHAT_IMAGE_MODEL,
                n: 1,
                size: genSize,
                aspectRatio: genAspectRatio,
                images,
              });
              patchMessage(targetConvId, targetMsgId, {
                imageGenerating: false,
                generatedImages: urls,
                generatedImage: { ...genMeta, prompt: genPrompt },
              });
            } catch (err) {
              patchMessage(targetConvId, targetMsgId, {
                imageGenerating: false,
                imageGenerateError:
                  err instanceof Error ? err.message : '图片生成失败，请稍后重试',
              });
            }
          })();

          return; // 生图路径不走 LLM 流式
        }

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

        // 用压缩视图发送。messages 是本轮渲染的快照（不含刚追加的两条），
        // 如果刚刚压缩过，就把新 segment 的标记就地应用上去。
        const convForPayload = conversationsRef.current.find(c => c.id === activeId);
        const baseSegments = convForPayload?.segments || [];
        const segmentsForPayload = freshSegment
          ? [...baseSegments.filter(s => s.id !== freshSegment!.id), freshSegment]
          : baseSegments;

        const compactedIds = new Set(
          freshSegment
            ? messages
                .slice(
                  messages.findIndex(m => m.id === freshSegment!.fromMessageId),
                  messages.findIndex(m => m.id === freshSegment!.toMessageId) + 1
                )
                .map(m => m.id)
            : []
        );
        const baseMessages = messages.map(m =>
          compactedIds.has(m.id) ? { ...m, compressedInto: freshSegment!.id } : m
        );

        const allMessages = buildApiMessages(baseMessages, segmentsForPayload, [apiUserMessage]);

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
            // 确保用户所在城市已就绪（IP 定位，失败静默）——
            // 系统提示词与搜索判断都会用到它，天气等本地问题才能精准搜索
            await ensureCity();
            // 开关只表示"允许联网"，是否真的要搜由小模型按问题内容判断，
            // 避免闲聊、写代码这类明显不需要实时信息的问题也去联网
            const judge = await judgeSearchNeed(userText, messages);

            if (judge.needSearch) {
              // 立即显示"正在搜索..."
              updateActiveConversation(conv => {
                const updated = [...conv.messages];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = { ...updated[lastIdx], webSearching: true };
                return { ...conv, messages: updated };
              });

              try {
                const results = await searchWeb(judge.query || userText);
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

              // 搜索完成后立即更新状态（不等流式结束）
              updateActiveConversation(conv => {
                const updated = [...conv.messages];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  webSearching: false,
                  webSearched: searchSources.length > 0,
                  searchResults: searchSources.length > 0 ? searchSources : undefined,
                  webSearchFailed: searchFailed,
                };
                return { ...conv, messages: updated };
              });
            }
          }
        }

        // ---- 智能路由：选中「智能路由」时由小模型决定本次回答方式 ----
        // 判断与直接回答是两次独立的小模型调用：judgeRoute 只输出分类结果
        // （direct / 路由目标模型），判断为 direct 后再由 quickAnswer 单独发起
        // 一次回答请求（见 routeJudge.ts）。三条路径都保证有实际模型可答：
        // route → 路由目标；direct → 小模型直答；判断/直答失败 → 回落最近一次
        // 具体模型，发送永不中断。
        let actualModel = selectedModel;
        let directAnswer: string | undefined;
        if (selectedModel === AUTO_MODEL_ID) {
          const route = await judgeRoute(
            userText,
            messages,
            lastConcreteModelRef.current || undefined,
            hasEditImages,
            searchContext || undefined
          );
          if (route?.action === 'route' && route.model) {
            actualModel = route.model;
            lastConcreteModelRef.current = route.model;
          } else if (route?.action === 'direct') {
            directAnswer = (await quickAnswer(userText, messages, searchContext || undefined)) ?? undefined;
            if (directAnswer) {
              // 消息 model 字段如实记录实际回答者（小模型），版本导航可正常显示
              actualModel = ROUTER_MODEL;
            } else {
              actualModel = lastConcreteModelRef.current || CHAT_MODELS[0].id;
            }
          } else {
            actualModel = lastConcreteModelRef.current || CHAT_MODELS[0].id;
          }
          patchMessage(activeId, assistantMessage.id, { model: actualModel });
        }

        let fullContent = '';
        let artifactStreamStarted = false;
        const currentRole = roles.find(r => r.id === selectedRoleId) ?? null;
        let realUsage: TokenUsage | undefined;
        let firstChunkDone = false;
        if (directAnswer !== undefined) {
          // 智能路由直接回答：小模型一次返回，不走流式（下方统一后处理照常执行）
          fullContent = directAnswer;
        } else {
          const systemPrompt = buildSystemPrompt(
            featureSettings.artifactEnabled,
            webSearchEnabled,
            actualModel,
            currentRole
          );
          for await (const chunk of streamChat(
            allMessages,
            actualModel,
            abortControllerRef.current.signal,
            searchContext || undefined,
            systemPrompt,
            u => { realUsage = u; }
          )) {
            if (!firstChunkDone) {
              firstChunkDone = true;
              // AI 开始回答（第一次流式返回收到）：与汉堡菜单一致的短促轻触感
              haptic();
            }
            fullContent += chunk;
            const displayContent = getDisplayContent(fullContent);
            updateActiveConversation(conv => {
              const updated = [...conv.messages];
              const lastIdx = updated.length - 1;
              updated[lastIdx] = { ...updated[lastIdx], content: displayContent };
              return { ...conv, messages: updated };
            });

            // 流式 artifact 检测（仅在 artifact 功能开启时）
            if (featureSettings.artifactEnabled && isArtifactStreaming(fullContent)) {
              const streaming = extractStreamingArtifact(fullContent);
              if (streaming) {
                if (!artifactStreamStarted) {
                  artifactStreamStarted = true;
                }
                setStreamingArtifact(streaming);
              }
            }
          }
        }
        // 流式结束，清除流式 artifact 状态
        setStreamingArtifact(null);

        // 移动端的触觉反馈 - AI 回答结束：与汉堡菜单一致的短促轻触感
        setTimeout(() => haptic(), 100);

        // 先去除 artifact 标记，再清理过度反引号，最后解析 suggestions
        const contentWithoutArtifact = getDisplayContentWithoutArtifact(fullContent);
        const cleanedContent = cleanExcessiveBackticks(contentWithoutArtifact);
        const { text, suggestions } = parseSuggestions(cleanedContent);
        const artifact = parseArtifactFromContent(fullContent);

        updateActiveConversation(conv => {
          const updated = [...conv.messages];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: text,
            isStreaming: false,
            suggestions,
            artifact: artifact || undefined,
            webSearched: searchSources.length > 0,
            searchResults: searchSources.length > 0 ? searchSources : undefined,
            webSearchFailed: searchFailed,
            usage: realUsage,
          };
          return { ...conv, messages: updated, updatedAt: Date.now() };
        });

        // 新会话第一轮对聊完成，立即生成标题（不必再等离开会话才触发）
        // 只在首轮触发，老会话仍走「离开会话时补标题」的原有路径；
        // 失败/取消时这里不会执行，切走时原有逻辑仍会兜底触发。
        if (messages.length === 0) {
          const snapshot = conversationsRef.current.find(c => c.id === activeId);
          if (snapshot && !snapshot.isRenamed && snapshot.title === '新对话') {
            triggerTitleGeneration({
              ...snapshot,
              messages: [
                ...messages,
                userMessage,
                { ...assistantMessage, content: text, isStreaming: false },
              ],
            });
          }
        }
      } catch (err: unknown) {
        const e = err as Error;
        if (e.name === 'AbortError') {
          // 用户取消生成，更新消息状态（作为 stopGeneration 的安全兜底）
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const currentContent = typeof updated[lastIdx].content === 'string'
                ? updated[lastIdx].content
                : '';
              const hasContent = currentContent.trim().length > 0;

              updated[lastIdx] = {
                ...updated[lastIdx],
                content: hasContent ? currentContent : '',
                isStreaming: false,
                webSearching: false,
                stoppedByUser: true,
              };
            }
            return { ...conv, messages: updated };
          });
          return;
        }
        setError(e.message || '请求失败');
        updateActiveConversation(conv => {
          const updated = [...conv.messages];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: '⚠️ 请求失败: ' + (e.message || '未知错误'),
            isStreaming: false,
          };
          return { ...conv, messages: updated };
        });
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, selectedModel, updateActiveConversation, patchMessage, webSearchEnabled, featureSettings, activeId, compactSettings, compactConversation, triggerTitleGeneration, runPix2RealGeneration, roles, selectedRoleId]
  );

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
    // 立即更新最后一条 assistant 消息，显示取消状态
    updateActiveConversation(conv => {
      const updated = [...conv.messages];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && updated[lastIdx].isStreaming) {
        const currentContent = typeof updated[lastIdx].content === 'string'
          ? updated[lastIdx].content
          : '';

        // 判断是否有内容：如果内容为空，显示"请求已被取消"；否则保留内容并标记为停止
        const hasContent = currentContent.trim().length > 0;

        updated[lastIdx] = {
          ...updated[lastIdx],
          content: hasContent ? currentContent : '',
          isStreaming: false,
          webSearching: false,
          stoppedByUser: true,
        };

        // 同时更新多版本中的当前活跃版本
        if (updated[lastIdx].versions && updated[lastIdx].versions.length > 0) {
          const vIdx = updated[lastIdx].activeVersionIndex ?? updated[lastIdx].versions!.length - 1;
          if (vIdx >= 0 && vIdx < updated[lastIdx].versions!.length) {
            const versions = [...updated[lastIdx].versions!];
            const versionContent = typeof versions[vIdx].content === 'string'
              ? versions[vIdx].content
              : '';
            const versionHasContent = versionContent.trim().length > 0;

            versions[vIdx] = {
              ...versions[vIdx],
              content: versionHasContent ? versionContent : '',
              isStreaming: false,
              stoppedByUser: true,
            };
            updated[lastIdx] = { ...updated[lastIdx], versions };
          }
        }
      }
      return { ...conv, messages: updated };
    });
  }, [updateActiveConversation]);

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

  const newConversation = useCallback(async () => {
    // 无论之前选了哪个自定义角色，开新会话一律回到默认角色 PortAI（空串 = 默认角色）
    setSelectedRole('');

    const currentConv = conversations.find(c => c.id === activeId);

    // 当前是空会话，不需要新建，保持现状即可。
    // 未加载的会话 messages 为空但并非真的没消息，用 messageCountOf 兜底。
    if (currentConv && messageCountOf(currentConv) === 0) {
      return;
    }

    // 离开前触发标题生成（如果满足条件）
    if (currentConv && !currentConv.isRenamed && currentConv.messages.length > 0 && currentConv.title === '新对话') {
      triggerTitleGeneration(currentConv);
    }

    const conv = await createAndPersistConversation(getLastUsedModel());
    // 已经在库里了，记下快照避免持久化 effect 再写一遍
    persistedRef.current.set(conv.id, conv);
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    setError(null);
  }, [conversations, activeId, triggerTitleGeneration, setSelectedRole]);

  /** 切换会话。目标未加载过消息时按需从库里读最近若干条。 */
  const switchConversation = useCallback(
    async (id: string) => {
      // 离开前触发标题生成（如果满足条件）
      const currentConv = conversations.find(c => c.id === activeId);
      if (currentConv && !currentConv.isRenamed && currentConv.messages.length > 0 && currentConv.title === '新对话') {
        triggerTitleGeneration(currentConv);
      }

      setActiveId(id);
      setError(null);

      const target = conversations.find(c => c.id === id);
      if (!target || target.hydrated !== false) return;

      try {
        const { messages, segments, totalMessageCount, hasMore } = await hydrateConversation(id);
        setConversations(prev =>
          prev.map(c => {
            if (c.id !== id) return c;
            const hydratedConv = {
              ...c,
              messages,
              segments,
              totalMessageCount,
              hasMoreMessages: hasMore,
              hydrated: true,
            };
            // 刚从库里读出来的内容不需要再写回去
            persistedRef.current.set(id, hydratedConv);
            return hydratedConv;
          })
        );
      } catch (e) {
        console.error('[useChat] 加载会话失败', e);
        setError('加载对话记录失败');
      }
    },
    [conversations, activeId, triggerTitleGeneration]
  );

  /** 向上滚动加载更早的消息 */
  const loadMoreMessages = useCallback(async () => {
    const conv = conversationsRef.current.find(c => c.id === activeId);
    if (!conv || !conv.hasMoreMessages || conv.messages.length === 0) return;

    try {
      const { messages, hasMore } = await loadOlderMessages(conv.id, conv.messages[0]);
      if (!messages.length) {
        setConversations(prev =>
          prev.map(c => (c.id === conv.id ? { ...c, hasMoreMessages: false } : c))
        );
        return;
      }
      setConversations(prev =>
        prev.map(c => {
          if (c.id !== conv.id) return c;
          const merged = { ...c, messages: [...messages, ...c.messages], hasMoreMessages: hasMore };
          // 补进来的都是库里已有的记录，同步快照以免被当成新消息重写
          const snapshot = persistedRef.current.get(c.id);
          if (snapshot) {
            persistedRef.current.set(c.id, { ...snapshot, messages: merged.messages });
          }
          return merged;
        })
      );
    } catch (e) {
      console.error('[useChat] 加载更早消息失败', e);
    }
  }, [activeId]);

  /**
   * 删除会话。
   *
   * 先删库再改 state：反过来的话持久化 effect 会看到一个「已消失」的会话，
   * 没法再拿到它的 id 去清理消息和 blob 引用。
   */
  const removeConversations = useCallback(
    async (ids: string[]) => {
      const idSet = new Set(ids);
      try {
        for (const id of ids) await dbDeleteConversation(id);
      } catch (e) {
        console.error('[useChat] 删除会话失败', e);
      }
      for (const id of ids) persistedRef.current.delete(id);

      // 删除是数据变更，同样要同步（tombstone 需要推到云端）
      setPendingSyncTick(t => t + 1);
      // 删除动作发生时立即落本地 tombstone：即使本次自动同步失败，
      // 60 秒轮询的 countPending 也能感知删除并兜底传播，不会静默丢失。
      await recordLocalDeletions(ids).catch(() => undefined);

      // 删除低频且确定性强：tombstone 立即推云端，不等 3 秒防抖，也不因流式跳过
      // （推送体积极小；reloadConversations 对流式状态有合并保护，由事件广播触发）。
      // 上面的 pendingSyncTick 同时充当重试：这轮失败时 3 秒防抖轮会接着补。
      void (async () => {
        const cfg = getByocConfig();
        if (!cfg.enabled || validateConfig(cfg)) return;
        try {
          await flushPendingWrites();
          await syncNow(cfg);
          window.dispatchEvent(new CustomEvent(BYOC_SYNC_DONE_EVENT));
        } catch (e) {
          console.warn('[useChat] 删除后即时同步失败（防抖轮与轮询兜底）', e);
        }
      })();

      const remaining = conversationsRef.current.filter(c => !idSet.has(c.id));
      if (remaining.length === 0) {
        const conv = await createAndPersistConversation(getLastUsedModel());
        persistedRef.current.set(conv.id, conv);
        setConversations([conv]);
        setActiveId(conv.id);
        return;
      }

      setConversations(remaining);
      if (!idSet.has(activeId)) return;

      // 切到剩下的第一个会话，必要时加载它的消息。
      // 这里不复用 switchConversation：它闭包里的 conversations 还是删除前的快照。
      const target = remaining[0];
      setActiveId(target.id);
      if (target.hydrated !== false) return;
      try {
        const { messages, segments, totalMessageCount, hasMore } =
          await hydrateConversation(target.id);
        setConversations(prev =>
          prev.map(c => {
            if (c.id !== target.id) return c;
            const hydratedConv = {
              ...c, messages, segments, totalMessageCount,
              hasMoreMessages: hasMore, hydrated: true,
            };
            persistedRef.current.set(target.id, hydratedConv);
            return hydratedConv;
          })
        );
      } catch (e) {
        console.error('[useChat] 加载会话失败', e);
      }
    },
    [activeId]
  );

  const deleteConversation = useCallback(
    (id: string) => removeConversations([id]),
    [removeConversations]
  );

  const deleteConversations = useCallback(
    (ids: string[]) => removeConversations(ids),
    [removeConversations]
  );

  const toggleConversationFavorite = useCallback((id: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, isFavorite: !c.isFavorite } : c))
    );
  }, []);

  const toggleConversationHidden = useCallback((id: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, isHidden: !c.isHidden } : c))
    );
  }, []);

  // 导入会话（来自 .portai.json 文件）
  const regenerateMessage = useCallback(
    async (messageId: string) => {
      if (isLoading) return;
      const conv = conversations.find(c => c.id === activeId);
      if (!conv) return;

      // 找到目标 assistant 消息的索引
      const msgIndex = conv.messages.findIndex(m => m.id === messageId);
      if (msgIndex < 0) return;

      // 找到前一条 user 消息
      let userMsgIndex = -1;
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (conv.messages[i].role === 'user') {
          userMsgIndex = i;
          break;
        }
      }
      if (userMsgIndex < 0) return;

      const contextMessages = buildApiMessages(
        conv.messages.slice(0, msgIndex),
        conv.segments
      );

      // 智能路由残留兜底：主发送路径已把消息 model 修正为实际回答模型，
      // 若因异常仍为 'auto'，回落最近一次具体模型，避免拿伪 id 直接请求 API
      const regenModel = conv.messages[msgIndex].model || selectedModel;
      const safeRegenModel = regenModel === AUTO_MODEL_ID
        ? (lastConcreteModelRef.current || CHAT_MODELS[0].id)
        : regenModel;

      // 如果该消息已有 versions，初始化第一个版本
      let existingVersions: MessageVersion[] = conv.messages[msgIndex].versions || [];
      if (existingVersions.length === 0) {
        existingVersions = [{
          id: conv.messages[msgIndex].id + '-v0',
          model: safeRegenModel,
          content: conv.messages[msgIndex].content || '',
          timestamp: conv.messages[msgIndex].timestamp,
          suggestions: conv.messages[msgIndex].suggestions,
          webSearched: conv.messages[msgIndex].webSearched,
          webSearchFailed: conv.messages[msgIndex].webSearchFailed,
          searchResults: conv.messages[msgIndex].searchResults,
          artifact: conv.messages[msgIndex].artifact,
          stoppedByUser: conv.messages[msgIndex].stoppedByUser,
        }];
      }

      // 检查当前模型是否已存在于 versions 中
      const currentModelIndex = existingVersions.findIndex(v => v.model === safeRegenModel);
      // 如果当前版本被用户停止了，允许重新生成；否则检查是否已经是最新版本
      const currentVersionStoppedByUser = existingVersions[currentModelIndex]?.stoppedByUser || conv.messages[msgIndex].stoppedByUser;
      if (currentModelIndex >= 0 && currentModelIndex === existingVersions.length - 1 && !currentVersionStoppedByUser) {
        return; // 已经是最新版本，无需重新生成
      }

      // 如果当前版本被停止了，重用当前版本而不是创建新版本
      let newVersionId: string;
      let newActiveIndex: number;
      let newVersions: MessageVersion[];

      if (currentVersionStoppedByUser && currentModelIndex >= 0) {
        // 重新生成被停止的版本
        newActiveIndex = currentModelIndex;
        newVersions = [...existingVersions];
        newVersions[newActiveIndex] = {
          ...newVersions[newActiveIndex],
          content: '',
          isStreaming: true,
          stoppedByUser: false, // 清除停止标记
        };
      } else {
        // 创建新 version
        newVersionId = Date.now().toString() + '-v' + existingVersions.length;
        const newVersion: MessageVersion = {
          id: newVersionId,
          model: safeRegenModel,
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        };
        newVersions = [...existingVersions, newVersion];
        newActiveIndex = newVersions.length - 1;
      }

      // 更新消息状态：追加 versions，切换到新版本
      updateActiveConversation(conv => {
        const updated = [...conv.messages];
        updated[msgIndex] = {
          ...updated[msgIndex],
          versions: newVersions,
          activeVersionIndex: newActiveIndex,
        };
        return { ...conv, messages: updated, updatedAt: Date.now() };
      });

      // 调用流式 API
      setIsLoading(true);
      abortControllerRef.current = new AbortController();

      let fullContent = '';
      try {
        const systemPrompt = buildSystemPrompt(
          featureSettings.artifactEnabled,
          webSearchEnabled,
          safeRegenModel,
          roles.find(r => r.id === selectedRoleId) ?? null
        );

        let realUsage: TokenUsage | undefined;
        let firstChunkDone = false;
        for await (const chunk of streamChat(
          contextMessages,
          safeRegenModel,
          abortControllerRef.current.signal,
          undefined,
          systemPrompt,
          u => { realUsage = u; }
        )) {
          if (!firstChunkDone) {
            firstChunkDone = true;
            // AI 开始回答（第一次流式返回收到）：与汉堡菜单一致的短促轻触感
            haptic();
          }
          fullContent += chunk;
          const displayContent = getDisplayContent(fullContent);

          // 实时更新 version 内容
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const msg = updated[msgIndex];
            const versions = [...(msg.versions || [])];
            versions[newActiveIndex] = {
              ...versions[newActiveIndex],
              content: displayContent,
            };
            updated[msgIndex] = { ...msg, versions, activeVersionIndex: newActiveIndex };
            return { ...conv, messages: updated };
          });
        }

        // 流式完成：解析 suggestions/artifact
        const contentWithoutArtifact = getDisplayContentWithoutArtifact(fullContent);
        const cleanedContent = cleanExcessiveBackticks(contentWithoutArtifact);
        const { text, suggestions } = parseSuggestions(cleanedContent);
        const artifact = parseArtifactFromContent(fullContent);

        updateActiveConversation(conv => {
          const updated = [...conv.messages];
          const msg = updated[msgIndex];
          const versions = [...(msg.versions || [])];
          versions[newActiveIndex] = {
            ...versions[newActiveIndex],
            content: text,
            isStreaming: false,
            suggestions: suggestions.length > 0 ? suggestions : undefined,
            artifact: artifact || undefined,
            usage: realUsage,
          };
          updated[msgIndex] = { ...msg, versions, activeVersionIndex: newActiveIndex };
          return { ...conv, messages: updated, updatedAt: Date.now() };
        });
      } catch (error: unknown) {
        const e = error as Error;
        if (e.name === 'AbortError') {
          // 用户取消生成，更新版本内容
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const msg = updated[msgIndex];
            const versions = [...(msg.versions || [])];
            if (versions[newActiveIndex]) {
              const versionContent = versions[newActiveIndex].content;
              const hasContent = typeof versionContent === 'string'
                ? versionContent.trim().length > 0
                : versionContent.length > 0;

              versions[newActiveIndex] = {
                ...versions[newActiveIndex],
                content: hasContent ? versionContent : '',
                isStreaming: false,
                stoppedByUser: true,
              };
            }
            updated[msgIndex] = { ...msg, versions, activeVersionIndex: newActiveIndex, isStreaming: false };
            return { ...conv, messages: updated, updatedAt: Date.now() };
          });
        } else {
          // 错误处理：标记 version 为完成状态，内容为错误信息
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const msg = updated[msgIndex];
            const versions = [...(msg.versions || [])];
            versions[newActiveIndex] = {
              ...versions[newActiveIndex],
              content: fullContent || '生成失败，请重试。',
              isStreaming: false,
            };
            updated[msgIndex] = { ...msg, versions, activeVersionIndex: newActiveIndex };
            return { ...conv, messages: updated, updatedAt: Date.now() };
          });
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [isLoading, conversations, activeId, selectedModel, updateActiveConversation, featureSettings, webSearchEnabled, roles, selectedRoleId]
  );

  const importConversation = useCallback((convData: Partial<Conversation>) => {
    const rawMessages = Array.isArray(convData.messages) ? convData.messages : [];
    // 清理流式状态，避免导入后显示异常
    const sanitizedMessages: Message[] = rawMessages.map(m => ({
      ...m,
      isStreaming: false,
    }));

    const imported: Conversation = {
      id: newConversationId(),
      title: convData.title || '导入的对话',
      messages: sanitizedMessages,
      selectedModel: convData.selectedModel || CHAT_MODELS[0].id,
      createdAt: convData.createdAt || Date.now(),
      updatedAt: Date.now(),
      isRenamed: convData.isRenamed ?? true,
      hydrated: true,
      // 一并带上压缩区间，否则 compressedInto 会指向不存在的 segment，
      // 导致导入后的会话退化成逐字发送全部原文
      segments: Array.isArray(convData.segments)
        ? convData.segments.map(seg => ({ ...seg, summary: migrateSummary(seg.summary) }))
        : undefined,
      compactFocusHint: convData.compactFocusHint,
    };

    setConversations(prev => [imported, ...prev]);
    setActiveId(imported.id);
    setError(null);
  }, []);

  // 多模型比较：用另一个模型重新回答同一问题
  const compareWithModel = useCallback(
    async (messageId: string, targetModelId: string) => {
      if (isLoading) return;
      const conv = conversations.find(c => c.id === activeId);
      if (!conv) return;

      // 1. 找到目标 assistant 消息
      const msgIndex = conv.messages.findIndex(m => m.id === messageId);
      if (msgIndex < 0) return;
      const targetMsg = conv.messages[msgIndex];
      if (targetMsg.role !== 'assistant') return;

      // 2. 如果 versions 为空，将当前内容初始化为 versions[0]
      let existingVersions: MessageVersion[] = targetMsg.versions || [];
      if (existingVersions.length === 0) {
        existingVersions = [{
          id: targetMsg.id + '-v0',
          model: targetMsg.model || selectedModel,
          content: targetMsg.content,
          timestamp: targetMsg.timestamp,
          suggestions: targetMsg.suggestions,
          webSearched: targetMsg.webSearched,
          webSearchFailed: targetMsg.webSearchFailed,
          searchResults: targetMsg.searchResults,
          artifact: targetMsg.artifact,
        }];
      }

      // 3. 检查 targetModelId 是否已存在于 versions 中
      if (existingVersions.some(v => v.model === targetModelId)) return;

      // 4. 创建新 version
      const newVersionId = Date.now().toString() + '-v' + existingVersions.length;
      const newVersion: MessageVersion = {
        id: newVersionId,
        model: targetModelId,
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };
      const newVersions = [...existingVersions, newVersion];
      const newActiveIndex = newVersions.length - 1;

      // 5. 更新消息状态：追加 versions，切换 activeVersionIndex
      updateActiveConversation(conv => {
        const updated = [...conv.messages];
        updated[msgIndex] = {
          ...updated[msgIndex],
          versions: newVersions,
          activeVersionIndex: newActiveIndex,
        };
        return { ...conv, messages: updated, updatedAt: Date.now() };
      });

      // 6. 准备上下文：取该 assistant 消息之前的所有消息（走压缩视图）
      const contextMessages = buildApiMessages(
        conv.messages.slice(0, msgIndex),
        conv.segments
      );

      // 7. 调用流式 API
      setIsLoading(true);
      abortControllerRef.current = new AbortController();

      let fullContent = '';
      try {
        const systemPrompt = buildSystemPrompt(
          featureSettings.artifactEnabled,
          webSearchEnabled,
          targetModelId,
          roles.find(r => r.id === selectedRoleId) ?? null
        );

        let realUsage: TokenUsage | undefined;
        for await (const chunk of streamChat(
          contextMessages,
          targetModelId,
          abortControllerRef.current.signal,
          undefined,
          systemPrompt,
          u => { realUsage = u; }
        )) {
          fullContent += chunk;
          const displayContent = getDisplayContent(fullContent);

          // 实时更新 version 内容
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const msg = updated[msgIndex];
            const versions = [...(msg.versions || [])];
            versions[newActiveIndex] = {
              ...versions[newActiveIndex],
              content: displayContent,
            };
            updated[msgIndex] = { ...msg, versions, activeVersionIndex: newActiveIndex };
            return { ...conv, messages: updated };
          });
        }

        // 8. 流式完成：解析 suggestions/artifact
        const contentWithoutArtifact = getDisplayContentWithoutArtifact(fullContent);
        const cleanedContent = cleanExcessiveBackticks(contentWithoutArtifact);
        const { text, suggestions } = parseSuggestions(cleanedContent);
        const artifact = parseArtifactFromContent(fullContent);

        updateActiveConversation(conv => {
          const updated = [...conv.messages];
          const msg = updated[msgIndex];
          const versions = [...(msg.versions || [])];
          versions[newActiveIndex] = {
            ...versions[newActiveIndex],
            content: text,
            isStreaming: false,
            suggestions: suggestions.length > 0 ? suggestions : undefined,
            artifact: artifact || undefined,
            usage: realUsage,
          };
          updated[msgIndex] = { ...msg, versions, activeVersionIndex: newActiveIndex };
          return { ...conv, messages: updated, updatedAt: Date.now() };
        });
      } catch (error: unknown) {
        const e = error as Error;
        if (e.name === 'AbortError') {
          // 用户取消生成，更新版本内容
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const msg = updated[msgIndex];
            const versions = [...(msg.versions || [])];
            if (versions[newActiveIndex]) {
              const versionContent = versions[newActiveIndex].content;
              const hasContent = typeof versionContent === 'string'
                ? versionContent.trim().length > 0
                : versionContent.length > 0;

              versions[newActiveIndex] = {
                ...versions[newActiveIndex],
                content: hasContent ? versionContent : '',
                isStreaming: false,
                stoppedByUser: true,
              };
            }
            updated[msgIndex] = { ...msg, versions, activeVersionIndex: newActiveIndex, isStreaming: false };
            return { ...conv, messages: updated, updatedAt: Date.now() };
          });
        } else {
          // 错误处理：标记 version 为完成状态，内容为错误信息
          updateActiveConversation(conv => {
            const updated = [...conv.messages];
            const msg = updated[msgIndex];
            const versions = [...(msg.versions || [])];
            versions[newActiveIndex] = {
              ...versions[newActiveIndex],
              content: fullContent || '生成失败，请重试。',
              isStreaming: false,
            };
            updated[msgIndex] = { ...msg, versions, activeVersionIndex: newActiveIndex };
            return { ...conv, messages: updated, updatedAt: Date.now() };
          });
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [isLoading, conversations, activeId, selectedModel, updateActiveConversation, featureSettings, webSearchEnabled, roles, selectedRoleId]
  );

  // 多模型比较：切换版本
  const switchVersion = useCallback(
    (messageId: string, versionIndex: number) => {
      updateActiveConversation(conv => {
        const updated = [...conv.messages];
        const msgIndex = updated.findIndex(m => m.id === messageId);
        if (msgIndex < 0) return conv;
        const msg = updated[msgIndex];
        if (!msg.versions || versionIndex < 0 || versionIndex >= msg.versions.length) return conv;
        updated[msgIndex] = { ...msg, activeVersionIndex: versionIndex };
        return { ...conv, messages: updated };
      });
    },
    [updateActiveConversation]
  );

  // 当前会话的上下文水位。切模型时会自动重算（selectedModel 变化即触发）。
  const contextUsage = getContextUsage(
    activeConversation,
    selectedModel,
    compactSettings.threshold,
    compactSettings.hotWindowSize
  );

  // 真实用量汇总（来自 API 响应，与上面的估算相互独立）
  const realUsageTotals = sumRealUsage(messages, selectedModel);

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
    streamingArtifact,
    regenerateMessage,
    featureSettings,
    setFeatureSettings,
    // 把一张图片消息以 AI 回复形式插入当前会话（图片处理的入口复用）
    postImageMessage,
    // 角色系统
    roles,
    selectedRoleId,
    setSelectedRole,
    refreshRoles,
    // 会话管理
    conversations,
    activeConversationId: activeId,
    isBooting,
    newConversation,
    switchConversation,
    // 历史分页：长会话只加载最近若干条，向上滚动时按需补齐
    loadMoreMessages,
    hasMoreMessages: activeConversation?.hasMoreMessages ?? false,
    deleteConversation,
    deleteConversations,
    toggleConversationFavorite,
    toggleConversationHidden,
    renameConversation,
    importConversation,
    // BYOC 同步后从 IndexedDB 重读会话列表
    reloadConversations,
    compareWithModel,
    switchVersion,
    // 上下文压缩
    contextUsage,
    realUsageTotals,
    segments: activeConversation?.segments || [],
    compactSettings,
    setCompactSettings,
    compactingId,
    isCompacting: compactingId !== null,
    compactConversation,
    updateSegment,
    revertSegment,
    compactFocusHint: activeConversation?.compactFocusHint,
    setCompactFocusHint,
  };
}
