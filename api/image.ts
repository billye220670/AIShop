// Vercel Edge Function：代理 highwayapi 的图片生成接口
// 同时支持 GPT Image 2（OpenAI 兼容）和 Gemini 系列（jiekou 自定义协议），
// 密钥放在服务端环境变量 HIGHWAY_API_KEY，前端只调用本路由。
export const config = {
  runtime: 'edge',
};

// 上游 base URL，与 api/chat.ts 保持一致来源（highwayapi/jiekou）
// 注意：图片接口走 jiekou 自定义协议，每个模型独立路径（/v3/{model-slug}-{text-to-image|edit}），
// 与 chat.ts 的 OpenAI 兼容路径（/openai/v1）不同。
const API_BASE = 'https://api.highwayapi.ai';

// 模型 → 上游 endpoint 映射（依据 ImageGenAPI/ 下官方文档的 curl 示例）
const UPSTREAM_URLS = {
  'gpt-image-2': {
    textToImage: `${API_BASE}/v3/gpt-image-2-text-to-image`,
    edit: `${API_BASE}/v3/gpt-image-2-edit`,
  },
  'gemini-3.1-flash': {
    textToImage: `${API_BASE}/v3/gemini-3.1-flash-image-text-to-image`,
    edit: `${API_BASE}/v3/gemini-3.1-flash-image-edit`,
  },
  'gemini-3-pro': {
    textToImage: `${API_BASE}/v3/gemini-3-pro-image-text-to-image`,
    edit: `${API_BASE}/v3/gemini-3-pro-image-edit`,
  },
} as const;

interface ImageRequestBody {
  model?: string;
  prompt?: string;
  images?: string[]; // 参考图：URL 或 base64
  aspectRatio?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  n?: number;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 兼容多种上游响应结构，统一抽取出图片 URL 数组
function extractUrls(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;

  // Gemini: { image_urls: ["..."] }
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

export default async function handler(req: Request): Promise<Response> {
  // 1. 验证请求方法
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // 2. 校验密钥
  const apiKey = process.env.HIGHWAY_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'HIGHWAY_API_KEY not configured' }, 500);
  }

  // 3. 解析请求体
  let payload: ImageRequestBody;
  try {
    payload = (await req.json()) as ImageRequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const {
    model,
    prompt,
    images,
    aspectRatio,
    size,
    quality,
    outputFormat,
    n,
  } = payload;

  if (!model) {
    return jsonResponse({ error: 'Missing required field: model' }, 400);
  }
  if (!prompt || !prompt.trim()) {
    return jsonResponse({ error: 'Missing required field: prompt' }, 400);
  }

  const isEdit = Array.isArray(images) && images.length > 0;

  // 4. 根据 model + 是否带参考图决定上游路由与请求体
  let upstreamUrl: string;
  let upstreamBody: Record<string, unknown>;

  // 上游路径已隐含模型信息，请求体不需要再带 model 字段
  if (model === 'gpt-image-2') {
    if (isEdit) {
      upstreamUrl = UPSTREAM_URLS['gpt-image-2'].edit;
      upstreamBody = {
        // 文档说明 image 支持单张 URL/base64 或图片数组，这里直接透传数组以兼容多图
        image: images!.length === 1 ? images![0] : images,
        prompt,
        n: n || 1,
        size: size || '1024x1024',
        quality: quality || 'low',
        output_format: outputFormat || 'png',
      };
    } else {
      upstreamUrl = UPSTREAM_URLS['gpt-image-2'].textToImage;
      upstreamBody = {
        prompt,
        n: n || 1,
        size: size || '1024x1024',
        quality: quality || 'medium',
        output_format: outputFormat || 'png',
      };
    }
  } else if (model === 'gemini-3.1-flash' || model === 'gemini-3-pro') {
    const urls = UPSTREAM_URLS[model];
    if (isEdit) {
      upstreamUrl = urls.edit;
      // Gemini 编辑接口区分 image_urls / image_base64s。前端传入的 images 已统一为 base64 data URL
      // 或外链 URL，这里按是否以 data: 开头分流。
      const base64s: string[] = [];
      const urlList: string[] = [];
      for (const img of images!) {
        if (typeof img === 'string' && img.startsWith('data:')) {
          base64s.push(img);
        } else if (typeof img === 'string') {
          urlList.push(img);
        }
      }
      upstreamBody = {
        prompt,
        size: size || '1K',
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...(base64s.length > 0 ? { image_base64s: base64s } : {}),
        ...(urlList.length > 0 ? { image_urls: urlList } : {}),
        output_format: outputFormat || 'image/png',
      };
    } else {
      upstreamUrl = urls.textToImage;
      upstreamBody = {
        prompt,
        size: size || '1K',
        aspect_ratio: aspectRatio || '1:1',
        output_format: outputFormat || 'image/png',
      };
    }
  } else {
    return jsonResponse({ error: `Unsupported model: ${model}` }, 400);
  }

  // 5. 发起上游请求
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    return jsonResponse(
      { error: 'Upstream request failed', detail: (err as Error).message },
      502
    );
  }

  // 6. 处理上游响应
  const rawText = await upstream.text();

  if (!upstream.ok) {
    // 透传错误码与原始消息（尽可能解析为 JSON，便于前端展示）
    let errorPayload: unknown = rawText;
    try {
      errorPayload = JSON.parse(rawText);
    } catch {
      // keep rawText
    }
    return new Response(
      JSON.stringify({ error: 'Upstream API error', detail: errorPayload }),
      {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return jsonResponse(
      { error: 'Upstream returned non-JSON response', detail: rawText },
      502
    );
  }

  const urls = extractUrls(parsed);
  if (urls.length === 0) {
    return jsonResponse(
      { error: 'No image returned from upstream', detail: parsed },
      502
    );
  }

  // 7. 统一返回 { urls: string[] }
  return jsonResponse({ urls });
}
