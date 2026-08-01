/**
 * StoredContextNode 与运行时 ContextSegment 的互转。
 *
 * 现有的压缩逻辑（compactPlan / buildApiMessages）都以 ContextSegment 为单位，
 * 节点是它的泛化。这一层让那些代码不必立刻改动：level 0 的 summary 节点
 * 就是今天的 segment。
 */
import type { ContextSegment } from '../types';
import type { StoredContextNode } from './schema';
import { newNodeId } from './contextRepo';

export function nodeToSegment(node: StoredContextNode): ContextSegment {
  return {
    id: node.id,
    fromMessageId: node.sourceMessageIds[0] ?? '',
    toMessageId: node.sourceMessageIds[node.sourceMessageIds.length - 1] ?? '',
    messageCount: node.messageCount,
    summary: node.summary,
    tokensBefore: node.tokensBefore,
    tokensAfter: node.tokensAfter,
    model: node.model,
    createdAt: node.createdAt,
    userEdited: node.userEdited,
  };
}

/** 只把 level 0 的摘要节点当作 segment 暴露给现有渲染逻辑 */
export function nodesToSegments(nodes: StoredContextNode[]): ContextSegment[] {
  return nodes
    .filter(n => n.kind === 'summary' && n.level === 0 && !n.stale)
    .map(nodeToSegment);
}

export interface NewNodeInput {
  convId: string;
  summary: string;
  sourceMessageIds: string[];
  coversFromSeq: number;
  coversToSeq: number;
  tokensBefore: number;
  tokensAfter: number;
  model: string;
}

export function createSummaryNode(input: NewNodeInput): StoredContextNode {
  return {
    id: newNodeId(),
    convId: input.convId,
    kind: 'summary',
    level: 0,
    summary: input.summary,
    sourceMessageIds: input.sourceMessageIds,
    derivedFrom: [],
    coversFromSeq: input.coversFromSeq,
    coversToSeq: input.coversToSeq,
    messageCount: input.sourceMessageIds.length,
    tokensBefore: input.tokensBefore,
    tokensAfter: input.tokensAfter,
    model: input.model,
    createdAt: Date.now(),
    userEdited: false,
    stale: false,
  };
}
