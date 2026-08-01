/**
 * 决定「哪些消息该被压缩」。
 *
 * 与压缩服务分开，因为这部分是纯函数、可推理、可测试，
 * 而实际调用模型的部分不可预测。
 */
import type { Conversation, Message } from '../types';
import { CHAT_MODELS } from '../config/models';
import {
  estimateConversationTokens,
  estimateMessageTokens,
  estimateSegmentTokens,
} from './tokenEstimate';

/** 保护：带 artifact 的消息不压缩（artifact 是用户的产出物，摘要救不回来） */
function isProtected(msg: Message): boolean {
  return Boolean(msg.artifact) || Boolean(msg.versions?.some(v => v.artifact));
}

export function getModelContextLimit(modelId: string): number {
  const model = CHAT_MODELS.find(m => m.id === modelId);
  // 未知模型给一个保守值，避免误判为「无限上下文」而永不压缩
  return model?.contextLength ?? 32000;
}

export interface ContextUsage {
  used: number;
  limit: number;
  ratio: number;
  /** 是否已达到自动压缩阈值 */
  overThreshold: boolean;
  /** 是否有可压缩的内容（决定 UI 是否给出操作） */
  compactable: boolean;
}

/**
 * 挑出待压缩的消息区间。
 *
 * 规则：
 * - 最近 hotWindowSize 条永远逐字保留
 * - 已压缩过的消息不重复压缩
 * - 带 artifact 的消息跳过；一旦跳过就在此截断，保证区间连续
 * - 正在流式生成的消息不参与
 */
export function planCompaction(
  conv: Conversation,
  hotWindowSize: number
): Message[] {
  const messages = conv.messages;
  if (messages.length === 0) return [];

  const coldEnd = messages.length - hotWindowSize;
  if (coldEnd <= 0) return [];

  const picked: Message[] = [];
  for (let i = 0; i < coldEnd; i++) {
    const msg = messages[i];
    if (msg.isStreaming) break;
    if (msg.compressedInto) continue;
    // 保护性消息处截断，避免产生跨越它的不连续区间
    if (isProtected(msg)) {
      if (picked.length >= 2) break;
      picked.length = 0;
      continue;
    }
    picked.push(msg);
  }

  // 测试阶段放宽最小条数，方便触发；上线前可恢复为 >= 4
  return picked.length >= 1 ? picked : [];
}

/**
 * 压缩后能不能塞进目标模型？
 *
 * 热窗口是逐字发送的硬地板，压缩碰不到它。所以从大上下文模型切到小模型时
 * （比如 1M 的 Opus 历史切到 20k 的 Haiku），压完照样超限——那次压缩纯属
 * 白花一次调用、还顺手毁掉 prompt 缓存。这里先算一遍，不可行就别压。
 */
export function isCompactionViable(
  conv: Conversation,
  modelId: string,
  hotWindowSize: number,
  threshold: number
): boolean {
  const limit = getModelContextLimit(modelId);
  const target = planCompaction(conv, hotWindowSize);
  if (!target.length) return false;

  const targetIds = new Set(target.map(m => m.id));
  // 压缩后仍要原样发送的部分：热窗口 + 本轮压不到的旧消息
  const survivingTokens = conv.messages
    .filter(m => !targetIds.has(m.id) && !m.compressedInto)
    .reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  // 已有摘要也要继续发
  const existingSummaries = (conv.segments || []).reduce(
    (sum, s) => sum + estimateSegmentTokens(s),
    0
  );

  // 新摘要按 1.5k 估（结构化摘要的经验量级，宁可高估）
  const projected = survivingTokens + existingSummaries + 1500;

  return projected <= limit * threshold;
}

export function getContextUsage(
  conv: Conversation | null | undefined,
  modelId: string,
  threshold: number,
  hotWindowSize: number
): ContextUsage {
  const limit = getModelContextLimit(modelId);
  if (!conv || conv.messages.length === 0) {
    return { used: 0, limit, ratio: 0, overThreshold: false, compactable: false };
  }
  const used = estimateConversationTokens(conv);
  const ratio = limit > 0 ? used / limit : 0;
  return {
    used,
    limit,
    ratio,
    overThreshold: ratio >= threshold,
    compactable: planCompaction(conv, hotWindowSize).length > 0,
  };
}
