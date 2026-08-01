/**
 * 数据备份与恢复。
 *
 * 为什么必须有这个：浏览器端存储没有任何不被清除的保证。
 * - iOS Safari 里打开的网页，连续七天没访问就会被整体清掉存储
 *   （装到主屏幕后不受此规则约束，见 utils/pwa.ts）
 * - 用户在设置里「清除历史记录与网站数据」会连装机 PWA 的数据一起删
 * - 系统存储告急时也可能回收
 *
 * 所以导出是唯一能扛住这些情况的手段。图片一并以 base64 写进备份文件，
 * 换设备也能打开——代价是文件变大，但备份本来就是要能离开本机才有意义。
 */
import {
  listConversations,
  getAllMessages,
  listNodes,
  getBlob,
  putBlobFromDataUrl,
  putConversation,
  putMessages,
  putNode,
  newConversationId,
  parseBlobRefUrl,
  blobRefUrl,
  type StoredConversation,
  type StoredContextNode,
} from '../db';
import type { Message, MessageContent } from '../types';

/** 备份文件格式版本。恢复时据此判断兼容性。 */
const BACKUP_VERSION = 2;
const APP_TAG = 'PortAI';

export interface BackupConversation {
  meta: Omit<StoredConversation, 'syncedAt'>;
  messages: Message[];
  nodes: StoredContextNode[];
}

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: number;
  conversations: BackupConversation[];
}

/**
 * 把消息里的 blob 引用换成 base64，让备份文件自包含。
 *
 * 取不到的 blob 丢掉该分片而不是整条消息——少一张图比丢一段对话好。
 */
async function inlineForBackup(content: Message['content']): Promise<Message['content']> {
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
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(record.blob);
    });
    out.push({ type: 'image_url', image_url: { url: dataUrl } });
  }
  return out;
}

/** 恢复时把 base64 重新落成 blob */
async function extractOnRestore(content: Message['content']): Promise<Message['content']> {
  if (typeof content === 'string') return content;

  const out: MessageContent[] = [];
  for (const part of content) {
    const url = part.type === 'image_url' ? part.image_url?.url : undefined;
    if (url?.startsWith('data:')) {
      out.push({ type: 'image_url', image_url: { url: blobRefUrl(await putBlobFromDataUrl(url)) } });
    } else {
      out.push(part);
    }
  }
  return out;
}

export interface ExportOptions {
  /** 只导出这些会话；不传则全部 */
  convIds?: string[];
  /** 进度回调，用于长时间导出时给用户反馈 */
  onProgress?: (done: number, total: number) => void;
}

export async function buildBackup(opts: ExportOptions = {}): Promise<BackupFile> {
  const all = await listConversations();
  const targets = opts.convIds
    ? all.filter(c => opts.convIds!.includes(c.id))
    : all;

  const conversations: BackupConversation[] = [];
  for (let i = 0; i < targets.length; i++) {
    const meta = targets[i];
    const messages = await getAllMessages(meta.id);
    const inlined: Message[] = [];
    for (const msg of messages) {
      inlined.push({ ...msg, content: await inlineForBackup(msg.content) });
    }
    conversations.push({
      meta,
      messages: inlined,
      nodes: await listNodes(meta.id),
    });
    opts.onProgress?.(i + 1, targets.length);
  }

  return {
    app: APP_TAG,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    conversations,
  };
}

function timestampName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * 导出并触发下载。
 *
 * 在 iOS 上「下载」会走系统分享面板，用户可以存到文件 App 或 iCloud Drive，
 * 那才是真正离开了浏览器沙箱、清除网站数据也带不走的地方。
 */
export async function exportBackup(
  opts: ExportOptions & { filename?: string } = {}
): Promise<void> {
  const backup = await buildBackup(opts);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.filename ?? `portai-backup-${timestampName()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 导出单个会话，文件名取会话标题。
 *
 * 侧栏和历史面板共用。不能直接序列化内存里的 Conversation：消息是按需加载的，
 * 没打开过的会话 messages 是空数组，那样导出的是个空壳。
 */
export function exportSingleConversation(convId: string, title: string): Promise<void> {
  // 标题里可能有路径分隔符等非法字符，替换掉再当文件名
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '对话';
  return exportBackup({ convIds: [convId], filename: `${safe}.portai.json` });
}

export interface RestoreResult {
  conversations: number;
  messages: number;
  skipped: number;
}

/**
 * 从备份恢复。
 *
 * 一律以新 id 导入，不覆盖同名会话——恢复动作不应该有破坏性，
 * 重复了让用户自己删比悄悄覆盖掉现有数据安全。
 */
export async function restoreBackup(file: BackupFile): Promise<RestoreResult> {
  if (file.app !== APP_TAG) throw new Error('不是本应用的备份文件');
  if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) {
    throw new Error('备份文件版本过新，请先升级应用');
  }
  if (!Array.isArray(file.conversations)) throw new Error('备份文件格式不正确');

  const result: RestoreResult = { conversations: 0, messages: 0, skipped: 0 };

  for (const item of file.conversations) {
    if (!item?.meta?.id) {
      result.skipped += 1;
      continue;
    }

    // 重新分配 id，避免与现有会话相撞
    const convId = newConversationId();
    const idMap = new Map<string, string>();

    const messages: Message[] = [];
    for (const msg of item.messages ?? []) {
      const newId = `${convId}-${messages.length}`;
      idMap.set(msg.id, newId);
      messages.push({
        ...msg,
        id: newId,
        isStreaming: false,
        // compressedInto 指向摘要节点，节点 id 下面也会重映射，这里保持同样的前缀规则
        compressedInto: msg.compressedInto ? `${convId}-${msg.compressedInto}` : undefined,
        content: await extractOnRestore(msg.content),
      });
    }

    const now = Date.now();
    await putConversation({
      ...item.meta,
      id: convId,
      messageCount: messages.length,
      lastMessageAt: messages[messages.length - 1]?.timestamp ?? now,
      headSeq: 0,
      updatedAt: now,
      syncedAt: null,
    });
    if (messages.length) await putMessages(convId, messages);

    // 摘要节点的 id 也要重映射，否则 compressedInto 会指向别的会话
    for (const node of item.nodes ?? []) {
      const nodeId = `${convId}-${node.id}`;
      await putNode({
        ...node,
        id: nodeId,
        convId,
        sourceMessageIds: node.sourceMessageIds.map(id => idMap.get(id) ?? id),
        derivedFrom: node.derivedFrom.map(id => `${convId}-${id}`),
      });
    }

    result.conversations += 1;
    result.messages += messages.length;
  }

  return result;
}

export async function readBackupFile(file: File): Promise<BackupFile> {
  const text = await file.text();
  try {
    return JSON.parse(text) as BackupFile;
  } catch {
    throw new Error('无法解析备份文件');
  }
}
