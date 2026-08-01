/**
 * 上下文节点仓库（压缩摘要 / 笔记 / 置顶）。
 *
 * 这里的记录全是派生物：原文永不删改，节点可以随意重建、失效、层层收敛。
 * level > 0 的节点用 derivedFrom 指向下层节点，于是历史可以无限压缩而
 * 原文始终完好。
 */
import { withDB, enqueue } from './open';
import type { StoredContextNode, StoredContextPlan } from './schema';

export function newNodeId(): string {
  return 'ctx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** 按覆盖区间升序读取一个会话的全部节点 */
export async function listNodes(convId: string): Promise<StoredContextNode[]> {
  const nodes = await withDB(db => db.getAllFromIndex('contextNodes', 'by_conv', convId));
  return nodes.sort((a, b) => a.coversFromSeq - b.coversFromSeq);
}

export function getNode(id: string): Promise<StoredContextNode | undefined> {
  return withDB(db => db.get('contextNodes', id));
}

export function putNode(node: StoredContextNode): Promise<void> {
  return enqueue(node.convId, () => withDB(async db => { await db.put('contextNodes', node); }));
}

/** 用户手改摘要：置 userEdited 后不再被自动重压 */
export function updateNodeSummary(
  convId: string,
  id: string,
  summary: string
): Promise<void> {
  return enqueue(convId, () =>
    withDB(async db => {
      const tx = db.transaction('contextNodes', 'readwrite');
      const node = await tx.store.get(id);
      if (node) {
        await tx.store.put({ ...node, summary, userEdited: true, stale: false });
      }
      await tx.done;
    })
  );
}

/**
 * 标记节点需要重建。
 *
 * 不立即删除：旧摘要在重建成功前仍然可用，比"先删后建、中途失败就丢上下文"
 * 安全。
 */
export function markNodeStale(convId: string, id: string): Promise<void> {
  return enqueue(convId, () =>
    withDB(async db => {
      const tx = db.transaction('contextNodes', 'readwrite');
      const node = await tx.store.get(id);
      if (node) await tx.store.put({ ...node, stale: true });
      await tx.done;
    })
  );
}

export function deleteNode(convId: string, id: string): Promise<void> {
  return enqueue(convId, () => withDB(db => db.delete('contextNodes', id)));
}

export async function deleteConversationNodes(convId: string): Promise<void> {
  await withDB(async db => {
    const keys = await db.getAllKeysFromIndex('contextNodes', 'by_conv', convId);
    const tx = db.transaction('contextNodes', 'readwrite');
    await Promise.all(keys.map(k => tx.store.delete(k)));
    await tx.done;
  });
  await withDB(async db => {
    const keys = await db.getAllKeysFromIndex('contextPlans', 'by_conv', convId);
    const tx = db.transaction('contextPlans', 'readwrite');
    await Promise.all(keys.map(k => tx.store.delete(k)));
    await tx.done;
  });
}

// ---------- 拼装记录（为将来的 agent loop 预留） ----------

export function putPlan(plan: StoredContextPlan): Promise<void> {
  return enqueue(plan.convId, () => withDB(async db => { await db.put('contextPlans', plan); }));
}

export async function listPlans(convId: string): Promise<StoredContextPlan[]> {
  const plans = await withDB(db => db.getAllFromIndex('contextPlans', 'by_conv', convId));
  return plans.sort((a, b) => a.createdAt - b.createdAt);
}

/** 最近一次拼装记录：让下一轮复用同一前缀，保住 prompt 缓存 */
export async function getLatestPlan(convId: string): Promise<StoredContextPlan | undefined> {
  const plans = await listPlans(convId);
  return plans[plans.length - 1];
}
