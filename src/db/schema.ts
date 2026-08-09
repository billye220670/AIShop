/**
 * IndexedDB schema 定义。
 *
 * 三条贯穿性设计约定，改动本文件前请先读懂：
 *
 * 1. 原文不可变。messages 只追加，压缩/摘要产出的一切都是 contextNodes 里的
 *    派生记录。任何"为了省空间删掉旧消息"的想法都会破坏无限上下文的前提。
 * 2. seq 是浮点数。两条消息之间插入（重新生成、分支）时取中值即可，
 *    不需要给后面全部重编号。排序永不依赖数组下标。
 * 3. updatedAt / syncedAt 为将来的服务端同步预留。syncedAt 为 null 表示
 *    尚未确认落到服务端；因为记录是追加式的，同步逻辑可以退化为
 *    "推送 syncedAt 为空的记录"，不需要 CRDT。id 必须全局唯一，
 *    不能依赖本地自增。
 */
import type { DBSchema } from 'idb';
import type {
  ArtifactBlock,
  ContextSummary,
  FileAttachment,
  MessageRole,
  TokenUsage,
} from '../types';

export const DB_NAME = 'aishop';
export const DB_VERSION = 2;

/** 同步预留字段，conversations 与 messages 共用 */
export interface SyncMeta {
  /** 本地最后变更时刻 */
  updatedAt: number;
  /** 已确认落到服务端的时刻；null 表示待同步 */
  syncedAt: number | null;
}

// ---------- 消息内容 ----------

/**
 * 存盘用的消息内容分片。
 *
 * 与 types/index.ts 的 MessageContent 的区别：图片不再内联 base64，
 * 而是通过 blobId 指向 blobs store。base64 在 localStorage 时代占了
 * 1.37 倍体积并且写爆了 5MB 上限，这是本次改造的主因之一。
 */
export type StoredContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_ref'; blobId: string };

export interface StoredMessage extends SyncMeta {
  id: string;
  convId: string;
  /** 浮点排序键，见文件头约定 2 */
  seq: number;
  role: MessageRole;
  content: string | StoredContentPart[];
  timestamp: number;

  /** 缓存的 token 估算值，让上下文规划器不必重新分词 */
  tokenEstimate: number;
  /** 会话列表/搜索用的纯文本摘要，避免为了显示一行字去解 content */
  textPreview: string;

  attachments?: FileAttachment[];
  artifact?: ArtifactBlock;
  model?: string;
  usage?: TokenUsage;
  suggestions?: string[];
  webSearched?: boolean;
  webSearchFailed?: boolean;
  searchResults?: Array<{ name: string; url: string; siteName: string }>;
  stoppedByUser?: boolean;

  /** 多模型对比的版本列表 */
  versions?: StoredMessageVersion[];
  activeVersionIndex?: number;

  /** 覆盖本条的 contextNode id；仅影响 API payload，不影响渲染 */
  compressedInto?: string;
}

export interface StoredMessageVersion {
  id: string;
  model: string;
  content: string | StoredContentPart[];
  timestamp: number;
  suggestions?: string[];
  webSearched?: boolean;
  webSearchFailed?: boolean;
  searchResults?: Array<{ name: string; url: string; siteName: string }>;
  artifact?: ArtifactBlock;
  stoppedByUser?: boolean;
  usage?: TokenUsage;
}

// ---------- 会话 ----------

export interface StoredConversation extends SyncMeta {
  id: string;
  title: string;
  selectedModel: string;
  createdAt: number;
  isRenamed: boolean;
  isFavorite?: boolean;
  /** 会话级压缩重点提示，填一次长期生效 */
  compactFocusHint?: string;

  // 以下为反范式冗余字段：让会话列表渲染完全不必读 messages store
  messageCount: number;
  lastMessageAt: number;
  /** 当前最大 seq，用于追加新消息时直接算出下一个 seq */
  headSeq: number;
  /** 最后一条消息的纯文本预览，供侧栏列表直接显示 */
  lastMessagePreview?: string;
}

// ---------- 上下文节点 ----------

/**
 * 派生的上下文记录，是 ContextSegment 的泛化。
 *
 * level 允许摘要被再摘要（0 = 压缩原始消息，1 = 压缩 level-0 节点……），
 * 于是历史可以无限层层收敛而原文始终完好。stale 让单个节点失效重建，
 * 不影响邻居。
 */
export interface StoredContextNode {
  id: string;
  convId: string;
  kind: 'summary' | 'note' | 'pin';
  level: number;

  summary: ContextSummary;
  /** 覆盖的原始消息 id */
  sourceMessageIds: string[];
  /** 派生自哪些下层节点（level > 0 时使用） */
  derivedFrom: string[];
  coversFromSeq: number;
  coversToSeq: number;
  messageCount: number;

  tokensBefore: number;
  tokensAfter: number;
  model: string;
  createdAt: number;
  /** 用户手改过则不再被自动重压 */
  userEdited: boolean;
  /** 需要重建 */
  stale: boolean;
}

/**
 * 每轮上下文的拼装记录。
 *
 * 目前不写入，为将来的 agent loop 预留：既是可调试的执行轨迹，也用于
 * 让多轮之间的前缀保持稳定——那是 prompt 缓存命中的前提。
 */
export interface StoredContextPlan {
  id: string;
  convId: string;
  /** 触发这次拼装的用户消息 */
  turnMessageId: string;
  model: string;
  steps: Array<{ tool: string; args: unknown; resultRef?: string }>;
  includedMessageIds: string[];
  includedNodeIds: string[];
  promptTokens: number;
  createdAt: number;
}

/**
 * 对原文的检索索引。
 *
 * 现阶段只填关键词 terms（multiEntry 索引，纯离线、不调模型）。将来
 * 加 embedding 字段即可支持语义检索，无需 schema 迁移。
 */
export interface StoredRetrievalEntry {
  messageId: string;
  convId: string;
  seq: number;
  terms: string[];
  embedding?: Float32Array;
}

// ---------- 二进制 ----------

/** 内容寻址：blobId 是字节的 sha-256，同一张图存两次只占一份 */
export interface StoredBlob {
  blobId: string;
  blob: Blob;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  /** 引用计数归零后由 GC sweep 清理 */
  refCount: number;
  createdAt: number;
}

// ---------- 其他 ----------

export interface StoredImageHistoryItem {
  id: string;
  blobIds: string[];
  prompt: string;
  model: string;
  timestamp: number;
  aspectRatio?: string;
  size?: string;
  quality?: string;
  sourceImages?: number;
  width?: number;
  height?: number;
}

export interface StoredFavoriteArtifact {
  id: string;
  artifact: ArtifactBlock;
  /** 缩略图，指向 blobs */
  thumbnailBlobId: string;
  favoritedAt: number;
}

// ---------- 角色 ----------

/**
 * 用户自定义角色：把一段系统提示词保存为可复用、可切换的预设。
 *
 * 与消息/会话同一套 SyncMeta 约定，随 BYOC 增量同步跨设备。
 */
export interface StoredRole extends SyncMeta {
  id: string;
  /** 角色名：创建时从提示词首行自动提取，纯展示用 */
  name: string;
  systemPrompt: string;
  createdAt: number;
}

export interface AiShopDB extends DBSchema {
  conversations: {
    key: string;
    value: StoredConversation;
    indexes: {
      by_updatedAt: number;
      by_favorite: number;
    };
  };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: {
      by_conv_seq: [string, number];
      by_conv_time: [string, number];
    };
  };
  blobs: {
    key: string;
    value: StoredBlob;
  };
  contextNodes: {
    key: string;
    value: StoredContextNode;
    indexes: {
      by_conv: string;
    };
  };
  contextPlans: {
    key: string;
    value: StoredContextPlan;
    indexes: {
      by_conv: string;
    };
  };
  retrieval: {
    key: string;
    value: StoredRetrievalEntry;
    indexes: {
      by_conv: string;
      terms: string;
    };
  };
  imageHistory: {
    key: string;
    value: StoredImageHistoryItem;
    indexes: {
      by_timestamp: number;
    };
  };
  favoriteArtifacts: {
    key: string;
    value: StoredFavoriteArtifact;
    indexes: {
      by_favoritedAt: number;
    };
  };
  roles: {
    key: string;
    value: StoredRole;
    indexes: {
      by_createdAt: number;
    };
  };
  kv: {
    key: string;
    value: { key: string; value: unknown };
  };
}
