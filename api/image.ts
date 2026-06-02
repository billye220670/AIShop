// Vercel Serverless Function：代理 highwayapi 的图片生成接口
// 同时支持 GPT Image 2（OpenAI 兼容）和 Gemini 系列（jiekou 自定义协议），
// 密钥放在服务端环境变量 HIGHWAY_API_KEY，前端只调用本路由。
// 使用 Vercel 标准 Node.js Serverless 格式（VercelRequest/VercelResponse），
// 超时 60s（Edge Runtime 仅 25s，图片生成不够用）。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  checkLocked,
  delay,
  FAIL_DELAY_MS,
  getNodeClientIp,
  recordFailure,
  recordSuccess,
  timingSafeEqual,
} from './_lib/access.js';

export const maxDuration = 60;

// 提高 body parser 大小限制，避免上传 base64 参考图时被默认 1MB 限制拒绝（ERR_CONNECTION_RESET）。
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // 1. 验证请求方法
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. 访问码校验（防滥用 + 限速）：仅在服务端配置 ACCESS_CODE 时启用
  const expectedCode = process.env.ACCESS_CODE;
  if (expectedCode) {
    const ip = getNodeClientIp(req.headers);
    const lockSeconds = checkLocked(ip);
    if (lockSeconds > 0) {
      res.setHeader('Retry-After', String(lockSeconds));
      return res.status(429).json({
        error: 'Too many failed attempts, try again later',
        retryAfter: lockSeconds,
      });
    }
    const headerVal = req.headers['x-access-code'];
    const provided = Array.isArray(headerVal) ? headerVal[0] || '' : headerVal || '';
    if (!timingSafeEqual(provided, expectedCode)) {
      recordFailure(ip);
      await delay(FAIL_DELAY_MS);
      return res.status(401).json({ error: 'Invalid access code' });
    }
    recordSuccess(ip);
  }

  // 3. 校验密钥
  const apiKey = process.env.HIGHWAY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'HIGHWAY_API_KEY not configured' });
  }

  // 3. 解析请求体（Vercel Serverless 已自动解析 JSON body；
  //    但仍要兼容字符串体的兜底情况）
  let payload: ImageRequestBody;
  try {
    if (typeof req.body === 'string') {
      payload = JSON.parse(req.body) as ImageRequestBody;
    } else if (req.body && typeof req.body === 'object') {
      payload = req.body as ImageRequestBody;
    } else {
      payload = {};
    }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
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
    return res.status(400).json({ error: 'Missing required field: model' });
  }
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing required field: prompt' });
  }

  const isEdit = Array.isArray(images) && images.length > 0;

  // 4. 根据 model + 是否带参考图决定上游路由与请求体
  let upstreamUrl: string;
  let upstreamBody: Record<string, unknown>;

  // 上游路径已隐含模型信息，请求体不需要再带 model 字段
  if (model === 'gpt-image-2') {
    if (isEdit) {
      upstreamUrl = UPSTREAM_URLS['gpt-image-2'].edit;
      // GPT Image 2 编辑接口 image 字段为 string（标量），仅支持单张参考图。
      // OpenAI 兼容协议要求 base64 必须带完整 data URI 前缀（data:image/jpeg;base64,...），
      // 否则上游无法识别图片 MIME 类型，请求会一直挂起直到 Vercel 60s 超时。
      const rawImage = images![0];
      let formattedImage: string;
      if (rawImage.startsWith('http://') || rawImage.startsWith('https://')) {
        // URL 直接传
        formattedImage = rawImage;
      } else if (rawImage.startsWith('data:')) {
        // 已是 data URI，直接透传
        formattedImage = rawImage;
      } else {
        // 裸 base64 → 补上 data URI 前缀（前端 compressImage 输出 JPEG）
        formattedImage = `data:image/jpeg;base64,${rawImage}`;
      }
      upstreamBody = {
        image: formattedImage,
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
      // Gemini 编辑接口区分 image_urls / image_base64s。
      // 分流逻辑：以 http(s):// 开头 → URL；其余（裸 base64 或 data URI）→ base64。
      // image_base64s 字段需要裸 base64（无 data URI 前缀）。
      const base64s: string[] = [];
      const urlList: string[] = [];
      for (const img of images!) {
        if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))) {
          urlList.push(img);
        } else if (typeof img === 'string') {
          // 裸 base64 或 data URI → 统一提取裸 base64
          const raw = img.startsWith('data:') ? (img.split(',')[1] || img) : img;
          base64s.push(raw);
        }
      }
      upstreamBody = {
        prompt,
        size: size || '1K',
        ...(aspectRatio && aspectRatio !== 'auto' ? { aspect_ratio: aspectRatio } : {}),
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
    return res.status(400).json({ error: `Unsupported model: ${model}` });
  }

  // 5. 发起上游请求
  let upstream: Response;
  const fetchController = new AbortController();
  const fetchTimeout = setTimeout(() => fetchController.abort(), 50000);

  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
      signal: fetchController.signal,
    });
    clearTimeout(fetchTimeout);
  } catch (fetchErr: unknown) {
    clearTimeout(fetchTimeout);
    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
      return res.status(504).json({
        error: '上游服务响应超时，请稍后重试',
      });
    }
    return res.status(502).json({
      error: '上游服务请求失败',
      detail: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
    });
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
    return res
      .status(upstream.status)
      .json({ error: 'Upstream API error', detail: errorPayload });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return res.status(502).json({
      error: 'Upstream returned non-JSON response',
      detail: rawText,
    });
  }

  const urls = extractUrls(parsed);
  if (urls.length === 0) {
    return res
      .status(502)
      .json({ error: 'No image returned from upstream', detail: parsed });
  }

  // 7. 统一返回 { urls: string[] }
  return res.status(200).json({ urls });
}
