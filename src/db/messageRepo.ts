/**
 * 消息仓库。
 *
 * 全部按 [convId, seq] 索引读写，从不依赖数组下标。所有写操作经会话级队列
 * 串行化，避免流式期间的密集更新互相穿插。
 */
import type { Message } from '../types';
import { withDB, enqueue } from './open';
import type { StoredMessage } from './schema';
import { nextSeq, seqBetween } from './seq';
import {
  collectMessageBlobIds,
  fromStored,
  toStored,
} from './messageCodec';
import { releaseBlobs } from './blobRepo';
import { indexMessage, removeFromIndex } from './retrievalRepo';

/** IDBKeyRange 用的 seq 边界 */
const SEQ_MIN = -Infinity;
const SEQ_MAX = Infinity;

function convRange(convId: string) {
  return IDBKeyRange.bound([convId, SEQ_MIN], [convId, SEQ_MAX]);
}

/** 按 seq 升序读取整个会话。长会话请用 getRecentMessages 分页。 */
export async function getAllMessages(convId: string): Promise<Message[]> {
  const recs = await withDB(db =>
    db.getAllFromIndex('messages', 'by_conv_seq', convRange(convId))
  );
  return recs.map(fromStored);
}

/**
 * 读最新的 limit 条，返回仍按 seq 升序。
 *
 * 打开会话的默认路径：反向游标只碰要用的那几条，不会把整段历史读进内存。
 */
export async function getRecentMessages(
  convId: string,
  limit: number
): Promise<Message[]> {
  const recs = await withDB(async db => {
    const out: StoredMessage[] = [];
    const tx = db.transaction('messages', 'readonly');
    let cursor = await tx.store
      .index('by_conv_seq')
      .openCursor(convRange(convId), 'prev');
    while (cursor && out.length < limit) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return out.reverse();
  });
  return recs.map(fromStored);
}

/** 读 beforeSeq 之前的 limit 条，用于向上滚动加载。返回按 seq 升序。 */
export async function getMessagesBefore(
  convId: string,
  beforeSeq: number,
  limit: number
): Promise<Message[]> {
  const range = IDBKeyRange.bound([convId, SEQ_MIN], [convId, beforeSeq], false, true);
  const recs = await withDB(async db => {
    const out: StoredMessage[] = [];
    const tx = db.transaction('messages', 'readonly');
    let cursor = await tx.store.index('by_conv_seq').openCursor(range, 'prev');
    while (cursor && out.length < limit) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return out.reverse();
  });
  return recs.map(fromStored);
}

/**
 * 读 [fromSeq, toSeq] 区间。
 *
 * 这是给将来的上下文 agent 用的「按行号读原文」入口：可以只把需要的那一段
 * 取出来，而不必加载整个会话。
 */
export async function getMessageRange(
  convId: string,
  fromSeq: number,
  toSeq: number
): Promise<Message[]> {
  const recs = await withDB(db =>
    db.getAllFromIndex(
      'messages',
      'by_conv_seq',
      IDBKeyRange.bound([convId, fromSeq], [convId, toSeq])
    )
  );
  return recs.map(fromStored);
}

export async function getMessageSeq(id: string): Promise<number | undefined> {
  const rec = await withDB(db => db.get('messages', id));
  return rec?.seq;
}

export async function countMessages(convId: string): Promise<number> {
  return withDB(db => db.countFromIndex('messages', 'by_conv_seq', convRange(convId)));
}

/** 当前最大 seq；空会话返回 0 */
export async function getHeadSeq(convId: string): Promise<number> {
  return withDB(async db => {
    const tx = db.transaction('messages', 'readonly');
    const cursor = await tx.store
      .index('by_conv_seq')
      .openCursor(convRange(convId), 'prev');
    const seq = cursor?.value.seq ?? 0;
    await tx.done;
    return seq;
  });
}

/**
 * 追加一条消息，返回分配到的 seq。
 *
 * seq 从库里现有的最大值推导，而不是从调用方传入的计数，这样即使 UI 侧
 * state 落后于库也不会产生重复键。
 */
export function appendMessage(convId: string, msg: Message): Promise<number> {
  return enqueue(convId, async () => {
    const seq = nextSeq(await getHeadSeq(convId));
    const rec = await toStored(msg, convId, seq);
    await withDB(db => db.put('messages', rec));
    await indexMessage(rec);
    return seq;
  });
}

/** 在 afterSeq 之后、下一条之前插入（重新生成、分支）。返回分配到的 seq。 */
export function insertMessageAfter(
  convId: string,
  afterSeq: number,
  msg: Message
): Promise<number> {
  return enqueue(convId, async () => {
    const following = await withDB(async db => {
      const tx = db.transaction('messages', 'readonly');
      const cursor = await tx.store
        .index('by_conv_seq')
        .openCursor(
          IDBKeyRange.bound([convId, afterSeq], [convId, SEQ_MAX], true, false)
        );
      const seq = cursor?.value.seq;
      await tx.done;
      return seq;
    });

    const seq = seqBetween(afterSeq, following);
    const rec = await toStored(msg, convId, seq);
    await withDB(db => db.put('messages', rec));
    await indexMessage(rec);
    return seq;
  });
}

/**
 * 覆盖写一条已存在的消息，保留其原有 seq。
 *
 * 流式结束时写入最终内容走这里。找不到原记录时退化为追加，
 * 避免因为时序问题静默丢消息。
 */
export function putMessage(convId: string, msg: Message): Promise<number> {
  return enqueue(convId, async () => {
    const existing = await withDB(db => db.get('messages', msg.id));
    const seq = existing?.seq ?? nextSeq(await getHeadSeq(convId));
    const rec = await toStored(msg, convId, seq, existing?.syncedAt ?? null);

    // 旧内容里被换掉的图片要减引用，否则删了也永远不会被 GC 回收。
    // 按出现次数抵扣而不是按集合去重：同一张图可能在一条消息里出现多次，
    // putBlob 每次都 +1，这里少减就会让计数永远归不了零。
    if (existing) {
      const counts = new Map<string, number>();
      for (const id of collectMessageBlobIds(existing)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      for (const id of collectMessageBlobIds(rec)) {
        const left = counts.get(id);
        if (left !== undefined) counts.set(id, left - 1);
      }
      const stale: string[] = [];
      for (const [id, times] of counts) {
        for (let i = 0; i < times; i++) stale.push(id);
      }
      if (stale.length) await releaseBlobs(stale);
    }

    await withDB(db => db.put('messages', rec));
    await indexMessage(rec);
    return seq;
  });
}

/** 批量写入（导入会话等场景），按传入顺序分配 seq */
export function putMessages(convId: string, msgs: Message[]): Promise<void> {
  return enqueue(convId, async () => {
    let seq = await getHeadSeq(convId);
    const recs: StoredMessage[] = [];
    for (const msg of msgs) {
      seq = nextSeq(seq);
      recs.push(await toStored(msg, convId, seq));
    }
    await withDB(async db => {
      const tx = db.transaction('messages', 'readwrite');
      await Promise.all(recs.map(r => tx.store.put(r)));
      await tx.done;
    });
    for (const rec of recs) await indexMessage(rec);
  });
}

/** 只改 compressedInto 标记，不重写内容——压缩路径用 */
export function markCompressed(
  convId: string,
  messageIds: string[],
  nodeId: string | undefined
): Promise<void> {
  if (!messageIds.length) return Promise.resolve();
  return enqueue(convId, () =>
    withDB(async db => {
      const tx = db.transaction('messages', 'readwrite');
      const now = Date.now();
      for (const id of messageIds) {
        const rec = await tx.store.get(id);
        if (!rec) continue;
        rec.compressedInto = nodeId;
        rec.updatedAt = now;
        rec.syncedAt = null;
        await tx.store.put(rec);
      }
      await tx.done;
    })
  );
}

export function deleteMessage(convId: string, id: string): Promise<void> {
  return enqueue(convId, async () => {
    const rec = await withDB(db => db.get('messages', id));
    if (!rec) return;
    await withDB(db => db.delete('messages', id));
    await removeFromIndex(id);
    const blobIds = collectMessageBlobIds(rec);
    if (blobIds.length) await releaseBlobs(blobIds);
  });
}

/** 删除整个会话的消息，同时释放图片引用 */
export function deleteConversationMessages(convId: string): Promise<void> {
  return enqueue(convId, async () => {
    const recs = await withDB(db =>
      db.getAllFromIndex('messages', 'by_conv_seq', convRange(convId))
    );
    if (!recs.length) return;

    await withDB(async db => {
      const tx = db.transaction('messages', 'readwrite');
      await Promise.all(recs.map(r => tx.store.delete(r.id)));
      await tx.done;
    });
    for (const rec of recs) await removeFromIndex(rec.id);

    const blobIds = recs.flatMap(collectMessageBlobIds);
    if (blobIds.length) await releaseBlobs(blobIds);
  });
}
