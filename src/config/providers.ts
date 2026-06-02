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
};

// 获取提供商配置
export function getProviderConfig(providerId: string): ProviderEndpoints {
  return PROVIDERS[providerId] || PROVIDERS.fastapi;
}
