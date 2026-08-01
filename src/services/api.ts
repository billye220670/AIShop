import type { Message, MessageContent, TokenUsage } from '../types';
import { getSystemPrompt } from '../config/prompts';
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';
import { inlineBlobsForApi } from '../db';

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContent[];
}

/**
 * 从响应中提取真实用量。
 * 各网关字段命名不统一（OpenAI 用 prompt_tokens_details.cached_tokens，
 * Anthropic 兼容层可能用 cache_read_input_tokens），所以逐个兜底。
 */
function parseUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;

  const prompt = num(u.prompt_tokens) ?? num(u.input_tokens);
  const completion = num(u.completion_tokens) ?? num(u.output_tokens);
  if (prompt === undefined && completion === undefined) return null;

  const details = (u.prompt_tokens_details || {}) as Record<string, unknown>;
  const cached =
    num(details.cached_tokens) ??
    num(u.cached_tokens) ??
    num(u.cache_read_input_tokens);
  const cacheWrite =
    num(u.cache_creation_input_tokens) ?? num(u.cache_write_input_tokens);

  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: num(u.total_tokens) ?? (prompt ?? 0) + (completion ?? 0),
    cachedTokens: cached,
    cacheWriteTokens: cacheWrite,
  };
}

export async function* streamChat(
  messages: Message[],
  model: string,
  signal?: AbortSignal,
  searchContext?: string,
  systemPrompt?: string,
  /** 流结束时回调真实用量。网关不返回 usage 时不会被调用。 */
  onUsage?: (usage: TokenUsage) => void
): AsyncGenerator<string, void, unknown> {
  const provider = await settingsService.getProvider('llm');
  const apiKey = await settingsService.getApiKey(provider);
  const config = getProviderConfig(provider);

  if (!apiKey) {
    throw new Error('请先在设置中配置 API Key');
  }

  const apiMessages: ChatCompletionMessage[] = [
    { role: 'system', content: systemPrompt || getSystemPrompt() },
  ];

  if (searchContext) {
    apiMessages.push({ role: 'system', content: searchContext });
  }

  // 注意：messages 中可能包含由压缩区间生成的 system 消息（见 utils/buildApiMessages），
  // 这些消息需要保留在原本的时间位置上，不能提前或丢弃。
  //
  // 图片存在 IndexedDB 里，消息中是 aishop-blob:<id> 形式的引用，模型读不了，
  // 所以发送前必须还原成 data URL。放在这里做而不是更早：避免把整段历史的
  // 图片都提前读进内存。
  apiMessages.push(
    ...(await Promise.all(
      messages.map(async (msg) => ({
        role: msg.role,
        content: await inlineBlobsForApi(msg.content),
      }))
    ))
  );

  const send = (includeUsage: boolean) =>
    fetch(`${config.chatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        stream: true,
        // 索取真实用量。不是所有网关都认这个参数，失败时会退回不带它重试。
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        temperature: 0.7,
      }),
      signal,
    });

  let response = await send(true);

  // 网关不认 stream_options 时会返回 4xx。用量是附加能力，
  // 不能因为它让整个对话发不出去，所以去掉参数重试一次。
  if (!response.ok && response.status >= 400 && response.status < 500) {
    const errText = await response.text();
    if (/stream_options|include_usage|unknown|unsupported|invalid/i.test(errText)) {
      response = await send(false);
    } else {
      throw new Error(`API 请求失败 (${response.status}): ${errText}`);
    }
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let lastUsage: TokenUsage | null = null;

  // 开了 include_usage 之后，最后会多一个 choices 为空、只带 usage 的 chunk，
  // 所以每个 chunk 都要看一眼 usage，不能只看有内容的那些。
  const handleLine = (line: string): { content?: string; done?: boolean } => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) return {};
    const data = trimmed.slice(6);
    if (data === '[DONE]') return { done: true };

    try {
      const parsed = JSON.parse(data);
      const usage = parseUsage(parsed.usage);
      if (usage) lastUsage = usage;
      const content = parsed.choices?.[0]?.delta?.content;
      return content ? { content } : {};
    } catch {
      return {};  // 跳过残缺 JSON
    }
  };

  try {
    let streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const { content, done: isDone } = handleLine(line);
        if (content) yield content;
        if (isDone) { streamDone = true; break; }
      }
    }

    // 结尾可能没有换行，残留在 buffer 里的最后一行同样要处理，
    // 否则 usage 恰好落在这里时就丢了
    if (buffer.trim()) {
      const { content } = handleLine(buffer);
      if (content) yield content;
    }
  } finally {
    if (lastUsage) onUsage?.(lastUsage);
  }
}
