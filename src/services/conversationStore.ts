/**
 * 会话持久化门面：内存里的 Conversation[] ←→ IndexedDB。
 *
 * 为什么是「diff 后定向写」而不是整体覆盖：
 * 原来每次 state 变化都把所有会话 JSON.stringify 一遍同步写进 localStorage，
 * 历史一长就在流式输出时卡主线程。这里改成比较前后两版，只写真正变化的
 * 那几条消息。
 *
 * 会话列表启动时只读元数据（messages 为空、hydrated=false），
 * 真正打开某个会话时才按需加载最近若干条。
 */
import type { Conversation, Message, ContextSegment } from '../types';
import {
  listConversations,
  getConversation,
  getRecentMessages,
  getMessagesBefore,
  getMessageSeq,
  countMessages,
  getHeadSeq,
  appendMessage,
  putMessage,
  deleteMessage,
  putConversation,
  patchConversation,
  touchAfterMessage,
  createConversationRecord,
  listNodes,
  putNode,
  updateNodeSummary,
  deleteNode,
  markCompressed,
  nodesToSegments,
  createSummaryNode,
  toPreview,
  type StoredConversation,
} from '../db';

/** 打开会话时先加载多少条。够铺满几屏，其余滚动时再取。 */
export const INITIAL_MESSAGE_LIMIT = 60;
/** 向上滚动每次追加多少条 */
export const PAGE_SIZE = 40;
/** 流式期间的落盘节流间隔：安卓上切走应用不至于丢掉整段长回复 */
const STREAM_FLUSH_MS = 1000;

function toRuntime(rec: StoredConversation): Conversation {
  return {
    id: rec.id,
    title: rec.title,
    messages: [],
    selectedModel: rec.selectedModel,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    syncedAt: rec.syncedAt ?? null,
    isRenamed: rec.isRenamed,
    isFavorite: rec.isFavorite,
    isHidden: rec.isHidden,
    compactFocusHint: rec.compactFocusHint,
    segments: [],
    hydrated: false,
    totalMessageCount: rec.messageCount,
    lastMessagePreview: rec.lastMessagePreview,
  };
}

/** 启动时读会话列表，只含元数据 */
export async function loadConversationList(): Promise<Conversation[]> {
  const recs = await listConversations();
  return recs.map(toRuntime);
}

export async function createAndPersistConversation(modelId: string): Promise<Conversation> {
  const rec = createConversationRecord(modelId);
  await putConversation(rec);
  return { ...toRuntime(rec), hydrated: true };
}

export interface HydrateResult {
  messages: Message[];
  segments: ContextSegment[];
  totalMessageCount: number;
  /** 是否还有更早的消息可加载 */
  hasMore: boolean;
}

/** 打开会话：读最近 limit 条 + 全部上下文节点 */
export async function hydrateConversation(
  convId: string,
  limit = INITIAL_MESSAGE_LIMIT
): Promise<HydrateResult> {
  const [messages, nodes, total] = await Promise.all([
    getRecentMessages(convId, limit),
    listNodes(convId),
    countMessages(convId),
  ]);
  return {
    messages,
    segments: nodesToSegments(nodes),
    totalMessageCount: total,
    hasMore: messages.length < total,
  };
}

/** 向上滚动加载更早的消息 */
export async function loadOlderMessages(
  convId: string,
  oldestLoaded: Message,
  limit = PAGE_SIZE
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const seq = await getMessageSeq(oldestLoaded.id);
  if (seq === undefined) return { messages: [], hasMore: false };
  const messages = await getMessagesBefore(convId, seq, limit);
  return { messages, hasMore: messages.length === limit };
}

// ---------- 写入 ----------

/** 元数据是否有变化，避免每次消息更新都顺带重写会话记录 */
function metaChanged(prev: Conversation | undefined, next: Conversation): boolean {
  if (!prev) return true;
  return (
    prev.title !== next.title ||
    prev.selectedModel !== next.selectedModel ||
    prev.isRenamed !== next.isRenamed ||
    prev.isFavorite !== next.isFavorite ||
    prev.isHidden !== next.isHidden ||
    prev.compactFocusHint !== next.compactFocusHint
  );
}

/**
 * 判断一条消息是否需要重写。
 *
 * 逐字段比较不现实（内容可能是大数组），这里比较几个会变的关键字段 +
 * 内容长度。流式期间内容持续增长，长度变化足以判定。
 */
function messageChanged(a: Message, b: Message): boolean {
  if (a === b) return false;
  const lenA = typeof a.content === 'string' ? a.content.length : a.content.length;
  const lenB = typeof b.content === 'string' ? b.content.length : b.content.length;
  return (
    lenA !== lenB ||
    a.isStreaming !== b.isStreaming ||
    a.compressedInto !== b.compressedInto ||
    a.artifact?.id !== b.artifact?.id ||
    a.stoppedByUser !== b.stoppedByUser ||
    a.usage?.promptTokens !== b.usage?.promptTokens ||
    a.versions?.length !== b.versions?.length ||
    a.activeVersionIndex !== b.activeVersionIndex ||
    (a.suggestions?.length ?? 0) !== (b.suggestions?.length ?? 0) ||
    a.webSearched !== b.webSearched ||
    a.webSearchFailed !== b.webSearchFailed ||
    // 聊天内生图：生成完成/失败会只改这些字段（content 不变），
    // 不参与对比的话消息永远不会落盘，BYOC 推送的始终是"只有确认文案"的旧版
    a.imageGenerating !== b.imageGenerating ||
    a.imageGenerateError !== b.imageGenerateError ||
    a.generatedImages !== b.generatedImages ||
    a.generatedImage !== b.generatedImage
  );
}

/** 流式消息的待落盘缓冲：key 为 `convId:messageId` */
const streamPending = new Map<string, { convId: string; msg: Message; at: number }>();
const streamTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleStreamFlush(convId: string, msg: Message): void {
  const key = `${convId}:${msg.id}`;
  streamPending.set(key, { convId, msg, at: Date.now() });
  if (streamTimers.has(key)) return;

  streamTimers.set(
    key,
    setTimeout(() => {
      streamTimers.delete(key);
      const pending = streamPending.get(key);
      if (!pending) return;
      streamPending.delete(key);
      void putMessage(pending.convId, pending.msg).catch(() => {
        /* 流式中间态写失败无妨，最终态会再写一次 */
      });
    }, STREAM_FLUSH_MS)
  );
}

function cancelStreamFlush(convId: string, msgId: string): void {
  const key = `${convId}:${msgId}`;
  const timer = streamTimers.get(key);
  if (timer) clearTimeout(timer);
  streamTimers.delete(key);
  streamPending.delete(key);
}

/**
 * 把一个会话的变化落盘。
 *
 * @param prev 上一版；undefined 表示新会话
 * @param next 当前版
 */
export async function persistConversation(
  prev: Conversation | undefined,
  next: Conversation
): Promise<void> {
  return chainPersist(() => persistConversationImpl(prev, next));
}

/** 持久化写链：persist 是 fire-and-forget 异步，同步（BYOC）前要等队列排空，
 * 否则读库会读到"消息还没写入"的中间态，把内存里的新会话替换成空壳。 */
let writeChain: Promise<void> = Promise.resolve();
function chainPersist(fn: () => Promise<void>): Promise<void> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

async function persistConversationImpl(
  prev: Conversation | undefined,
  next: Conversation
): Promise<void> {
  // prev 为空说明这个会话还没进过库（导入会话走这条路）。
  // patchConversation 对不存在的记录是空操作，所以这里必须整条写入。
  if (!prev) await ensureConversationRecord(next);

  // 未加载的会话不参与 diff：它的 messages 是空数组，不代表"消息被删空了"
  if (next.hydrated === false) {
    if (metaChanged(prev, next)) await patchConversationMeta(next);
    return;
  }

  if (prev && metaChanged(prev, next)) await patchConversationMeta(next);

  const prevById = new Map((prev?.messages ?? []).map(m => [m.id, m]));
  const nextIds = new Set(next.messages.map(m => m.id));
  let appended = 0;

  for (const msg of next.messages) {
    const before = prevById.get(msg.id);

    if (!before) {
      // 新消息。流式占位也要立刻写：中途杀进程时至少留下用户那条提问。
      cancelStreamFlush(next.id, msg.id);
      await appendMessage(next.id, msg);
      appended += 1;
      continue;
    }

    if (!messageChanged(before, msg)) continue;

    if (msg.isStreaming) {
      // 流式中间态走节流，避免每个 chunk 都写一次盘
      scheduleStreamFlush(next.id, msg);
    } else {
      // 终态：取消挂起的中间态写入，直接写最终内容
      cancelStreamFlush(next.id, msg.id);
      await putMessage(next.id, msg);
    }
  }

  // 删除的消息
  for (const [id] of prevById) {
    if (!nextIds.has(id)) {
      cancelStreamFlush(next.id, id);
      await deleteMessage(next.id, id);
    }
  }

  await persistSegments(prev, next);

  // 冗余计数与预览：新增消息时要更新，最后一条内容变化时也要更新
  // （流式回答结束不新增消息，但侧栏预览得跟上）。
  const last = next.messages[next.messages.length - 1];
  const prevLast = prev?.messages[prev.messages.length - 1];
  const lastChanged = last && (!prevLast || prevLast.id !== last.id || messageChanged(prevLast, last));

  if (appended > 0 || lastChanged) {
    await touchAfterMessage(next.id, {
      messageCount: await countMessages(next.id),
      headSeq: await getHeadSeq(next.id),
      lastMessageAt: last?.timestamp,
      lastMessagePreview: last ? toPreview(last.content, 60) : undefined,
    });
  }
}

/** 确保库里有这条会话记录。已存在则不动，避免覆盖掉冗余计数。 */
async function ensureConversationRecord(conv: Conversation): Promise<void> {
  if (await getConversation(conv.id)) return;
  await putConversation({
    id: conv.id,
    title: conv.title,
    selectedModel: conv.selectedModel,
    createdAt: conv.createdAt,
    isRenamed: conv.isRenamed,
    isFavorite: conv.isFavorite,
    isHidden: conv.isHidden,
    compactFocusHint: conv.compactFocusHint,
    messageCount: 0,
    lastMessageAt: conv.updatedAt,
    headSeq: 0,
    updatedAt: conv.updatedAt,
    syncedAt: null,
  });
}

async function patchConversationMeta(conv: Conversation): Promise<void> {
  await patchConversation(conv.id, {
    title: conv.title,
    selectedModel: conv.selectedModel,
    isRenamed: conv.isRenamed,
    isFavorite: conv.isFavorite,
    isHidden: conv.isHidden,
    compactFocusHint: conv.compactFocusHint,
  });
}

/**
 * 同步压缩区间到 contextNodes。
 *
 * segment 是节点的 level-0 视图，这里做增删改三种同步。原文的 compressedInto
 * 标记由 markCompressed 单独写，不走消息 diff——那条路径会重写整条消息，
 * 对只改一个标记来说太重。
 */
async function persistSegments(
  prev: Conversation | undefined,
  next: Conversation
): Promise<void> {
  const prevSegs = new Map((prev?.segments ?? []).map(s => [s.id, s]));
  const nextSegs = new Map((next.segments ?? []).map(s => [s.id, s]));

  for (const [id, seg] of nextSegs) {
    const before = prevSegs.get(id);
    if (!before) {
      const covered = next.messages.filter(m => m.compressedInto === id);
      const seqs = await Promise.all(covered.map(m => getMessageSeq(m.id)));
      const valid = seqs.filter((s): s is number => s !== undefined);
      const node = createSummaryNode({
        convId: next.id,
        summary: seg.summary,
        sourceMessageIds: covered.map(m => m.id),
        coversFromSeq: valid.length ? Math.min(...valid) : 0,
        coversToSeq: valid.length ? Math.max(...valid) : 0,
        tokensBefore: seg.tokensBefore,
        tokensAfter: seg.tokensAfter,
        model: seg.model,
      });
      // 必须沿用内存里的 segment.id：原文的 compressedInto 指向的是它，
      // 用 createSummaryNode 自己生成的 id 会让引用对不上。
      await putNode({ ...node, id: seg.id, userEdited: seg.userEdited });
      await markCompressed(next.id, covered.map(m => m.id), id);
    } else if (before.summary !== seg.summary) {
      await updateNodeSummary(next.id, id, seg.summary);
    }
  }

  // 撤销压缩：删节点并清掉原文标记
  for (const [id] of prevSegs) {
    if (nextSegs.has(id)) continue;
    await deleteNode(next.id, id);
    const covered = (prev?.messages ?? [])
      .filter(m => m.compressedInto === id)
      .map(m => m.id);
    if (covered.length) await markCompressed(next.id, covered, undefined);
  }
}

/** 页面隐藏/关闭前把挂起的流式内容立刻写掉 */
export async function flushPendingWrites(): Promise<void> {
  const pending = [...streamPending.values()];
  streamPending.clear();
  for (const timer of streamTimers.values()) clearTimeout(timer);
  streamTimers.clear();
  await Promise.all(
    pending.map(p => putMessage(p.convId, p.msg).catch(() => undefined))
  );
  // 等持久化写链排空，保证库里已是最新（含刚入队的 persistConversation）
  await writeChain;
}
