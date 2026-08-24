/**
 * 图片上下文动作：会话中长按 / 三点菜单触发的高清处理、去除背景、保存本地、塞回输入框。
 *
 * 图片 src 有三种形态：
 *  - aishop-blob:<id>：IndexedDB 内引用，需要用 getBlob 取出真实 Blob
 *  - data:...;base64,...：本身就是数据，直接用
 *  - http(s)：远程地址，用 fetch 取回 Blob
 * 统一先解析成 data URL（Blob → FileReader），再供下载 / 上传输入框 / 交给 fal 处理。
 *
 * 「保存到本地」按平台区分，确保移动端能真正进手机相册：
 *  - Android 原生壳：写缓存文件 → 调系统分享面板（含"保存到相册/图片"目标）
 *  - iOS PWA（Safari）：用 Web Share API Level 2（navigator.share files），面板含"存储图像"
 *  - PC / 其它：浏览器 a.download 下载
 */
import { getBlob, parseBlobRefUrl } from '../db';
import { processImage, type ImageProcessKind } from './imageApi';
import { isNativeAndroid } from '../platform/capabilities';
import { detectPlatform } from '../utils/pwa';
import { saveImageToAndroidGallery } from '../utils/androidGallery';

/**
 * 安卓壳：远程图片走原生 HTTP 桥下载成 data URL。
 * WebView origin 是 https://localhost，fetch 跨域图（如 Pix2Real 的 COS 预签名直链）
 * 拿不到对方的 CORS 头必被拦（报 Failed to fetch）；原生 HttpURLConnection 不受限。
 * 桥不存在时返回 null，调用方退回浏览器 fetch。
 */
async function fetchRemoteImageViaNative(url: string): Promise<string | null> {
  const bridge = (window as unknown as {
    AndroidNativeHttp?: { fetchBytes: (url: string, apiKey: string, cb: string) => void };
  }).AndroidNativeHttp;
  if (!bridge?.fetchBytes) return null;

  const cbName = `__img_dl_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  type Payload = { status?: number; base64?: string; contentType?: string; error?: string };
  const payload = await new Promise<Payload>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    const timer = setTimeout(() => { delete w[cbName]; reject(new Error('图片下载超时')); }, 60_000);
    w[cbName] = (p: Payload) => {
      clearTimeout(timer);
      delete w[cbName];
      if (p?.error) reject(new Error(p.error));
      else resolve(p || {});
    };
    try {
      // 预签名直链自带鉴权，apiKey 传空（原生侧非空才加 x-api-key 头）
      bridge.fetchBytes(url, '', cbName);
    } catch (e) {
      clearTimeout(timer);
      delete w[cbName];
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  const status = payload.status ?? 0;
  if (!(status >= 200 && status < 300)) throw new Error(`图片读取失败: ${status}`);
  const ct = payload.contentType || 'image/png';
  const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
  return `data:${mime};base64,${payload.base64 || ''}`;
}

/** 把任意形态的图片 src 解析成 data URL；失败抛错 */
export async function resolveImageDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;

  const blobId = parseBlobRefUrl(src);
  let blob: Blob;
  if (blobId) {
    const rec = await getBlob(blobId);
    if (!rec) throw new Error('图片不存在');
    blob = rec.blob;
  } else {
    // 安卓壳优先原生通道下载（绕开 CORS）；拿不到桥再退回浏览器 fetch
    if (isNativeAndroid() && /^https?:\/\//i.test(src)) {
      const dataUrl = await fetchRemoteImageViaNative(src);
      if (dataUrl) return dataUrl;
    }
    const res = await fetch(src);
    if (!res.ok) throw new Error('图片读取失败');
    blob = await res.blob();
  }
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

/** 解析成 Blob（下载用）；不支持 blob: 内部协议 URL */
export async function resolveImageBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const res = await fetch(src);
    return res.blob();
  }
  const blobId = parseBlobRefUrl(src);
  if (blobId) {
    const rec = await getBlob(blobId);
    if (!rec) throw new Error('图片不存在');
    return rec.blob;
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error('图片读取失败');
  return res.blob();
}

/** 从 label 生成不含扩展名的安全文件名 */
function baseNameFrom(label: string): string {
  return (label || 'image').replace(/[\\/:*?"<>|\n]/g, '_').slice(0, 40) || 'image';
}

/** 从图片 src / label 推断含扩展名的文件名（优先保真实扩展名，默认 png） */
function fileNameFrom(src: string, label: string): string {
  const m = /\.(png|jpe?g|webp|gif)$/i.exec(src.split(/[?#]/)[0] || '');
  return `${baseNameFrom(label)}.${m ? m[1].toLowerCase() : 'png'}`;
}

/** 仅浏览器下载（PC Web / Electron / Web Share 不可用时的兜底） */
function browserDownload(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // 延后 revoke：立刻撤销可能赶在浏览器真正开始读取之前，下载会失败
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
}

/** 标识"用户取消了系统分享面板"，不是错误；调用方据此隐藏失败提示 */
export const SAVE_SHARE_CANCELED = 'SHARE_CANCELED';

/** iOS PWA / iOS Safari：用 Web Share API Level 2 分享文件，面板含"存储图像/保存到相册" */
async function saveViaWebShare(src: string, label: string): Promise<void> {
  const blob = await resolveImageBlob(src);
  const file = new File([blob], fileNameFrom(src, label), { type: blob.type || 'image/png' });
  // canShare 不确定时用 share + catch 兜底；或用 navigator.canShare 判断
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: label || '图片' });
      return;
    } catch (e) {
      // 用户在系统面板取消 → 不是失败；其它错误原样抛
      if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'NotAllowedError')) {
        throw new Error(SAVE_SHARE_CANCELED, { cause: e });
      }
      throw e;
    }
  }
  // Web Share 不支持（老 Safari）：退回浏览器下载
  browserDownload(blob, file.name);
}

/**
 * 保存图片到设备。移动端走系统能力确保进相册，PC 走浏览器下载。
 */
export async function saveImageToDevice(src: string, label = 'image'): Promise<void> {
  // Android 原生壳：调原生桥用 MediaStore 直接写入相册（一步到位，不弹分享面板）
  if (isNativeAndroid()) {
    await saveImageToAndroidGallery(await resolveImageDataUrl(src), fileNameFrom(src, label));
    return;
  }
  // iOS（含 PWA）：Web Share API → 系统面板存相册；非 iOS 走浏览器下载
  if (detectPlatform() === 'ios') {
    await saveViaWebShare(src, label);
    return;
  }
  // 其它（PC Web / Electron 等）：浏览器下载
  const blob = await resolveImageBlob(src);
  browserDownload(blob, fileNameFrom(src, label));
}

/**
 * 图片特殊处理：高清放大 / 去除背景。
 * 返回处理后的图片地址（fal 返回的临时 http url），由调用方决定落位（插入会话等）。
 */
export async function processImageAction(
  kind: ImageProcessKind,
  src: string
): Promise<string> {
  const dataUrl = await resolveImageDataUrl(src);
  return processImage(kind, dataUrl);
}

/** 事件名：把图片 data URL 塞进聊天输入框待发送（ChatInput 监听） */
export const ATTACH_CHAT_IMAGE_EVENT = 'aishop:attach-chat-image';
/** 事件名：把一张图片消息以 AI 回复形式插入当前会话（App 层监听，调用 useChat.postImageMessage） */
export const POST_IMAGE_MESSAGE_EVENT = 'aishop:post-image-message';

/** 触发"塞图进聊天输入框" */
export function dispatchAttachChatImage(dataUrl: string): void {
  window.dispatchEvent(new CustomEvent(ATTACH_CHAT_IMAGE_EVENT, { detail: dataUrl }));
}

/** 触发"插入图片消息到当前会话" */
export function dispatchPostImageMessage(title: string, urls: string[]): void {
  window.dispatchEvent(new CustomEvent(POST_IMAGE_MESSAGE_EVENT, { detail: { title, urls } }));
}
