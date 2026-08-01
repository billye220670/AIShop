/**
 * 运行时 Message 与存盘 StoredMessage 之间的转换。
 *
 * 图片的处理方式：存盘时把 data URL 落成 blob 并只留 blobId；读回时不直接
 * 造 object URL（那样会漏，且读会话就得把所有图片解出来），而是写成
 * `aishop-blob:<id>` 这个自定义 URL。真正的 object URL 由 UI 侧的
 * useBlobUrl 在需要渲染时按需创建、卸载时 revoke。
 * 好处是 types/index.ts 的 MessageContent 不用改。
 */
import type { Message, MessageContent, MessageVersion } from '../types';
import { estimateMessageTokens } from '../utils/tokenEstimate';
import { getBlob, putBlobFromDataUrl } from './blobRepo';
import type { StoredContentPart, StoredMessage, StoredMessageVersion } from './schema';

const BLOB_URL_PREFIX = 'aishop-blob:';

export function isBlobRefUrl(url: string): boolean {
  return url.startsWith(BLOB_URL_PREFIX);
}

export function blobRefUrl(blobId: string): string {
  return BLOB_URL_PREFIX + blobId;
}

export function parseBlobRefUrl(url: string): string | null {
  return isBlobRefUrl(url) ? url.slice(BLOB_URL_PREFIX.length) : null;
}

/** 从存盘内容里收集所有 blobId，用于引用计数增减 */
export function collectBlobIds(content: string | StoredContentPart[]): string[] {
  if (typeof content === 'string') return [];
  return content.filter(p => p.type === 'image_ref').map(p => p.blobId);
}

export function collectMessageBlobIds(msg: StoredMessage): string[] {
  const ids = collectBlobIds(msg.content);
  for (const v of msg.versions ?? []) ids.push(...collectBlobIds(v.content));
  return ids;
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
 * 把消息里的 `aishop-blob:<id>` 还原成 data URL，供发送给模型使用。
 *
 * 必须做这一步：模型拿到 aishop-blob: 这种自定义协议的地址读不了图。
 * 只在真正发请求前调用，不要提前展开——那会把整段历史的图片都读进内存。
 * 取不到的 blob 直接丢掉该分片，宁可少一张图也不要整个请求 400。
 */
export async function inlineBlobsForApi(
  content: Message['content']
): Promise<Message['content']> {
  if (typeof content === 'string') return content;

  const out: MessageContent[] = [];
  for (const part of content) {
    const blobId =
      part.type === 'image_url' && part.image_url?.url
        ? parseBlobRefUrl(part.image_url.url)
        : null;

    if (!blobId) {
      out.push(part);
      continue;
    }

    const record = await getBlob(blobId);
    if (!record) continue;
    out.push({ type: 'image_url', image_url: { url: await blobToDataUrl(record.blob) } });
  }
  return out;
}

async function contentToStored(
  content: Message['content']
): Promise<string | StoredContentPart[]> {
  if (typeof content === 'string') return content;

  const parts: StoredContentPart[] = [];
  for (const part of content) {
    if (part.type === 'image_url' && part.image_url?.url) {
      const url = part.image_url.url;
      // 已经是引用形式说明这条消息是从库里读出来又写回去的，别重复入库
      const existing = parseBlobRefUrl(url);
      parts.push({
        type: 'image_ref',
        blobId: existing ?? (await putBlobFromDataUrl(url)),
      });
    } else {
      parts.push({ type: 'text', text: part.text ?? '' });
    }
  }
  return parts;
}

function contentFromStored(
  content: string | StoredContentPart[]
): Message['content'] {
  if (typeof content === 'string') return content;
  return content.map((part): MessageContent =>
    part.type === 'image_ref'
      ? { type: 'image_url', image_url: { url: blobRefUrl(part.blobId) } }
      : { type: 'text', text: part.text }
  );
}

/** 纯文本预览，用于会话列表与检索，避免为显示一行字去解 content */
export function toPreview(content: Message['content'], limit = 120): string {
  const text =
    typeof content === 'string'
      ? content
      : content
          .map(p => (p.type === 'image_url' ? '[图片]' : p.text ?? ''))
          .join(' ');
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? flat.slice(0, limit) : flat;
}

async function versionToStored(v: MessageVersion): Promise<StoredMessageVersion> {
  return {
    id: v.id,
    model: v.model,
    content: await contentToStored(v.content),
    timestamp: v.timestamp,
    suggestions: v.suggestions,
    webSearched: v.webSearched,
    webSearchFailed: v.webSearchFailed,
    searchResults: v.searchResults,
    artifact: v.artifact,
    stoppedByUser: v.stoppedByUser,
    usage: v.usage,
  };
}

function versionFromStored(v: StoredMessageVersion): MessageVersion {
  return {
    id: v.id,
    model: v.model,
    content: contentFromStored(v.content),
    timestamp: v.timestamp,
    suggestions: v.suggestions,
    webSearched: v.webSearched,
    webSearchFailed: v.webSearchFailed,
    searchResults: v.searchResults,
    artifact: v.artifact,
    stoppedByUser: v.stoppedByUser,
    usage: v.usage,
  };
}

/**
 * 转为存盘记录。
 *
 * isStreaming / webSearching 这类瞬时状态不落盘：它们描述的是"此刻正在发生"，
 * 存下来只会在下次启动时显示成一条永远转圈的消息。
 */
export async function toStored(
  msg: Message,
  convId: string,
  seq: number,
  syncedAt: number | null = null
): Promise<StoredMessage> {
  const content = await contentToStored(msg.content);
  return {
    id: msg.id,
    convId,
    seq,
    role: msg.role,
    content,
    timestamp: msg.timestamp,
    tokenEstimate: estimateMessageTokens(msg),
    textPreview: toPreview(msg.content),
    attachments: msg.attachments,
    artifact: msg.artifact,
    model: msg.model,
    usage: msg.usage,
    suggestions: msg.suggestions,
    webSearched: msg.webSearched,
    webSearchFailed: msg.webSearchFailed,
    searchResults: msg.searchResults,
    stoppedByUser: msg.stoppedByUser,
    versions: msg.versions
      ? await Promise.all(msg.versions.map(versionToStored))
      : undefined,
    activeVersionIndex: msg.activeVersionIndex,
    compressedInto: msg.compressedInto,
    updatedAt: Date.now(),
    syncedAt,
  };
}

export function fromStored(rec: StoredMessage): Message {
  return {
    id: rec.id,
    role: rec.role,
    content: contentFromStored(rec.content),
    timestamp: rec.timestamp,
    attachments: rec.attachments,
    artifact: rec.artifact,
    model: rec.model,
    usage: rec.usage,
    suggestions: rec.suggestions,
    webSearched: rec.webSearched,
    webSearchFailed: rec.webSearchFailed,
    searchResults: rec.searchResults,
    stoppedByUser: rec.stoppedByUser,
    versions: rec.versions?.map(versionFromStored),
    activeVersionIndex: rec.activeVersionIndex,
    compressedInto: rec.compressedInto,
  };
}
