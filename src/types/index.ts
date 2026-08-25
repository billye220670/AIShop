export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatFeatureSettings {
  artifactEnabled: boolean;
  /** 是否在接近上下文上限时自动压缩历史 */
  autoCompactEnabled: boolean;
}

/** 压缩后的上下文摘要文本。用户看到什么、编辑什么，就是喂给模型的内容。 */
export type ContextSummary = string;

/** 一段被压缩的连续消息区间。原文不删除，这里只是派生视图。 */
export interface ContextSegment {
  id: string;
  fromMessageId: string;
  toMessageId: string;
  messageCount: number;
  summary: ContextSummary;
  /** 估算值，仅用于展示收益 */
  tokensBefore: number;
  tokensAfter: number;
  /** 执行压缩的模型 */
  model: string;
  createdAt: number;
  /** 用户手改过则不再被自动重压 */
  userEdited: boolean;
}

/**
 * 来自 API 响应的真实 token 用量。
 * 与 utils/tokenEstimate 的本地估算区分开：估算用于决定何时压缩，
 * 这里的真实值用于核对成本与缓存命中率。
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 命中缓存的输入 token（约为普通输入价的 10%），网关不返回时为 undefined */
  cachedTokens?: number;
  /** 写入缓存的 token，部分网关会单独计费 */
  cacheWriteTokens?: number;
}

export interface ArtifactBlock {
  id: string;
  type: 'html';
  title: string;
  description?: string;
  code: string;
  createdAt: number;
}

export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

// 文件附件类型
export interface FileAttachment {
  name: string;
  size: number;
  textContent: string;
  truncated: boolean;
}

// 多模型比较 - 消息版本接口
export interface MessageVersion {
  id: string;
  model: string;
  content: string | MessageContent[];
  timestamp: number;
  isStreaming?: boolean;
  suggestions?: string[];
  webSearching?: boolean;
  webSearched?: boolean;
  webSearchFailed?: boolean;
  searchResults?: Array<{ name: string; url: string; siteName: string }>;
  artifact?: ArtifactBlock;
  stoppedByUser?: boolean; // 用户是否停止了生成
  usage?: TokenUsage;
  /** 聊天内生成的图片 url（http 或 aishop-blob: 引用），与 content 分开存，content 保持纯文本 */
  generatedImages?: string[];
  /** 聊天内生图请求已发出、结果未返回（UI 显示 shimmer 骨架） */
  imageGenerating?: boolean;
  /** 聊天内生图失败的错误信息 */
  imageGenerateError?: string;
  /** 聊天内生图请求的元信息（生图模型/提示词/宽高比）：骨架占位尺寸与自动入库标题使用 */
  generatedImage?: { model: string; prompt: string; aspectRatio: string };
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string | MessageContent[];
  timestamp: number;
  isStreaming?: boolean;
  suggestions?: string[];
  webSearching?: boolean;
  webSearched?: boolean;
  webSearchFailed?: boolean;  // 联网搜索是否失败
  searchResults?: Array<{
    name: string;
    url: string;
    siteName: string;
  }>;
  attachments?: FileAttachment[];
  artifact?: ArtifactBlock;  // 关联的 artifact 数据
  model?: string;  // 生成该消息时使用的模型 ID
  versions?: MessageVersion[];       // 多模型回答版本列表
  activeVersionIndex?: number;       // 当前展示的版本索引
  stoppedByUser?: boolean; // 用户是否停止了生成
  compressedInto?: string;  // 所属 ContextSegment 的 id（仅影响 API payload，不影响渲染）
  usage?: TokenUsage;  // API 返回的真实用量（仅 assistant 消息）
  /** 聊天内生成的图片 url（http 或 aishop-blob: 引用），与 content 分开存，content 保持纯文本 */
  generatedImages?: string[];
  /** 聊天内生图请求已发出、结果未返回（UI 显示 shimmer 骨架） */
  imageGenerating?: boolean;
  /** 聊天内生图失败的错误信息 */
  imageGenerateError?: string;
  /** 聊天内生图请求的元信息（生图模型/提示词/宽高比）：骨架占位尺寸与自动入库标题使用 */
  generatedImage?: { model: string; prompt: string; aspectRatio: string };
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  type: 'chat' | 'image' | 'video' | 'music';
  maxTokens: number;
  contextLength: number;
  inputCapabilities: string[];
  outputCapabilities: string[];

  price: {
    input: string;
    output: string;
  };
}

export type TabMode = 'chat' | 'image' | 'library' | 'me';

/** 「我的库」资产类型：artifact（HTML 应用）/ markdown / 图片 */
export type AssetKind = 'artifact' | 'markdown' | 'image';

/**
 * 「我的库」资产条目（UI 层形态，与存盘结构解耦）。
 *
 * thumbnail / urls 里的 blob 一律是 aishop-blob:<id> 引用，
 * 渲染处用 useBlobUrl 解析；http 链接原样保留。
 */
export interface AssetItem {
  id: string;
  kind: AssetKind;
  title: string;
  createdAt: number;
  /** kind=artifact */
  artifact?: ArtifactBlock;
  /** kind=markdown：正文纯文本 */
  content?: string;
  /** kind=image */
  urls?: string[];
  /** 卡片缩略图：artifact 用截图，image 用首图 */
  thumbnail?: string;
  /** 来源引用：markdown 的源消息 id / image 的源历史 id */
  sourceRef?: string;
  /** 所属会话 id：「我的库」按会话隐藏状态过滤的依据（历史数据无此标记） */
  convId?: string;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  selectedModel: string;
  error: string | null;
}

export interface MediaItem {
  id: string;
  url: string;
  prompt: string;
  model: string;
  timestamp: number;
  type: 'image' | 'video' | 'audio';
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  selectedModel: string;
  createdAt: number;
  updatedAt: number;
  /** 最近一次确认同步到云端的时刻（BYOC）；null/undefined 表示尚未同步 */
  syncedAt?: number | null;
  isRenamed: boolean;
  isFavorite?: boolean;
  /** 隐藏：从会话主列表（所有/收藏）中隐去，仅在「已隐藏」视图可见；随 BYOC 同步 */
  isHidden?: boolean;
  /** 已压缩的历史区间，按 fromMessageId 在 messages 中的顺序排列 */
  segments?: ContextSegment[];
  /** 会话级压缩重点提示，填一次长期生效 */
  compactFocusHint?: string;

  /**
   * messages 是否已从 IndexedDB 加载。
   *
   * 仅存在于内存，不落盘。会话列表启动时只读元数据，此时为 false——
   * 持久化层据此跳过 diff，否则空的 messages 会被误判为「消息全被删了」。
   */
  hydrated?: boolean;
  /**
   * 库中该会话的消息总数。
   *
   * 侧栏用它判断会话是否为空——不能用 messages.length，因为未加载的会话
   * messages 是空数组，那样会让所有历史会话从列表里消失。
   */
  totalMessageCount?: number;
  /** 是否还有更早的消息未加载 */
  hasMoreMessages?: boolean;
  /** 最后一条消息的预览文本，未加载消息时侧栏靠它显示摘要 */
  lastMessagePreview?: string;
}

// 图片生成请求参数
export interface ImageGenerationParams {
  prompt: string;
  model: string;
  images?: string[];        // base64 编码的图片（编辑模式）
  aspectRatio?: string;     // 宽高比
  size?: string;            // 尺寸 (1K/2K/4K 或具体像素尺寸)
  quality?: string;         // 质量等级 (low/medium/high)
  outputFormat?: string;    // 输出格式
  n?: number;               // 生成数量
}

// 图片生成历史项（扩展现有 MediaItem）
export interface ImageHistoryItem {
  id: string;
  urls: string[];           // 生成的图片URL列表
  prompt: string;
  model: string;
  timestamp: number;
  aspectRatio?: string;
  size?: string;
  quality?: string;
  sourceImages?: number;    // 编辑模式下上传的图片数量
  width?: number;           // 图片原始宽度（用于瀑布流占位计算）
  height?: number;          // 图片原始高度（用于瀑布流占位计算）
  thumbnailUrl?: string;    // 缩略图地址（可选，预留）
}

// 并发队列中的待处理/错误任务
export interface PendingImageTask {
  id: string;
  prompt: string;
  model: string;
  params: ImageGenerationParams;    // 完整请求参数，用于重试
  status: 'loading' | 'error';
  error?: string;                   // 错误信息
  createdAt: number;
}

export type ThemeId = 'purple' | 'green';

// 用量查询相关类型
export type UsageCycleType = 'Hour' | 'Day' | 'Week' | 'Month';

export interface BillItem {
  userId: string;
  startTime: string;
  endTime: string;
  billingMethod: string;
  productName: string;
  category: string;
  ownerID: string;
  billNum0: string;   // 输入 tokens
  billNum1: string;   // 输出 tokens
  discountPrice0: string;  // 输入 tokens 单价
  discountPrice1: string;  // 输出 tokens 单价
  amount: string;     // 总价
  voucherAmount: string;  // 代金券抵扣
  payAmount: string;  // 实际支付
  payAmountDisplay: string;
  pricePrecision: string;
  productId: string;
}

export interface BillResponse {
  bills: BillItem[];
}

export interface ModelUsageSummary {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalAmount: number;
  payAmount: number;
}
