/**
 * 轻量 token 估算。
 *
 * 只用于「是否该压缩」的阈值判断和收益展示，不用于计费，
 * 所以刻意不引入 tokenizer 依赖（会增加几百 KB 体积）。
 * 经验值：中文约 1 字 ≈ 0.7 token，英文约 4 字符 ≈ 1 token。
 */
import type { Message, MessageContent, ContextSummary, ContextSegment, Conversation, TokenUsage } from '../types';

/** 单张图片按固定值估算（多数视觉模型的低清档位量级） */
const IMAGE_TOKENS = 1200;
/** 每条消息的 role/分隔符等固定开销 */
const PER_MESSAGE_OVERHEAD = 4;

export function estimateTextTokens(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const cjk = (text.match(/[一-龥぀-ヿ가-힯]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 0.7 + rest / 4);
}

export function estimateContentTokens(content: string | MessageContent[]): number {
  if (typeof content === 'string') return estimateTextTokens(content);
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, part) => {
    if (part.type === 'image_url') return sum + IMAGE_TOKENS;
    return sum + estimateTextTokens(part.text || '');
  }, 0);
}

export function estimateMessageTokens(msg: Message): number {
  let total = estimateContentTokens(msg.content) + PER_MESSAGE_OVERHEAD;
  // 附件正文会被拼进 API 请求（见 useChat 的 fileContext 构造），必须计入
  if (msg.attachments?.length) {
    for (const f of msg.attachments) {
      total += estimateTextTokens(f.textContent) + 20;
    }
  }
  return total;
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export function estimateSummaryTokens(summary: ContextSummary): number {
  return estimateTextTokens(summary);
}

export function estimateSegmentTokens(seg: ContextSegment): number {
  return estimateSummaryTokens(seg.summary);
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  /** 有真实 usage 记录的回复条数 */
  measuredTurns: number;
  /** 缓存命中率 = cachedTokens / promptTokens */
  cacheHitRate: number;
  /** 网关是否返回过缓存字段（区分「没命中」和「不支持」） */
  hasCacheData: boolean;
  /**
   * 最近一轮的输入 token。这就是「当前上下文规模」——
   * 下一轮要重新发一遍的量，也是真正会撞上限的数字。
   */
  lastPromptTokens: number;
  /**
   * 最后一次完整回复时使用的模型 ID。
   * 水位条的百分比要用这个模型的上限算，而非当前选中的模型。
   */
  lastModel: string;
}

/**
 * 判断一条 assistant 回复是否「完整」——只有完整的回复才有可信的 usage。
 *
 * 被打断的回复拿不到 usage（usage chunk 在 [DONE] 前一个 chunk，abort 时读不到），
 * 取消的回复内容为空。这两种都要跳过，否则水位条会退回到更早的数字，
 * 看起来像「打断之后上下文变小了」。
 */
function isCompleteReply(
  msg: Message,
  version?: { usage?: TokenUsage; content: string | MessageContent[]; stoppedByUser?: boolean }
): boolean {
  const usage = version?.usage ?? msg.usage;
  if (!usage) return false;
  if ((version?.stoppedByUser ?? msg.stoppedByUser) === true) return false;

  const content = version?.content ?? msg.content;
  const text = typeof content === 'string' ? content : content.map(p => p.text || '').join('');
  return text.trim().length > 0;
}

/**
 * 汇总一个会话里所有真实 usage 记录。
 * 与估算函数分开：这里只统计 API 实际返回过的数据，没返回就不计入。
 *
 * 打断/取消的回复被跳过，所以水位条在用户打断后保持不变——
 * 上下文规模确实没变，只是最后一条消息没写完。
 */
export function sumRealUsage(messages: Message[], fallbackModel = ''): UsageTotals {
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let measuredTurns = 0;
  let hasCacheData = false;
  let lastPromptTokens = 0;
  let lastModel = fallbackModel;

  for (const msg of messages) {
    // 多版本消息只统计当前展示的那个版本，避免把弃用版本的成本也算进去
    const version = msg.versions?.[msg.activeVersionIndex ?? 0];
    if (!isCompleteReply(msg, version)) continue;

    const usage = (version?.usage ?? msg.usage)!;
    promptTokens += usage.promptTokens;
    completionTokens += usage.completionTokens;
    if (usage.cachedTokens !== undefined) {
      cachedTokens += usage.cachedTokens;
      hasCacheData = true;
    }
    measuredTurns++;
    // 按消息顺序遍历，最后一次赋值就是最近一个完整轮次
    lastPromptTokens = usage.promptTokens;
    lastModel = version?.model ?? msg.model ?? fallbackModel;
  }

  return {
    promptTokens,
    completionTokens,
    cachedTokens,
    measuredTurns,
    cacheHitRate: promptTokens > 0 ? cachedTokens / promptTokens : 0,
    hasCacheData,
    lastPromptTokens,
    lastModel,
  };
}

/**
 * 估算一个会话实际发给 API 的 token 量：
 * 已压缩区间按摘要计，其余按原文计。
 */
export function estimateConversationTokens(conv: Conversation): number {
  const segments = conv.segments || [];
  const compressedIds = new Set(segments.map(s => s.id));

  let total = segments.reduce((sum, s) => sum + estimateSegmentTokens(s), 0);
  for (const msg of conv.messages) {
    if (msg.compressedInto && compressedIds.has(msg.compressedInto)) continue;
    total += estimateMessageTokens(msg);
  }
  return total;
}
