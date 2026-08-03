import type { MessageContent } from '../types';

/** 把消息内容（纯字符串或多段 content）拼成纯文本，用于复制/保存/搜索 */
export function getPlainText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text)
    .join('\n');
}

/** 取纯文本的第一行，用于折叠态单行预览 */
export function firstLineOf(content: string | MessageContent[]): string {
  const text = getPlainText(content).trim();
  const newlineIdx = text.indexOf('\n');
  return newlineIdx === -1 ? text : text.slice(0, newlineIdx);
}
