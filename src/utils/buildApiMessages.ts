/**
 * 把会话（含压缩区间）转换为发给 API 的消息数组。
 *
 * 关键约定：原文永不删除。压缩只在这一层生效——被 segment 覆盖的
 * 消息在这里替换为一条 system 摘要，UI 侧仍然渲染完整原文。
 */
import type { Message, ContextSegment } from '../types';
import { migrateSummary } from './contextSummary';

export function renderSegmentAsSystemMessage(seg: ContextSegment): string {
  const body = migrateSummary(seg.summary).trim();
  return [
    `【历史上下文摘要】以下是本会话中较早的 ${seg.messageCount} 条消息的压缩结果。`,
    '请把它当作已经发生过的对话事实来使用，不要在回复中主动提及"摘要"或"压缩"。',
    '',
    body,
  ].join('\n');
}

/**
 * 构造 API 消息序列。
 *
 * @param messages  会话的完整消息列表（含 compressedInto 标记）
 * @param segments  压缩区间
 * @param extra     追加在末尾的消息（例如当前这轮带文件上下文的用户消息）
 */
export function buildApiMessages(
  messages: Message[],
  segments: ContextSegment[] | undefined,
  extra?: Message[]
): Message[] {
  const segs = segments || [];
  if (!segs.length) {
    return extra?.length ? [...messages, ...extra] : [...messages];
  }

  const segById = new Map(segs.map(s => [s.id, s]));
  const emitted = new Set<string>();
  const out: Message[] = [];

  for (const msg of messages) {
    const segId = msg.compressedInto;
    const seg = segId ? segById.get(segId) : undefined;

    if (!seg) {
      out.push(msg);
      continue;
    }

    // 区间内的第一条消息处插入摘要，其余整段跳过
    if (!emitted.has(seg.id)) {
      emitted.add(seg.id);
      out.push({
        id: `segment-${seg.id}`,
        role: 'system',
        content: renderSegmentAsSystemMessage(seg),
        timestamp: seg.createdAt,
      });
    }
  }

  if (extra?.length) out.push(...extra);
  return out;
}
