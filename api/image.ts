// Vercel Edge Function：代理 highwayapi 的图片生成接口
// 同时支持 GPT Image 2（OpenAI 兼容）和 Gemini 系列（jiekou 自定义协议），
// 密钥放在服务端环境变量 HIGHWAY_API_KEY，前端只调用本路由。
export const config = {
  runtime: 'edge',
};

// 上游 base URL，与 api/chat.ts 保持一致来源（highwayapi/jiekou）
const API_BASE = 'https://api.highwayapi.ai';

// GPT Image 2 走 OpenAI 兼容路径（参考 chat.ts 的 /openai/v1 前缀）
const GPT_IMAGE_GEN_URL = `${API_BASE}/openai/v1/images/generations`;
const GPT_IMAGE_EDIT_URL = `${API_BASE}/openai/v1/images/edits`;

// Gemini 系列（Nano Banana / Nano Banana Pro）走 jiekou 自定义协议路径，
// 文档未显式给出完整 URL，按官方平台习惯使用 /v1/images/* 前缀；
// 若上游路径调整，仅需在此处统一修改。
const GEMINI_IMAGE_GEN_URL = `${API_BASE}/v1/images/generations`;
const GEMINI_IMAGE_EDIT_URL = `${API_BASE}/v1/images/edits`;

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

  if (model === 'gpt-image-2') {
    if (isEdit) {
      upstreamUrl = GPT_IMAGE_EDIT_URL;
      upstreamBody = {
        model: 'gpt-image-2',
        image: images![0], // 文档说明支持单张 URL/base64
        prompt,
        n: n || 1,
        size: size || '1024x1024',
        quality: quality || 'low',
      };
    } else {
      upstreamUrl = GPT_IMAGE_GEN_URL;
      upstreamBody = {
        model: 'gpt-image-2',
        prompt,
        n: n || 1,
        size: size || '1024x1024',
        quality: quality || 'medium',
        output_format: outputFormat || 'png',
      };
    }
  } else if (model === 'gemini-3.1-flash' || model === 'gemini-3-pro') {
    if (isEdit) {
      upstreamUrl = GEMINI_IMAGE_EDIT_URL;
      upstreamBody = {
        model,
        prompt,
        image_base64s: images,
        size: size || '1K',
        aspect_ratio: aspectRatio || 'auto',
      };
    } else {
      upstreamUrl = GEMINI_IMAGE_GEN_URL;
      upstreamBody = {
        model,
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
