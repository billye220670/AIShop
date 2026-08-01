/**
 * 会话仓库。
 *
 * conversations 只存元数据：会话列表渲染完全不必读 messages store，
 * 这是长历史下列表仍然秒开的前提。messageCount / lastMessageAt / headSeq
 * 是反范式冗余，由 touchAfterMessage 维护。
 */
import { withDB, enqueue } from './open';
import type { StoredConversation } from './schema';
import { deleteConversationMessages } from './messageRepo';
import { deleteConversationNodes } from './contextRepo';
import { removeConversationFromIndex } from './retrievalRepo';

export function newConversationId(): string {
  // 必须全局唯一，不能依赖本地自增——将来接服务端同步时直接复用
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createConversationRecord(modelId: string): StoredConversation {
  const now = Date.now();
  return {
    id: newConversationId(),
    title: '新对话',
    selectedModel: modelId,
    createdAt: now,
    isRenamed: false,
    messageCount: 0,
    lastMessageAt: now,
    headSeq: 0,
    updatedAt: now,
    syncedAt: null,
  };
}

/** 按最近活跃排序读取全部会话元数据 */
export async function listConversations(): Promise<StoredConversation[]> {
  const all = await withDB(db => db.getAll('conversations'));
  return all.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function getConversation(id: string): Promise<StoredConversation | undefined> {
  return withDB(db => db.get('conversations', id));
}

export function putConversation(conv: StoredConversation): Promise<void> {
  return enqueue(conv.id, () =>
    withDB(async db => {
      await db.put('conversations', { ...conv, updatedAt: Date.now(), syncedAt: null });
    })
  );
}

/**
 * 局部更新会话元数据。
 *
 * 改名、切模型这类操作走这里，不必把整条记录读到 UI 再写回。
 */
export function patchConversation(
  id: string,
  patch: Partial<Omit<StoredConversation, 'id'>>
): Promise<void> {
  return enqueue(id, () =>
    withDB(async db => {
      const tx = db.transaction('conversations', 'readwrite');
      const rec = await tx.store.get(id);
      if (rec) {
        await tx.store.put({ ...rec, ...patch, updatedAt: Date.now(), syncedAt: null });
      }
      await tx.done;
    })
  );
}

/**
 * 消息变更后同步冗余计数。
 *
 * 与消息写入分成两次事务：IDB 事务不能跨越 await 边界之外的异步工作，
 * 而写消息本身要先做 blob 落盘。这里的代价是两者短暂不一致，
 * 但计数只用于列表展示，不参与正确性判断。
 */
export function touchAfterMessage(
  id: string,
  info: {
    messageCount: number;
    headSeq: number;
    lastMessageAt?: number;
    lastMessagePreview?: string;
  }
): Promise<void> {
  return patchConversation(id, {
    messageCount: info.messageCount,
    headSeq: info.headSeq,
    lastMessageAt: info.lastMessageAt ?? Date.now(),
    lastMessagePreview: info.lastMessagePreview,
  });
}

/** 删除会话及其全部消息、上下文节点、检索索引 */
export async function deleteConversation(id: string): Promise<void> {
  await deleteConversationMessages(id);
  await deleteConversationNodes(id);
  await removeConversationFromIndex(id);
  await enqueue(id, () => withDB(db => db.delete('conversations', id)));
}

export async function deleteConversations(ids: string[]): Promise<void> {
  for (const id of ids) await deleteConversation(id);
}
