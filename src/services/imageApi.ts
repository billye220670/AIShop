import type { ImageGenerationParams } from '../types';
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';

// 模型 → 上游 endpoint 路径映射
const IMAGE_ENDPOINTS: Record<string, { textToImage: string; edit: string }> = {
  'gpt-image-2': {
    textToImage: '/v3/gpt-image-2-text-to-image',
    edit: '/v3/gpt-image-2-edit',
  },
  'gemini-3.1-flash': {
    textToImage: '/v3/gemini-3.1-flash-image-text-to-image',
    edit: '/v3/gemini-3.1-flash-image-edit',
  },
  'gemini-3-pro': {
    textToImage: '/v3/gemini-3-pro-image-text-to-image',
    edit: '/v3/gemini-3-pro-image-edit',
  },
};

// 兼容多种上游响应结构，统一抽取出图片 URL 数组
// 支持：
//  - Gemini/jiekou 自定义协议：{ base_resp: {...}, image_urls: ["..."] }
//  - GPT Image 2 / OpenAI 兼容：{ data: [{ url | b64_json }] } 或 { images: [{ url }] }
function extractUrls(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;

  // Gemini: { image_urls: ["..."] }（可能与 base_resp 同级）
  if (Array.isArray(obj.image_urls)) {
    return (obj.image_urls as unknown[]).filter(
      (u): u is string => typeof u === 'string'
    );
  }

  // GPT Image 2: { images: [{ url }] } 或 { data: [{ url, b64_json }] }
  const pickFromList = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    const urls: string[] = [];
    for (const item of list) {
      if (typeof item === 'string') {
        urls.push(item);
      } else if (item && typeof item === 'object') {
        const it = item as Record<string, unknown>;
        if (typeof it.url === 'string') {
          urls.push(it.url);
        } else if (typeof it.b64_json === 'string') {
          // 兼容 base64 返回，前端可直接作为 src 使用
          urls.push(`data:image/png;base64,${it.b64_json}`);
        }
      }
    }
    return urls;
  };

  const fromImages = pickFromList(obj.images);
  if (fromImages.length > 0) return fromImages;

  const fromData = pickFromList(obj.data);
  if (fromData.length > 0) return fromData;

  return [];
}

// 根据模型和参数构建上游请求体
function buildImageRequestBody(
  model: string,
  prompt: string,
  images: string[] | undefined,
  isEdit: boolean,
  size?: string,
  quality?: string,
  outputFormat?: string,
  n?: number,
  aspectRatio?: string
): Record<string, unknown> {
  if (model === 'gpt-image-2') {
    if (isEdit && images && images.length > 0) {
      // GPT Image 2 编辑接口 image 字段为 string（标量），仅支持单张参考图。
      // OpenAI 兼容协议要求 base64 必须带完整 data URI 前缀（data:image/jpeg;base64,...），
      // 否则上游无法识别图片 MIME 类型，请求会一直挂起直到超时。
      const rawImage = images[0];
      let formattedImage: string;
      if (rawImage.startsWith('http://') || rawImage.startsWith('https://')) {
        formattedImage = rawImage;
      } else if (rawImage.startsWith('data:')) {
        formattedImage = rawImage;
      } else {
        // 裸 base64 → 补上 data URI 前缀（前端 compressImage 输出 JPEG）
        formattedImage = `data:image/jpeg;base64,${rawImage}`;
      }
      return {
        image: formattedImage,
        prompt,
        n: n || 1,
        size: size || '1024x1024',
        quality: quality || 'low',
        output_format: outputFormat || 'png',
      };
    } else {
      return {
        prompt,
        n: n || 1,
        size: size || '1024x1024',
        quality: quality || 'medium',
        output_format: outputFormat || 'png',
      };
    }
  }

  // Gemini 系列 (gemini-3.1-flash / gemini-3-pro)
  if (isEdit && images && images.length > 0) {
    // Gemini 编辑接口区分 image_urls / image_base64s。
    // 分流逻辑：以 http(s):// 开头 → URL；其余（裸 base64 或 data URI）→ base64。
    // image_base64s 字段需要裸 base64（无 data URI 前缀）。
    const base64s: string[] = [];
    const urlList: string[] = [];
    for (const img of images) {
      if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))) {
        urlList.push(img);
      } else if (typeof img === 'string') {
        // 裸 base64 或 data URI → 统一提取裸 base64
        const raw = img.startsWith('data:') ? (img.split(',')[1] || img) : img;
        base64s.push(raw);
      }
    }
    return {
      prompt,
      size: size || '1K',
      ...(aspectRatio && aspectRatio !== 'auto' ? { aspect_ratio: aspectRatio } : {}),
      ...(base64s.length > 0 ? { image_base64s: base64s } : {}),
      ...(urlList.length > 0 ? { image_urls: urlList } : {}),
      output_format: outputFormat || 'image/png',
    };
  } else {
    return {
      prompt,
      size: size || '1K',
      aspect_ratio: aspectRatio || '1:1',
      output_format: outputFormat || 'image/png',
    };
  }
}

/**
 * 直连提供商图片生成 API。
 * 失败时抛出 Error，错误消息优先取上游 detail/error 字段。
 */
export async function generateImage(
  params: ImageGenerationParams,
  signal?: AbortSignal
): Promise<string[]> {
  const provider = await settingsService.getProvider('image');
  const apiKey = await settingsService.getApiKey(provider);
  const config = getProviderConfig(provider);

  if (!apiKey) {
    throw new Error('请先在设置中配置图片 API Key');
  }

  const { prompt, model, images, aspectRatio, size, quality, outputFormat, n } = params;

  if (!model) {
    throw new Error('Missing required field: model');
  }
  if (!prompt || !prompt.trim()) {
    throw new Error('Missing required field: prompt');
  }

  const endpoints = IMAGE_ENDPOINTS[model];
  if (!endpoints) {
    throw new Error(`不支持的图片模型: ${model}`);
  }

  const isEdit = Array.isArray(images) && images.length > 0;
  const endpoint = isEdit ? endpoints.edit : endpoints.textToImage;
  const url = `${config.imageBaseUrl}${endpoint}`;

  const body = buildImageRequestBody(
    model, prompt, images, isEdit, size, quality, outputFormat, n, aspectRatio
  );

  // 180s 超时控制（GPT Image 2 生成可能需要 60-120s）
  const fetchController = new AbortController();
  const fetchTimeout = setTimeout(() => fetchController.abort(), 180000);

  // 合并外部 signal 与超时 signal
  const combinedSignal = signal
    ? combineAbortSignals(signal, fetchController.signal)
    : fetchController.signal;

  // Electron 环境：通过主进程 IPC 发起请求，绕过 CORS 和浏览器网络限制
  const electronAPI = (window as unknown as { electronAPI?: { imageGenerate?: (url: string, body: string, apiKey: string) => Promise<{ error: boolean; status?: number; body?: string; data?: unknown }> } }).electronAPI;

  if (electronAPI?.imageGenerate) {
    try {
      const result = await Promise.race([
        electronAPI.imageGenerate(url, JSON.stringify(body), apiKey),
        new Promise<never>((_, reject) => {
          combinedSignal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
          if (combinedSignal.aborted) reject(new Error('AbortError'));
        }),
      ]);
      clearTimeout(fetchTimeout);

      if (result.error) {
        let errorPayload: { detail?: unknown; error?: { message?: string } } = {};
        try { errorPayload = JSON.parse(result.body || '{}'); } catch { /* keep empty */ }
        const detail = typeof errorPayload.detail === 'string' ? errorPayload.detail
          : errorPayload.detail ? JSON.stringify(errorPayload.detail) : '';
        const errorLabel = errorPayload.error?.message || `请求失败: ${result.status}`;
        throw new Error(detail ? `${errorLabel}: ${detail}` : errorLabel);
      }

      const urls = extractUrls(result.data);
      if (urls.length === 0) throw new Error('未返回图片地址');
      return urls;
    } catch (ipcErr: unknown) {
      clearTimeout(fetchTimeout);
      if (ipcErr instanceof Error && (ipcErr.message === 'AbortError' || ipcErr.message.includes('AbortError'))) {
        if (signal?.aborted) throw new Error('请求已取消');
        throw new Error('上游服务响应超时，请稍后重试');
      }
      throw ipcErr;
    }
  }

  // 非 Electron 环境回退：直接 fetch
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
    clearTimeout(fetchTimeout);
  } catch (fetchErr: unknown) {
    clearTimeout(fetchTimeout);
    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
      // 区分外部取消和内部超时
      if (signal?.aborted) {
        throw new Error('请求已取消');
      }
      throw new Error('上游服务响应超时，请稍后重试');
    }
    throw new Error(
      `上游服务请求失败: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
    );
  }

  if (!response.ok) {
    const rawText = await response.text();
    let errorPayload: { detail?: unknown; error?: { message?: string } } = {};
    try {
      errorPayload = JSON.parse(rawText);
    } catch {
      // keep as text
    }
    const detail =
      typeof errorPayload.detail === 'string'
        ? errorPayload.detail
        : errorPayload.detail
          ? JSON.stringify(errorPayload.detail)
          : '';
    const errorLabel = errorPayload.error?.message || `请求失败: ${response.status}`;
    const msg = detail ? `${errorLabel}: ${detail}` : errorLabel;
    throw new Error(msg);
  }

  const data = await response.json();
  const urls = extractUrls(data);
  if (urls.length === 0) {
    throw new Error('未返回图片地址');
  }
  return urls;
}

// 合并多个 AbortSignal
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true });
  }
  return controller.signal;
}
