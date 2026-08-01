/**
 * 会话列表渲染用的小工具。
 *
 * 存在的原因：消息改成按需从 IndexedDB 加载之后，`conv.messages` 不再等于
 * 「这个会话有多少消息」——没打开过的会话它是空数组。侧栏若按 messages.length
 * 过滤，全部历史会话都会从列表里消失。
 */
import type { Conversation } from '../types';

/**
 * 会话里到底有没有消息。
 *
 * 两个来源都要看：
 * - messages.length —— 已加载的会话，且包含刚发出、还没回写计数的新消息
 * - totalMessageCount —— 未加载会话的唯一依据，但它是 hydrate 时的快照，会过时
 */
export function messageCountOf(conv: Conversation): number {
  return Math.max(conv.messages?.length ?? 0, conv.totalMessageCount ?? 0);
}

export function hasAnyMessage(conv: Conversation): boolean {
  return messageCountOf(conv) > 0;
}

/** 侧栏的最后一条消息预览；消息未加载时回落到会话记录里的冗余字段 */
export function lastMessagePreviewOf(conv: Conversation): string {
  const lastMsg = conv.messages?.[conv.messages.length - 1];
  if (!lastMsg) return conv.lastMessagePreview || '';
  if (typeof lastMsg.content === 'string') return lastMsg.content;
  const textPart = lastMsg.content.find(p => p.type === 'text');
  return textPart?.text || '[图片]';
}
