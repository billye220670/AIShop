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
