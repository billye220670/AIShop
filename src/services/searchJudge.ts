/**
 * 联网搜索必要性判断。
 *
 * 结构与 titleGenerator.ts / contextCompactor.ts 一致：用固定的便宜小模型做一次
 * 非流式请求，失败静默返回兜底结果，不影响正常发送流程。
 *
 * 背景：webSearchEnabled 开关原来是"只要打开，每条消息都联网搜索"，导致明显不需要
 * 联网的问题（闲聊、写代码、翻译……）也会去查。这里加一层轻量判断，让开关变成
 * "允许AI按需联网"，而不是"强制每条都搜"。
 */
import type { Message } from '../types';
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';

/** 判断本身只是个分类任务，用便宜快模型即可，和 titleGenerator 使用同一个模型 */
const JUDGE_MODEL = 'doubao-1-5-pro-32k-250115';

/** 判断请求本身要快，附带的历史上下文不需要很多，够理解追问就行 */
const MAX_CONTEXT_MESSAGES = 4;

const JUDGE_PROMPT = `你是一个"是否需要联网搜索"的判断器。你会看到用户最新的问题，可能还附带最近几轮对话作为背景。你的唯一任务是判断：要准确回答这个问题，是否需要联网获取实时/最新信息。

需要联网的情况，例如：
- 时效性信息：今天的新闻、当前天气、最新的价格/汇率/股价、某产品或版本是否发布、比赛结果、政策变化等
- 用户明确要求你去查/搜/联网确认
- 问题涉及的事实可能超出你训练数据的时间范围，或需要验证是否有更新

不需要联网的情况，例如：
- 日常闲聊、寒暄、情感陪伴、角色扮演
- 数学计算、代码编写与调试、文本创作、翻译、总结、润色
- 靠你已有知识就能稳定回答的常识性、历史性、原理性问题
- 用户在讨论/追问你自己刚才生成的内容（如代码、文档）

只输出一个 JSON 对象，不要输出任何其他文字，不要用代码块包裹：
{"needSearch": true 或 false, "query": "需要搜索时，给出适合搜索引擎的精炼关键词；不需要则省略这个字段"}`;

export interface SearchJudgeResult {
  needSearch: boolean;
  /** 判断为需要搜索时，模型顺手给出的、更适合搜索引擎的关键词；否则为空 */
  query?: string;
}

/** 判断失败时的兜底：保持旧行为（照样搜），避免因为判断层故障导致本该搜的问题被漏搜 */
const FAIL_OPEN: SearchJudgeResult = { needSearch: true };

function toPlainText(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part.type === 'image_url' ? '[图片]' : part.text || ''))
    .join('\n');
}

function buildContext(recentMessages: Message[]): string {
  return recentMessages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${toPlainText(m.content)}`)
    .join('\n');
}

/** 去掉模型可能误加的代码块包裹，兼容纯 JSON 输出 */
function parseJudgeResponse(raw: string): SearchJudgeResult | null {
  const fenced = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const text = (fenced ? fenced[1] : raw).trim();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.needSearch !== 'boolean') return null;
    const query = typeof parsed.query === 'string' ? parsed.query.trim() : undefined;
    return { needSearch: parsed.needSearch, query: query || undefined };
  } catch {
    return null;
  }
}

/**
 * 判断用户这条消息是否需要联网搜索。
 * @param userText 用户最新一条消息的纯文本
 * @param recentMessages 最近几条历史消息，用于理解追问（如"那第二个呢"）
 */
export async function judgeSearchNeed(
  userText: string,
  recentMessages: Message[] = []
): Promise<SearchJudgeResult> {
  if (!userText.trim()) return { needSearch: false };

  try {
    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);
    if (!apiKey) return FAIL_OPEN;

    const context = buildContext(recentMessages);
    const userContent = context
      ? `【最近对话背景】\n${context}\n\n【用户最新问题】\n${userText}`
      : userText;

    const response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [
          { role: 'system', content: JUDGE_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    });

    if (!response.ok) return FAIL_OPEN;

    const data = await response.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw) return FAIL_OPEN;

    return parseJudgeResponse(raw) || FAIL_OPEN;
  } catch {
    return FAIL_OPEN;
  }
}
