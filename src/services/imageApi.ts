import type { ImageGenerationParams } from '../types';

/**
 * 调用后端 Edge Function 生成图片。
 * 失败时抛出 Error，错误消息优先取上游 detail/error 字段。
 */
export async function generateImage(
  params: ImageGenerationParams,
  signal?: AbortSignal
): Promise<string[]> {
  const response = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const errBody = await response
      .json()
      .catch(() => ({ error: '图片生成失败' as const }));
    const detail =
      typeof errBody.detail === 'string'
        ? errBody.detail
        : errBody.detail
        ? JSON.stringify(errBody.detail)
        : '';
    const msg = errBody.error || detail || `请求失败: ${response.status}`;
    throw new Error(msg);
  }

  const data = (await response.json()) as { urls?: string[] };
  if (!Array.isArray(data.urls) || data.urls.length === 0) {
    throw new Error('未返回图片地址');
  }
  return data.urls;
}
