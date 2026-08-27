import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';

function fallback(messages: Array<{role: string; content: string | unknown}>): string {
  const first = messages.find(m => m.role === 'user');
  const text = first && typeof first.content === 'string' ? first.content : '新对话';
  return text.slice(0, 20) + (text.length > 20 ? '...' : '');
}

function sanitizeTitle(raw: string): string {
  // 去除首尾空白、引号与多余标点
  let title = raw.trim().replace(/^["'“”‘’《》「」]+|["'“”‘’《》「」]+$/g, '').trim();
  // 去除末尾标点
  title = title.replace(/[。.！!？?,，；;:：、\s]+$/u, '').trim();
  // 截断到 20 字以内（防御性）
  if (title.length > 20) title = title.slice(0, 20);
  return title;
}

export async function generateTitle(
  messages: Array<{role: string; content: string | unknown}>
): Promise<string> {
  try {
    // 构造摘要：取用户和AI的前几轮对话内容（总长度限制在500字内）
    let summary = '';
    for (const msg of messages) {
      const text = typeof msg.content === 'string' ? msg.content : '[图片消息]';
      summary += `${msg.role === 'user' ? '用户' : 'AI'}：${text}\n`;
      if (summary.length > 500) break;
    }

    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);

    if (!apiKey) {
      return fallback(messages);
    }

    const titleModel = await settingsService.getAssistModel('titleGen');

    const response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: titleModel,
        messages: [
          {
            role: 'system',
            content:
              '根据以下对话内容，生成一个简短的对话标题（不超过15个字，不要加引号和标点）。直接输出标题。',
          },
          {
            role: 'user',
            content: summary,
          },
        ],
        max_tokens: 30,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error('Title generation failed');
    }

    const data = await response.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    const title = raw ? sanitizeTitle(raw) : '';
    return title || fallback(messages);
  } catch {
    return fallback(messages);
  }
}

/** 文档标题兜底：内容截取前 20 字（与「保存为 Markdown」旧取法一致） */
function fallbackDocTitle(content: string): string {
  const text = content.trim();
  return text.slice(0, 20) + (text.length > 20 ? '...' : '');
}

/**
 * 为文档生成标题（「我的库」markdown 资产保存时调用）。
 * 无 API key / 请求失败时回退到内容截取，保证保存动作不被阻塞。
 */
export async function generateDocumentTitle(content: string): Promise<string> {
  try {
    const summary = content.slice(0, 500);

    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);

    if (!apiKey) {
      return fallbackDocTitle(content);
    }

    const titleModel = await settingsService.getAssistModel('titleGen');

    const response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: titleModel,
        messages: [
          {
            role: 'system',
            content:
              '根据以下文档内容，生成一个简短的文档标题（不超过15个字，不要加引号和标点）。直接输出标题。',
          },
          {
            role: 'user',
            content: summary,
          },
        ],
        max_tokens: 30,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error('Title generation failed');
    }

    const data = await response.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    const title = raw ? sanitizeTitle(raw) : '';
    return title || fallbackDocTitle(content);
  } catch {
    return fallbackDocTitle(content);
  }
}
