import type { Message, MessageContent } from '../types';
import { getSystemPrompt } from '../config/prompts';
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContent[];
}

export async function* streamChat(
  messages: Message[],
  model: string,
  signal?: AbortSignal,
  searchContext?: string,
  systemPrompt?: string
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

  apiMessages.push(
    ...messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }))
  );

  const response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      stream: true,
      temperature: 0.7,
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // Skip malformed JSON
      }
    }
  }
}
