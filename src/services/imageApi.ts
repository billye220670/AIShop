import type { ImageGenerationParams } from '../types';
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';
import { generateViaPix2Real, PIX2REAL_MODEL_ID } from './pix2realApi';

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
  // ---- Fal AI 网关注入的模型（走 queue.fal.run/<endpoint-id>，异步轮询） ----
  'fal-nano-banana-pro': {
    textToImage: '/fal-ai/nano-banana-pro',
    edit: '/fal-ai/nano-banana-pro/edit',
  },
  'fal-nano-banana-2': {
    textToImage: '/fal-ai/nano-banana-2',
    edit: '/fal-ai/nano-banana-2/edit',
  },
  'fal-grok-imagine': {
    textToImage: '/xai/grok-imagine-image/v2.0/text-to-image',
    edit: '/xai/grok-imagine-image/v2.0/edit',
  },
  'fal-seedream-5': {
    textToImage: '/bytedance/seedream/v5/pro/text-to-image',
    edit: '/bytedance/seedream/v5/pro/edit',
  },
  'fal-gpt-image-2': {
    textToImage: '/openai/gpt-image-2',
    edit: '/openai/gpt-image-2/edit',
  },
};

// Fal AI 需要差异化处理：认证用 `Key <key>`、body 参数各模型不同、图片要上传到 fal CDN 拿 URL、
// 生成走 queue 异步轮询（提交 → 轮询状态 → 取结果）。其余原生提供商沿用原先的 Bearer 直连逻辑。
const FAL_MODEL_IDS = new Set([
  'fal-nano-banana-pro',
  'fal-nano-banana-2',
  'fal-grok-imagine',
  'fal-seedream-5',
  'fal-gpt-image-2',
]);

function isFalModel(model: string): boolean {
  return FAL_MODEL_IDS.has(model);
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
  const { prompt, model, images, aspectRatio, size, quality, outputFormat, n } = params;

  if (!model) {
    throw new Error('Missing required field: model');
  }
  if (!prompt || !prompt.trim()) {
    throw new Error('Missing required field: prompt');
  }

  // Pix2Real：自建服务，走 smart-tasks 智能任务协议（服务端选工作流）。
  // 提示词与参考图在这里全程透传，调用方已保证不做优化。
  if (model === PIX2REAL_MODEL_ID) {
    const result = await generateViaPix2Real(prompt, images || [], signal);
    return result.urls;
  }

  // API 网关由模型本身决定：fal- 前缀模型走 Fal AI 网关；其余模型的 endpoint 均由
  // 接口AI 网关提供，固定走 fastapi。（设置里的「图片提供商」只用于选择器分组展示，
  // 不直接决定请求路由，这样切网关不会与旧模型选择互相踩踏。）
  const provider = isFalModel(model) ? 'falai' : 'fastapi';
  const apiKey = await settingsService.getApiKey(provider);
  const config = getProviderConfig(provider);

  // Fal AI 模型走独立的 queue 异步协议（含本地图片上传、参数适配、轮询取结果）
  if (isFalModel(model)) {
    return generateImageViaFal(params, apiKey, signal);
  }

  if (!apiKey) {
    throw new Error('请先在设置中配置图片 API Key');
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

  // 120s 超时控制（GPT Image 2 生成通常需要 60-90s，120s 留足余量）
  const fetchController = new AbortController();
  const fetchTimeout = setTimeout(() => fetchController.abort(), 120000);

  // 合并外部 signal 与超时 signal
  const combinedSignal = signal
    ? combineAbortSignals(signal, fetchController.signal)
    : fetchController.signal;

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

/* ============================ Fal AI 适配 ============================
 * Fal 图片模型走 queue 异步协议：认证头 `Authorization: Key <key>`（非 Bearer），
 * body 参数因模型而异，编辑参考图要先上传到 fal CDN 拿临时 URL，生成结果通过
 * 提交→轮询状态→取结果三步完成。整体超时比原生更长（排队 + 生成可能较久）。
 */

const FAL_CDN_INITIATE_URL = 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3';
const FAL_TOTAL_TIMEOUT = 180_000; // 排队 + 生成总超时
const FAL_POLL_INTERVAL = 2000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// data URI 或裸 base64 → Uint8Array（供 PUT 上传字节流）
function bytesFromBase64(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(',');
  const b64 = (comma >= 0 ? dataUri.slice(comma + 1) : dataUri).trim();
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 发起带鉴权的 fal fetch（鉴权头由调用方通过 init.headers 携带），非 2xx 时解析错误消息抛出 */
async function falFetch(
  url: string,
  init: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    let msg = `Fal AI 请求失败: ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      const detail = (parsed as Record<string, unknown>);
      if (typeof detail.detail === 'string') msg = detail.detail;
      else if (typeof detail.error === 'string') msg = detail.error;
      else if (detail.message) msg = String(detail.message);
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }
  return res;
}

async function falFetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  return falFetch(url, init).then(r => r.json());
}

/** 编辑参考图：http(s) URL 直接用；base64 / data URI 先上传 fal CDN 换临时 URL */
async function uploadFalInputImages(
  images: string[],
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  const urls: string[] = [];
  for (const img of images) {
    if (img.startsWith('http://') || img.startsWith('https://')) {
      urls.push(img);
      continue;
    }
    // 先申请上传凭证（返回 presigned PUT 地址 + 公开读 file_url），再 PUT 字节。
    // initiate 需带鉴权头；presigned PUT 由 fal 发放的 upload_url 自行授权，可不带。
    const init = await falFetchJson(
      FAL_CDN_INITIATE_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
        body: JSON.stringify({ file_name: 'input.jpg', content_type: 'image/jpeg' }),
        signal,
      }
    );
    if (!init.upload_url || !init.file_url) {
      throw new Error('Fal AI 参考图上传初始化失败');
    }
    await falFetch(init.upload_url as string, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Blob([bytesFromBase64(img)] as BlobPart[], { type: 'image/jpeg' }),
      signal,
    });
    urls.push(init.file_url as string);
  }
  return urls;
}

// 按模型构造 fal 请求体。Fal 各模型的尺寸/比例/质量字段命名不同：
//  - NanoBanana Pro/2：resolution(1K/2K/4K) + aspect_ratio
//  - Grok Imagine：resolution(1k/2k) + aspect_ratio + quality(low/medium)
//  - Seedream 5：image_size（如 auto_2K，无独立 ratio/quality 字段）
//  - GPT Image 2：image_size（preset 名或 auto）+ quality(auto/low/medium/high)
function buildFalRequestBody(
  model: string,
  prompt: string,
  imageUrls: string[],
  isEdit: boolean,
  params: ImageGenerationParams
): Record<string, unknown> {
  const { size, aspectRatio, quality, outputFormat, n } = params;
  const numImages = n || 1;

  switch (model) {
    case 'fal-nano-banana-pro':
    case 'fal-nano-banana-2': {
      const body: Record<string, unknown> = {
        prompt,
        num_images: numImages,
        output_format: outputFormat || 'png',
      };
      // resolution 支持 1K/2K/4K；Grok 用 1k/2k 但它不走这个分支
      if (size && size !== '1K') body.resolution = size as string;
      if (aspectRatio && aspectRatio !== 'auto') body.aspect_ratio = aspectRatio as string;
      if (isEdit && imageUrls.length > 0) body.image_urls = imageUrls;
      return body;
    }
    case 'fal-grok-imagine': {
      const body: Record<string, unknown> = {
        prompt,
        num_images: numImages,
        output_format: outputFormat || 'jpeg',
        quality: quality === 'high' ? 'medium' : (quality || 'medium'), // grok 只支持 low/medium
      };
      if (size === '2K' || size === '2k') body.resolution = '2k';
      else body.resolution = '1k';
      if (aspectRatio && aspectRatio !== 'auto') body.aspect_ratio = aspectRatio as string;
      if (isEdit && imageUrls.length > 0) body.image_urls = imageUrls;
      return body;
    }
    case 'fal-seedream-5': {
      // Seedream 的 image_size 是 auto_2K 这类 preset 或 {width,height} 对象，
      // 前端没有对应枚举控件，固定用官方默认 auto_2K，避免传入无效值。
      const body: Record<string, unknown> = {
        prompt,
        num_images: numImages,
        output_format: (outputFormat === 'webp' ? 'png' : (outputFormat || 'jpeg')),
        image_size: 'auto_2K',
      };
      if (isEdit && imageUrls.length > 0) body.image_urls = imageUrls;
      return body;
    }
    case 'fal-gpt-image-2':
    default: {
      // GPT Image 2 的 image_size 是 preset 名（landscape_4_3 等）或 auto，
      // 前端统一的 size('1K'…) 不是有效枚举，故也固定用默认/跟随参考图。
      const body: Record<string, unknown> = {
        prompt,
        num_images: numImages,
        output_format: outputFormat || 'png',
        quality: quality || 'auto',
        image_size: isEdit ? 'auto' : 'landscape_4_3',
      };
      if (isEdit && imageUrls.length > 0) body.image_urls = imageUrls;
      return body;
    }
  }
}

/**
 * Fal AI 队列核心：提交 → 轮询状态 → 取结果，返回响应体 JSON。
 * 认证用 `Authorization: Key <key>`；整体受 FAL_TOTAL_TIMEOUT 超时控制，并合并外部 signal。
 */
async function falSubmitAndWait(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal,
  timeoutMsg = 'Fal AI 生成超时，请稍后重试'
): Promise<Record<string, unknown>> {
  const baseUrl = getProviderConfig('falai').imageBaseUrl;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), FAL_TOTAL_TIMEOUT);
  const combined = signal ? combineAbortSignals(signal, controller.signal) : controller.signal;
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` };
  const abortError = () =>
    signal?.aborted ? new Error('请求已取消') : new Error(timeoutMsg);

  try {
    let submit: Record<string, unknown>;
    try {
      submit = await falFetchJson(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (e) {
      if (signal?.aborted || controller.signal.aborted) throw abortError();
      throw e;
    }

    const requestId = submit.request_id as string | undefined;
    const statusUrl = (submit.status_url as string | undefined)
      || (requestId ? `${baseUrl}${endpoint}/requests/${requestId}/status` : '');
    const responseUrl = (submit.response_url as string | undefined)
      || (requestId ? `${baseUrl}${endpoint}/requests/${requestId}/response` : '');
    if (!requestId) {
      throw new Error('Fal AI 未能取得请求 ID');
    }

    for (;;) {
      if (signal?.aborted || controller.signal.aborted) throw abortError();
      let st: Record<string, unknown>;
      try {
        st = await falFetchJson(statusUrl, { method: 'GET', headers: authHeaders, signal: combined });
      } catch (e) {
        if (signal?.aborted || controller.signal.aborted) throw abortError();
        throw e;
      }
      const status = st.status as string | undefined;
      if (status === 'COMPLETED') break;
      if (st.error) throw new Error(String(st.error));
      if (status && status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') {
        throw new Error(`Fal AI 任务异常状态: ${status}`);
      }
      await sleep(FAL_POLL_INTERVAL);
    }

    try {
      return await falFetchJson(responseUrl, { method: 'GET', headers: authHeaders, signal: combined });
    } catch (e) {
      if (signal?.aborted || controller.signal.aborted) throw abortError();
      throw e;
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fal AI 主流程：编辑参考图上传 → 提交 queue → 轮询状态 → 取结果。
 */
async function generateImageViaFal(
  params: ImageGenerationParams,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (!apiKey) {
    throw new Error('请先在设置中配置图片 API Key（Fal AI）');
  }
  const { prompt, model, images, aspectRatio, size, quality, outputFormat, n } = params;

  const endpoints = IMAGE_ENDPOINTS[model];
  if (!endpoints) {
    throw new Error(`不支持的图片模型: ${model}`);
  }

  const isEdit = Array.isArray(images) && images.length > 0;
  const endpoint = isEdit ? endpoints.edit : endpoints.textToImage;

  const falParams: ImageGenerationParams = { prompt, model, n };
  if (aspectRatio) falParams.aspectRatio = aspectRatio;
  if (size) falParams.size = size;
  if (quality) falParams.quality = quality;
  if (outputFormat) falParams.outputFormat = outputFormat;

  // 1. 编辑参考图 → URL
  let imageUrls: string[] = [];
  if (isEdit && images) {
    try {
      imageUrls = await uploadFalInputImages(images, apiKey, signal);
    } catch (e) {
      if (signal?.aborted) throw new Error('请求已取消', { cause: e });
      throw e;
    }
  }

  // 2~4. 提交 queue 并等待结果
  const body = buildFalRequestBody(model, prompt, imageUrls, isEdit, falParams);
  const data = await falSubmitAndWait(endpoint, body, apiKey, signal);

  const urls = extractUrls(data);
  if (urls.length === 0) {
    throw new Error('未返回图片地址');
  }
  return urls;
}

/* ============================ 图像处理模型（SeedVR / BirefNet） ============================
 * 与生图模型不同，这两类只吃"单张参考图"：输入 image_url 标量，输出 { image: { url } } 单数。
 * 判断器输出 process 意图后由 useChat 调用 processImage 分派；同样走 fal queue 异步协议。
 */

export type ImageProcessKind = 'upscale' | 'bgRemove';

const IMAGE_PROCESS_ENDPOINTS: Record<ImageProcessKind, string> = {
  upscale: '/fal-ai/seedvr/upscale/image/seamless',
  bgRemove: '/fal-ai/birefnet/v2',
};

function buildProcessImageBody(kind: ImageProcessKind, imageUrl: string): Record<string, unknown> {
  if (kind === 'upscale') {
    return {
      image_url: imageUrl,
      upscale_mode: 'factor',
      upscale_factor: 2, // 默认按 2x 放大
      output_format: 'png',
    };
  }
  // bgRemove：BiRefNet 抠图，保留前景
  return {
    image_url: imageUrl,
    refine_foreground: true,
    output_format: 'png',
  };
}

/** 从 fal 处理结果里取单张图片 URL（{ image: { url } }） */
function extractSingleImageUrl(data: Record<string, unknown>): string | undefined {
  const image = data.image as Record<string, unknown> | undefined;
  return typeof image?.url === 'string' ? image.url : undefined;
}

/**
 * 单张参考图的特殊图像处理：高清放大（SeedVR，默认 2x）或去除背景（BirefNet）。
 * sourceUrl 支持 http(s) 地址、data URI、裸 base64（后者会先上传 fal CDN 换临时 URL）。
 * 失败时抛出 Error，复用 fal 通用的错误解析与超时文案。
 */
export async function processImage(
  kind: ImageProcessKind,
  sourceUrl: string,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = await settingsService.getApiKey('falai');
  if (!apiKey) {
    throw new Error('请先在设置中配置图片 API Key（Fal AI）');
  }

  const endpoint = IMAGE_PROCESS_ENDPOINTS[kind];
  if (!endpoint) {
    throw new Error(`不支持的图片处理类型: ${kind}`);
  }

  // 参考图 http 直接用；data URI / 裸 base64 先上传 fal CDN 换 URL
  let inputUrl = sourceUrl;
  if (inputUrl && !inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
    try {
      const uploaded = await uploadFalInputImages([inputUrl], apiKey, signal);
      inputUrl = uploaded[0];
    } catch (e) {
      if (signal?.aborted) throw new Error('请求已取消', { cause: e });
      throw e;
    }
  }
  if (!inputUrl) {
    throw new Error('缺少可处理的参考图');
  }

  const body = buildProcessImageBody(kind, inputUrl);
  const data = await falSubmitAndWait(
    endpoint,
    body,
    apiKey,
    signal,
    kind === 'upscale' ? 'Fal AI 放大超时，请稍后重试' : 'Fal AI 处理超时，请稍后重试'
  );

  const url = extractSingleImageUrl(data);
  if (!url) {
    throw new Error('未返回处理结果图片');
  }
  return url;
}
