export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string | MessageContent[];
  timestamp: number;
  isStreaming?: boolean;
  suggestions?: string[];
  webSearched?: boolean;
  webSearchFailed?: boolean;  // 联网搜索是否失败
  searchResults?: Array<{
    name: string;
    url: string;
    siteName: string;
  }>;
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
  category?: '基础' | '高级';
  price: {
    input: string;
    output: string;
  };
}

export type TabMode = 'chat' | 'image' | 'video' | 'music';

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
