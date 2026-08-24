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
  pix2real: {
    name: 'Pix2Real',
    chatBaseUrl: '',
    // 自建服务，默认本机 headless 端口；实际地址由设置里的「服务地址」覆盖
    // （frp 公网接入时填 http://<VPS_IP>:3000/api/v1）
    imageBaseUrl: 'http://localhost:3100/api/v1',
  },
};

/** Pix2Real 是自建服务，地址随部署变化，缺省用内置默认值 */
export const PIX2REAL_DEFAULT_BASE_URL = PROVIDERS.pix2real.imageBaseUrl;

// 获取提供商配置
export function getProviderConfig(providerId: string): ProviderEndpoints {
  return PROVIDERS[providerId] || PROVIDERS.fastapi;
}
