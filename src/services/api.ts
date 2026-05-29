import type { Message, MessageContent } from '../types';
import { getSystemPrompt } from '../config/prompts';

const API_BASE_URL = 'https://api.highwayapi.ai/openai/v1';
const API_KEY = 'sk_2vI8czIlEG3ByvsRQsuy5K0jNxpspATqPy9JcaVmRaI';

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContent[];
}

export async function* streamChat(
  messages: Message[],
  model: string,
  signal?: AbortSignal,
  searchContext?: string
): AsyncGenerator<string, void, unknown> {
  const apiMessages: ChatCompletionMessage[] = [
    { role: 'system', content: getSystemPrompt() },
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

  const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
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
    throw new Error(`API Error (${response.status}): ${error}`);
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
