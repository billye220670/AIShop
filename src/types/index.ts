export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatFeatureSettings {
  artifactEnabled: boolean;
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

export type TabMode = 'chat' | 'image' | 'favorites' | 'me';

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
  isRenamed: boolean;
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
