export interface ProviderEndpoints {
  name: string;
  chatBaseUrl: string;
  imageBaseUrl: string;
}

export const PROVIDERS: Record<string, ProviderEndpoints> = {
  fastapi: {
    name: '接口AI',
    chatBaseUrl: 'https://api.highwayapi.ai/openai/v1',
    imageBaseUrl: 'https://api.highwayapi.ai',
  },
  falai: {
    name: 'Fal AI',
    chatBaseUrl: '',
    // 图片走 fal queue 协议：提交 + 轮询 + 取结果都是发往 queue.fal.run
    imageBaseUrl: 'https://queue.fal.run',
  },
};

// 获取提供商配置
export function getProviderConfig(providerId: string): ProviderEndpoints {
  return PROVIDERS[providerId] || PROVIDERS.fastapi;
}
