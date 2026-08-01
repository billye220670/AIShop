/**
 * 上下文压缩服务。
 *
 * 结构与 titleGenerator.ts 一致：同一套 provider/apiKey 取用方式，非流式请求，
 * 失败静默返回 null 由调用方决定是否放弃压缩。
 */
import type { Message, ContextSummary } from '../types';
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';
import { estimateTextTokens } from '../utils/tokenEstimate';

/** 单次压缩喂给小模型的原文上限，防止压缩请求本身超出小模型的上下文 */
const MAX_SOURCE_TOKENS = 24000;

const COMPACT_PROMPT = `你是一个对话上下文压缩器。你的任务是把一段较早的对话压缩成一段结构清晰的摘要文本，供后续对话继续使用，也供用户直接阅读和编辑。

用 Markdown 小标题分段输出，按需包含以下几类内容（没有内容的类别直接省略，不要写"无"）：
- 会话目标：用户在这段对话里想达成什么，一句话
- 已确定结论：已经拍板的决定
- 事实与约束：用户提供的具体数值、金额、日期、地点、人名、专有名词、URL 等关键信息，必须逐字照抄原文，禁止改写、换算、四舍五入或意译
- 用户偏好：语气、语言、格式、风格等要求
- 待办与未决：尚未解决或悬而未决的问题
- 已否决的方案：提出过但被明确否决的方案，不可省略，否则后续对话会重复推荐

核心要求：
1. 只记录对后续对话有用的信息。寒暄、重复确认、已被后续内容推翻的中间结论都要丢掉。
2. 用中文输出，除非原文事实本身是其他语言（那部分保持原样）。
3. 每一条尽量简短独立，一条只说一件事，用列表呈现。
4. 你的输出会作为事实提供给后续对话，因此不要加入任何原文中没有的推测。
5. 直接输出摘要正文，不要输出 JSON、代码块包裹或额外说明文字。`;

function toPlainText(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => (part.type === 'image_url' ? '[图片]' : part.text || ''))
    .join('\n');
}

/** 把消息序列铺成给压缩模型看的原文，超长时保留头尾（首轮定基调、尾部最近） */
function buildSource(messages: Message[]): string {
  const lines = messages.map(msg => {
    const who = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : '系统';
    let text = toPlainText(msg.content);
    if (msg.attachments?.length) {
      const names = msg.attachments.map(f => f.name).join('、');
      text += `\n[附带文档：${names}]`;
    }
    return `${who}：${text}`;
  });

  const full = lines.join('\n\n');
  if (estimateTextTokens(full) <= MAX_SOURCE_TOKENS) return full;

  // 超长：按比例砍中段，头 40% 尾 60%
  const headCount = Math.max(1, Math.floor(lines.length * 0.4));
  const tailCount = Math.max(1, Math.floor(lines.length * 0.35));
  const head = lines.slice(0, headCount);
  const tail = lines.slice(lines.length - tailCount);
  const omitted = lines.length - headCount - tailCount;
  return [...head, `（此处省略 ${omitted} 条中间消息）`, ...tail].join('\n\n');
}

/** 去掉模型可能误加的代码块包裹 */
function parseSummary(raw: string): ContextSummary | null {
  const fenced = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const text = (fenced ? fenced[1] : raw).trim();
  return text || null;
}

export interface CompactOptions {
  /** 会话级重点提示，长期生效 */
  focusHint?: string;
  signal?: AbortSignal;
}

export interface CompactResult {
  summary: ContextSummary;
  model: string;
}

/**
 * 压缩一段消息为结构化摘要。失败返回 null（调用方跳过压缩，不影响正常发送）。
 */
export async function compactMessages(
  messages: Message[],
  opts: CompactOptions = {}
): Promise<CompactResult | null> {
  if (!messages.length) return null;

  try {
    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);
    const { model } = settingsService.getCompactSettings();

    if (!apiKey) return null;

    let system = COMPACT_PROMPT;
    if (opts.focusHint?.trim()) {
      system += `\n\n用户指定的压缩重点（优先保留相关内容）：${opts.focusHint.trim()}`;
    }

    const response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: buildSource(messages) },
        ],
        temperature: 0.2,
      }),
      signal: opts.signal,
    });

    if (!response.ok) return null;

    const data = await response.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw) return null;

    const summary = parseSummary(raw);
    if (!summary) return null;

    return { summary, model };
  } catch {
    return null;
  }
}
