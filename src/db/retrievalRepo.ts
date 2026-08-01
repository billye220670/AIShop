/**
 * 对原文的检索索引。
 *
 * 存在的意义：将来的上下文 agent 的核心动作是「摘要里说定了 X，去把原话
 * 找出来」，这需要一个不靠全表扫描的查询入口。现阶段只做离线关键词切分，
 * 不调模型；之后往 StoredRetrievalEntry 上加 embedding 字段即可支持语义
 * 检索，不需要 schema 迁移。
 */
import { withDB } from './open';
import type { StoredMessage } from './schema';

/** 单条消息最多留多少个词，防止长附件把索引撑爆 */
const MAX_TERMS = 80;
/** 过短的词检索价值低（"的"、"a"），直接丢 */
const MIN_TERM_LEN = 2;

/**
 * 切词。
 *
 * 中文没有空格，这里按 2-gram 切——比整句索引可用，比引入分词库轻。
 * 拉丁字母与数字按空白/标点切。
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const terms = new Set<string>();

  for (const word of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    // 含 CJK 的片段走 2-gram
    if (/[一-鿿぀-ヿ가-힯]/.test(word)) {
      if (word.length === 1) {
        terms.add(word);
      } else {
        for (let i = 0; i < word.length - 1; i++) terms.add(word.slice(i, i + 2));
      }
    } else if (word.length >= MIN_TERM_LEN) {
      terms.add(word);
    }
    if (terms.size >= MAX_TERMS) break;
  }

  return [...terms].slice(0, MAX_TERMS);
}

function textOf(rec: StoredMessage): string {
  const body =
    typeof rec.content === 'string'
      ? rec.content
      : rec.content.map(p => (p.type === 'text' ? p.text : '')).join(' ');
  const files = rec.attachments?.map(f => f.name).join(' ') ?? '';
  return `${body} ${files}`;
}

export async function indexMessage(rec: StoredMessage): Promise<void> {
  const terms = tokenize(textOf(rec));
  await withDB(db =>
    db.put('retrieval', {
      messageId: rec.id,
      convId: rec.convId,
      seq: rec.seq,
      terms,
    })
  );
}

export async function removeFromIndex(messageId: string): Promise<void> {
  await withDB(db => db.delete('retrieval', messageId));
}

export async function removeConversationFromIndex(convId: string): Promise<void> {
  await withDB(async db => {
    const keys = await db.getAllKeysFromIndex('retrieval', 'by_conv', convId);
    const tx = db.transaction('retrieval', 'readwrite');
    await Promise.all(keys.map(k => tx.store.delete(k)));
    await tx.done;
  });
}

export interface SearchHit {
  messageId: string;
  convId: string;
  seq: number;
  /** 命中的查询词数量，用于排序 */
  score: number;
}

/**
 * 按关键词检索，返回命中词数最多的若干条。
 *
 * 限定 convId 时只在该会话内搜；不传则跨会话（全局搜索用）。
 */
export async function searchMessages(
  query: string,
  opts: { convId?: string; limit?: number } = {}
): Promise<SearchHit[]> {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const limit = opts.limit ?? 20;

  return withDB(async db => {
    const scores = new Map<string, SearchHit>();
    const tx = db.transaction('retrieval', 'readonly');
    const index = tx.store.index('terms');

    for (const term of terms) {
      // multiEntry 索引：同一 term 会命中所有含它的消息
      for (const entry of await index.getAll(term)) {
        if (opts.convId && entry.convId !== opts.convId) continue;
        const hit = scores.get(entry.messageId);
        if (hit) {
          hit.score += 1;
        } else {
          scores.set(entry.messageId, {
            messageId: entry.messageId,
            convId: entry.convId,
            seq: entry.seq,
            score: 1,
          });
        }
      }
    }
    await tx.done;

    return [...scores.values()]
      .sort((a, b) => b.score - a.score || b.seq - a.seq)
      .slice(0, limit);
  });
}
