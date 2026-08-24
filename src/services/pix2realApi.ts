/**
 * Pix2Real 智能任务接入（POST /api/v1/smart-tasks）。
 *
 * 与其他图片提供商的关键差异：**提示词不做任何优化**。
 * Pix2Real 服务端自己带 Grok 路由——它要读用户原话来选工作流、补参数，
 * 前端再做一轮"提示词扩写"只会破坏它的判断依据。所以这里全程透传：
 * 用户原文 + 用户上传的原图，一起交给服务端。
 *
 * 协议形状（详见 docs/SMART_TASKS_API.md）：
 *   提交 POST {base}/smart-tasks         → { taskId } 或 { status: 'needs_clarification', question }
 *   轮询 GET  {base}/tasks/:taskId       → { status, progress, results | resultUrls, error }
 * 两步都带 `x-api-key` 头。提交侧超时要放宽到 60s 以上（工作流 5/10 会先同步跑一次 SAM）。
 */
import { settingsService } from './settingsService';
import { PIX2REAL_DEFAULT_BASE_URL } from '../config/providers';
import { isNativeAndroid } from '../platform/capabilities';

/** 提供商 id，与设置面板 / 模型归属映射共用 */
export const PIX2REAL_PROVIDER = 'pix2real';

/** 聊天里 Pix2Real 唯一的图片模型 id（服务端自动选工作流，前端不暴露具体工作流） */
export const PIX2REAL_MODEL_ID = 'pix2real-smart';

/** 提交请求超时：工作流 5/10 提交前会同步跑 SAM 生成蒙版，文档要求 ≥60s */
const SUBMIT_TIMEOUT = 90_000;
/** 轮询总超时：ComfyUI 生成 30~60s，排队时可能更久 */
const POLL_TOTAL_TIMEOUT = 600_000;
/** 轮询间隔，与文档建议一致 */
const POLL_INTERVAL = 1500;
/** 参考图数量上限（文档 §3：最多 2 项，第一张主图、第二张脸图） */
export const PIX2REAL_MAX_IMAGES = 2;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/* ------------------------- Android 原生 HTTP 通道 -------------------------
 * Pix2Real 自建服务的 CORS 没对 WebView origin（https://localhost）放开，预检拿不到
 * Access-Control-Allow-Origin，浏览器 fetch 直接被拦（报错与明文拦截同为 opaque，
 * 无法区分）。原生 HttpURLConnection 不受同源策略约束，因此安卓壳提供 AndroidNativeHttp
 * 桥（MainActivity.NativeHttpBridge），Pix2Real 的请求在安卓上一律走原生通道；
 * Web/Electron 维持 fetch 原路径不动。
 */

/** Android 壳注入的原生 HTTP 桥（MainActivity.addJavascriptInterface） */
type AndroidNativeHttpBridge = {
  fetchText(method: string, url: string, apiKey: string, bodyJson: string | null, cb: string): void;
  postMultipart(url: string, apiKey: string, prompt: string, imagesJson: string, cb: string): void;
  fetchBytes(url: string, apiKey: string, cb: string): void;
};
const androidNativeHttp = () =>
  (window as unknown as { AndroidNativeHttp?: AndroidNativeHttpBridge }).AndroidNativeHttp;

/** 仅安卓原生壳且桥已注入时启用原生通道 */
function getNativeHttp(): AndroidNativeHttpBridge | undefined {
  if (!isNativeAndroid()) return undefined;
  return androidNativeHttp();
}

/**
 * 取原生桥,带短暂重试。
 * addJavascriptInterface 注入的接口要等 WebView 下一次导航才对页面可见;
 * 壳里的兜底注册发生在 onPageStarted,极端情况下可能晚于首屏 JS。
 * 在安卓壳内却拿不到桥时等最多 2s,避免误掉回浏览器 fetch(必被 CORS 拦)。
 */
async function ensureNativeHttp(): Promise<AndroidNativeHttpBridge | undefined> {
  let bridge = getNativeHttp();
  if (bridge || !isNativeAndroid()) return bridge;
  for (let i = 0; i < 10 && !bridge; i++) {
    await sleep(200);
    bridge = getNativeHttp();
  }
  if (!bridge) console.error('[pix2real] 警告:检测到安卓壳但 AndroidNativeHttp 桥未注入,将退回浏览器 fetch');
  return bridge;
}

/**
 * 自诊断快照：出错时随报错文案一起展示。
 * 关键用途：安卓上若看到 inAndroidShell=true 但 bridge=missing，
 * 说明原生桥没注入成功（MainActivity 注册问题）；bridge=ok 却仍报
 * 「无法连接」则说明走了别的路径——两种情况的修复方向完全不同。
 */
function diagSnapshot(baseUrl: string): string {
  return `[诊断: inAndroidShell=${isNativeAndroid()}, bridge=${androidNativeHttp() ? 'ok' : 'missing'}, url=${baseUrl}]`;
}

interface NativeHttpPayload {
  status?: number;
  body?: string;
  base64?: string;
  contentType?: string;
  error?: string;
}

/**
 * 调原生桥并把挂名 window 的回调 Promise 化。
 * 原生侧不支持取消，JS 侧用 timeout 兜底（比原生读超时略长，避免误判）。
 */
function callNativeHttp(
  invoke: (cbName: string) => void,
  timeoutMs: number
): Promise<NativeHttpPayload> {
  return new Promise((resolve, reject) => {
    const cbName = `__pix2real_http_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
    const w = window as unknown as Record<string, unknown>;
    const timer = setTimeout(() => {
      delete w[cbName];
      reject(new Error('原生 HTTP 请求超时'));
    }, timeoutMs);
    w[cbName] = (payload: NativeHttpPayload) => {
      clearTimeout(timer);
      delete w[cbName];
      if (payload?.error) reject(new Error(payload.error));
      else resolve(payload || {});
    };
    try {
      invoke(cbName);
    } catch (e) {
      clearTimeout(timer);
      delete w[cbName];
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** 需要用户补充素材时抛出：调用方把 question 原样回给用户，不要重试 */
export class Pix2RealClarificationError extends Error {
  readonly missing: string[];
  constructor(question: string, missing: string[] = []) {
    super(question);
    this.name = 'Pix2RealClarificationError';
    this.missing = missing;
  }
}

export interface Pix2RealResult {
  /** 结果图片地址（COS 启用时是预签名直链，否则已转成 data URL） */
  urls: string[];
  /** 服务端选中的工作流名，用于回显给用户 */
  workflowName?: string;
  /** 一句中文路由说明，可直接展示 */
  reason?: string;
  /** 超出 API 上限被丢掉的参考图数量（0 表示全部传上去了），供调用方提示用户 */
  droppedImages: number;
}

/** 取服务地址：用户配置优先，未配置回落内置默认值；统一去掉尾部斜杠 */
async function resolveBaseUrl(): Promise<string> {
  const configured = await settingsService.getBaseUrl(PIX2REAL_PROVIDER);
  return (configured || PIX2REAL_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * 解析上游错误消息，尽最大努力保住服务端原文。
 *
 * 已知字段优先；都没命中时**不丢原文**——退回整段响应体。服务端的错误字段名
 * 无法穷举（error / message / detail / msg / reason…），猜不中就吞掉原文的话，
 * 用户拿到的只剩一个状态码，等于没有诊断信息。
 */
function parseErrorMessage(rawText: string, status: number): string {
  const raw = rawText.trim();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const field of ['error', 'message', 'detail', 'msg', 'reason']) {
      const v = parsed[field];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object') return JSON.stringify(v);
    }
    // 字段名没猜中：整段 JSON 回显，总好过只剩状态码
    if (raw) return raw.slice(0, 300);
  } catch {
    if (raw) return raw.slice(0, 300);
  }
  return `Pix2Real 请求失败: ${status}`;
}

/**
 * 状态码 → 补充排查提示（对应文档 §6 错误码表）。
 *
 * 关键：**不替换服务端的原文**。服务端最清楚自己为什么失败（比如 503 会说
 * "COS 未启用，请改用文件上传"），把它换成前端猜的一句套话，等于把唯一有效的
 * 诊断信息丢掉。这里只在原文之外附加一条排查方向，原文始终保留在最前面。
 */
function describeStatus(status: number, serverMessage: string): string {
  const hint = ((): string => {
    switch (status) {
      case 401:
        return 'API Key 无效，请在设置中检查';
      case 403:
        return '对外 API 未开启，检查服务端 config.json 的 externalApi.enabled';
      case 502:
        return '服务端路由不可用，检查服务端 grok.apiKey；属上游故障，可退避重试';
      case 503:
        // 本客户端从不传 COS key、也不调 presign，只用 multipart 直传。
        // 因此这里的 503 只能是服务端内部环节依赖 COS，属服务端配置问题——
        // 不是临时故障，重试无用，必须指向配置。
        return '服务端对象存储（COS）未启用。本客户端已是 multipart 直传、不传 key，'
          + '故此项需在服务端排查 config.json 的 cos 配置；这是配置问题，重试无效';
      case 504:
        return '服务端自动蒙版识别超时（工作流 5/10），可重试';
      default:
        return '';
    }
  })();

  const base = serverMessage.trim();
  if (!hint) return base || `Pix2Real 请求失败: ${status}`;
  return base ? `${base}（${hint}）` : `Pix2Real ${status}：${hint}`;
}

/** 合并外部取消信号与内部超时信号 */
function combineSignals(...signals: AbortSignal[]): AbortSignal {
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

/** data URI / 裸 base64 → Blob，供 multipart 上传（无 data 前缀时按 JPEG 处理） */
function blobFromBase64(image: string): Blob {
  const comma = image.indexOf(',');
  const meta = comma >= 0 ? image.slice(0, comma) : '';
  const b64 = (comma >= 0 ? image.slice(comma + 1) : image).trim();
  const mimeMatch = meta.match(/^data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes] as BlobPart[], { type: mime });
}

/**
 * 远程参考图 → Blob。
 *
 * 上一轮产物可能是 COS 预签名直链，服务端的 url 通道有白名单限制，
 * 所以这里前端拉下来当字节传，避免"能看见却传不进去"。
 */
async function fetchRemoteAsBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`参考图读取失败: ${res.status}`);
  return res.blob();
}

/** 从上游任务详情里抽结果图片地址：兼容 results.outputs[].url 与 resultUrls[] 两种形状 */
function extractResultUrls(task: Record<string, unknown>): string[] {
  const results = task.results as Record<string, unknown> | undefined;
  const outputs = results?.outputs;
  if (Array.isArray(outputs)) {
    const urls = outputs
      .map(o => {
        if (typeof o === 'string') return o;
        const item = o as Record<string, unknown>;
        return typeof item.url === 'string' ? item.url : '';
      })
      .filter(Boolean);
    if (urls.length > 0) return urls;
  }
  if (Array.isArray(task.resultUrls)) {
    return (task.resultUrls as unknown[]).filter((u): u is string => typeof u === 'string');
  }
  return [];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * 结果地址归一化为「能直接放进 <img> 的地址」。
 *
 * 上游有两种产物地址（文档 §8 末）：
 *  - COS 启用：预签名直链，自带签名、能直接渲染，但**每次轮询现签、不可长期缓存**；
 *  - COS 未启用：本机下载路径，取用要带 `x-api-key`——而 `<img src>` 带不了请求头。
 *
 * 判定不靠嗅探签名参数（各家命名不一），而是比对 host：与服务地址同源的就是
 * 本机下载路径，需要带 key 拉下来转 data URL；异源的是对象存储直链，原样用。
 * 拉取失败退回原地址，至少不丢结果。
 */
async function resolveDisplayUrls(
  urls: string[],
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  let serviceHost = '';
  try {
    serviceHost = new URL(baseUrl).host;
  } catch { /* 地址不合法时按"全部需要鉴权"处理 */ }

  const out: string[] = [];
  for (const url of urls) {
    const isAbsolute = /^https?:\/\//i.test(url);
    const absolute = isAbsolute ? url : `${baseUrl}/${url.replace(/^\/+/, '')}`;

    // 相对路径必然是本机下载路径；绝对地址按 host 是否同源判断
    let needsKey = !isAbsolute;
    if (isAbsolute) {
      try {
        needsKey = new URL(absolute).host === serviceHost;
      } catch {
        needsKey = false;
      }
    }
    if (!needsKey) {
      out.push(absolute);
      continue;
    }
    try {
      const native = await ensureNativeHttp();
      if (native) {
        // 安卓 WebView：带自定义头的跨域取图同样会被 CORS 拦，走原生字节下载转 data URL
        const payload = await callNativeHttp(cb => native.fetchBytes(absolute, apiKey, cb), 60_000);
        if (!((payload.status ?? 0) >= 200 && (payload.status ?? 0) < 300)) {
          throw new Error(String(payload.status));
        }
        const ct = payload.contentType || 'image/png';
        const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
        out.push(`data:${mime};base64,${payload.base64 || ''}`);
        continue;
      }
      const res = await fetch(absolute, { headers: { 'x-api-key': apiKey }, signal });
      if (!res.ok) throw new Error(String(res.status));
      out.push(await blobToDataUrl(await res.blob()));
    } catch (e) {
      if (signal?.aborted) throw new Error('请求已取消', { cause: e });
      out.push(absolute);
    }
  }
  return out;
}

interface SubmitResponse {
  taskId?: string;
  status?: string;
  question?: string;
  missing?: string[];
  workflowName?: string;
  routing?: { reason?: string };
}

/**
 * 提交智能任务。
 *
 * prompt 必须是**用户原话**：服务端 Grok 要靠它选工作流，前端不做任何改写。
 * 参考图顺序有语义（第一张主图，第二张脸图），保持调用方给的顺序，不重排。
 */
async function submitSmartTask(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  images: string[],
  signal?: AbortSignal
): Promise<SubmitResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), SUBMIT_TIMEOUT);
  const combined = signal ? combineSignals(signal, controller.signal) : controller.signal;

  // 有图统一走 multipart 字节直传（字段名 images，可重复，见文档 §3.2）。
  // 不用 JSON 的 url 通道：那条通道有服务端 URL 白名单（不在白名单直接 400），
  // 而聊天里的参考图来源不固定（本地上传、上一轮产物…），字节直传能一致成立。
  // 也不绕 COS presign：聊天场景一两张图，多两次往返不划算。
  const native = await ensureNativeHttp();
  console.error(`[pix2real] submit 通道: ${native ? 'Android 原生 HTTP 桥' : '浏览器 fetch'} ${diagSnapshot(baseUrl)}`);
  let init: RequestInit | null = null;
  if (!native) {
    if (images.length > 0) {
      const form = new FormData();
      form.append('prompt', prompt);
      // 顺序即语义（第一张主图、第二张脸图），逐张顺序 append，不做并行重排
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const blob = /^https?:\/\//i.test(img)
          ? await fetchRemoteAsBlob(img, combined)
          : blobFromBase64(img);
        const ext = (blob.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
        form.append('images', blob, `image-${i + 1}.${ext}`);
      }
      init = { method: 'POST', headers: { 'x-api-key': apiKey }, body: form, signal: combined };
    } else {
      init = {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: combined,
      };
    }
  }

  try {
    let status: number;
    let text: string;
    if (native) {
      // 安卓 WebView：原生 HTTP 通道不受同源策略约束，绕开服务端未放开的 CORS。
      // 参考图统一还原成 data URL 交给原生侧拼 multipart（顺序即语义，逐张顺序）
      if (signal?.aborted) throw new Error('请求已取消');
      const nativeTimeout = SUBMIT_TIMEOUT + 45_000; // 原生读超时 120s，JS 侧略放宽
      let payload: NativeHttpPayload;
      if (images.length > 0) {
        const items: { dataUrl: string; filename: string }[] = [];
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          let dataUrl = img;
          if (/^https?:\/\//i.test(img)) {
            dataUrl = await blobToDataUrl(await fetchRemoteAsBlob(img, combined));
          } else if (!img.startsWith('data:')) {
            dataUrl = `data:image/jpeg;base64,${img}`;
          }
          const mime = dataUrl.startsWith('data:') ? dataUrl.slice(5, dataUrl.indexOf(';')) : 'image/jpeg';
          const ext = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
          items.push({ dataUrl, filename: `image-${i + 1}.${ext}` });
        }
        payload = await callNativeHttp(
          cb => native.postMultipart(`${baseUrl}/smart-tasks`, apiKey, prompt, JSON.stringify(items), cb),
          nativeTimeout
        );
      } else {
        payload = await callNativeHttp(
          cb => native.fetchText('POST', `${baseUrl}/smart-tasks`, apiKey, JSON.stringify({ prompt }), cb),
          nativeTimeout
        );
      }
      if (signal?.aborted) throw new Error('请求已取消');
      status = payload.status ?? 0;
      text = payload.body ?? '';
    } else {
      const res = await fetch(`${baseUrl}/smart-tasks`, init as RequestInit);
      status = res.status;
      text = await res.text();
      if (!res.ok) {
        // 诊断日志：非 2xx 时保住原始响应，便于区分「服务端 JSON 错误」与「中间层空 body 响应」
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => { headers[k] = v; });
        console.error('[pix2real] submit 失败:', status, { headers, body: text });
      }
    }
    if (!(status >= 200 && status < 300)) {
      if (native) console.error('[pix2real] submit 失败:', status, { body: text });
      throw new Error(describeStatus(status, parseErrorMessage(text, status)));
    }
    return JSON.parse(text) as SubmitResponse;
  } catch (e) {
    if (signal?.aborted) throw new Error('请求已取消', { cause: e });
    if (controller.signal.aborted) throw new Error('Pix2Real 提交超时，请稍后重试', { cause: e });
    if (e instanceof Error && e.message.startsWith('Pix2Real')) throw e;
    // 浏览器把「连不上」和「被 CORS 拦掉」统一报成 TypeError: Failed to fetch，
    // 不给出区分信息（这是规范要求的，避免跨域探测）。这里不假装知道是哪一种，
    // 把两种可能和各自的排查方向都列出来，否则用户只能看到一句无从下手的报错。
    const isOpaqueNetworkError = e instanceof TypeError;
    if (isOpaqueNetworkError) {
      // 诊断日志：opaque 网络错误有两类——明文 HTTP 被 Android 拦截（请求根本没发出）
      // 或 CORS 预检被拒（请求发出了但响应被浏览器丢弃）。用 no-cors 探测区分两者：
      // no-cors 绕过 CORS 检查，若它成功（opaque 响应）说明网络与明文都通 → 是 CORS 问题；
      // 若它也抛错 → 明文被拦截或服务不可达（自定义头在 no-cors 下会被剥离，401 也无妨）
      void (async () => {
        try {
          const probe = await fetch(`${baseUrl}/tasks/__diag_probe__`, { mode: 'no-cors' });
          console.error(`[pix2real] 诊断：no-cors 探测成功(type=${probe.type})，网络与明文均通 → 判定为 CORS 预检被拒`);
        } catch (probeErr) {
          console.error('[pix2real] 诊断：no-cors 探测也失败 → 明文 HTTP 被拦截或服务不可达', probeErr);
        }
      })();
      throw new Error(
        `无法连接 Pix2Real 服务（${baseUrl}）。浏览器不区分以下两种原因，请逐个排查：\n`
          + `1) 服务没起或地址不对——确认 npm run dev:headless 在跑，且设置里的地址与端口一致；\n`
          + `2) 服务端未放行跨域——本应用在浏览器/Electron 渲染进程里发请求，受同源策略限制。`
          + `请求带了 x-api-key 头，会先发一个 OPTIONS 预检，服务端需要正确响应预检`
          + `并在响应里带上 Access-Control-Allow-Origin / -Headers。\n`
          + diagSnapshot(baseUrl),
        { cause: e }
      );
    }
    throw new Error(
      `Pix2Real 服务连接失败（${baseUrl}）：${e instanceof Error ? e.message : String(e)} ${diagSnapshot(baseUrl)}`,
      { cause: e }
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** 轮询任务直到完成，返回上游任务详情；complete 之外的终态一律抛错 */
async function pollTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + POLL_TOTAL_TIMEOUT;
  console.error(`[pix2real] poll 通道: ${(await ensureNativeHttp()) ? 'Android 原生 HTTP 桥' : '浏览器 fetch'}`);
  for (;;) {
    if (signal?.aborted) throw new Error('请求已取消');
    if (Date.now() > deadline) throw new Error('Pix2Real 生成超时，请稍后重试');

    let task: Record<string, unknown>;
    try {
      const native = await ensureNativeHttp();
      if (native) {
        // 安卓 WebView：同提交一样走原生通道，避开 CORS
        const payload = await callNativeHttp(
          cb => native.fetchText('GET', `${baseUrl}/tasks/${encodeURIComponent(taskId)}`, apiKey, null, cb),
          60_000
        );
        const status = payload.status ?? 0;
        const body = payload.body ?? '';
        if (!(status >= 200 && status < 300)) {
          console.error('[pix2real] poll 失败:', status, { body });
          throw new Error(describeStatus(status, parseErrorMessage(body, status)));
        }
        task = JSON.parse(body) as Record<string, unknown>;
      } else {
        const res = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
          headers: { 'x-api-key': apiKey },
          signal,
        });
        if (!res.ok) {
          const text = await res.text();
          // 诊断日志：轮询阶段非 2xx 同样记录原始响应
          const headers: Record<string, string> = {};
          res.headers.forEach((v, k) => { headers[k] = v; });
          console.error('[pix2real] poll 失败:', res.status, { headers, body: text });
          throw new Error(describeStatus(res.status, parseErrorMessage(text, res.status)));
        }
        task = (await res.json()) as Record<string, unknown>;
      }
    } catch (e) {
      if (signal?.aborted) throw new Error('请求已取消', { cause: e });
      throw e instanceof Error ? e : new Error(String(e), { cause: e });
    }

    const status = typeof task.status === 'string' ? task.status : '';
    if (status === 'completed') return task;
    if (status === 'error' || status === 'failed' || status === 'canceled') {
      const err = typeof task.error === 'string' && task.error ? task.error : '任务执行失败';
      throw new Error(err);
    }
    await sleep(POLL_INTERVAL);
  }
}

/**
 * Pix2Real 生图主流程：提交 → 轮询 → 结果地址归一化。
 *
 * @param prompt 用户原话，**不要预处理**（服务端 Grok 靠原话选工作流）
 * @param images 参考图，顺序有语义（第一张主图，第二张脸图），最多 2 张
 * @throws Pix2RealClarificationError 服务端判定素材不足需要追问时
 */
export async function generateViaPix2Real(
  prompt: string,
  images: string[] = [],
  signal?: AbortSignal
): Promise<Pix2RealResult> {
  const apiKey = await settingsService.getApiKey(PIX2REAL_PROVIDER);
  if (!apiKey) {
    throw new Error('请先在设置中配置 Pix2Real 的 API Key');
  }
  const baseUrl = await resolveBaseUrl();

  // 超过上限时保留前两张（文档 §3：最多 2 项，顺序有语义，截尾不重排）
  const refs = images.slice(0, PIX2REAL_MAX_IMAGES);

  const submit = await submitSmartTask(baseUrl, apiKey, prompt, refs, signal);

  if (submit.status === 'needs_clarification' || (!submit.taskId && submit.question)) {
    throw new Pix2RealClarificationError(
      submit.question || '这个需求还缺一些素材，能再补充一下吗？',
      Array.isArray(submit.missing) ? submit.missing : []
    );
  }
  if (!submit.taskId) {
    throw new Error('Pix2Real 未返回任务 ID');
  }

  const task = await pollTask(baseUrl, apiKey, submit.taskId, signal);
  const rawUrls = extractResultUrls(task);
  if (rawUrls.length === 0) {
    throw new Error('Pix2Real 未返回结果图片');
  }
  const urls = await resolveDisplayUrls(rawUrls, baseUrl, apiKey, signal);

  return {
    urls,
    workflowName: typeof submit.workflowName === 'string' ? submit.workflowName : undefined,
    reason: submit.routing?.reason,
    droppedImages: images.length - refs.length,
  };
}
