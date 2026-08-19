/**
 * 智能路由：模型选择 + 小模型直接回答。
 *
 * 结构与 searchJudge.ts / titleGenerator.ts 一致：用固定的便宜小模型做非流式
 * 请求，失败静默返回兜底结果，不影响正常发送流程。
 *
 * 背景：模型选择器新增「智能路由」选项（AUTO_MODEL_ID）。选中后每条消息先由
 * 小模型决定回答方式：简单任务（闲聊/翻译/计算等）由小模型直接回答，复杂任务
 * 路由到最合适的大模型。
 *
 * 注意「判断」与「直接回答」是两次独立的小模型调用：
 * - judgeRoute 只做分类，输出 {"action": "direct"} 或 {"action": "route", "model": "..."}，
 *   不输出答案正文——避免路由器误输出「我可以直接回答」这类废话，也保证 JSON 解析稳定；
 * - 判断为 direct 后再由 quickAnswer 单独发起一次回答请求，此时小模型才是「回答者」身份。
 */
import type { Message } from '../types';
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';

/** 智能路由的伪模型 id：selectedModel 等于它时触发路由判断 */
export const AUTO_MODEL_ID = 'auto';

/** 路由判断与直接回答都用这个便宜快模型，与 titleGenerator/searchJudge 保持一致 */
export const ROUTER_MODEL = 'doubao-1-5-pro-32k-250115';

/** 判断/回答请求本身要快，附带的历史上下文不需要很多，够理解追问就行 */
const MAX_CONTEXT_MESSAGES = 4;

/** 直接回答请求上限：超时按失败处理，调用方回退到流式大模型 */
const ANSWER_TIMEOUT_MS = 30000;

/**
 * 路由候选白名单：各档位代表模型 + 一句话定位。
 * 全部候选注入判断 prompt；判断结果 model 必须命中这里才会被采纳，
 * 防止小模型编造不存在的模型 id。
 */
const ROUTE_CANDIDATES = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', desc: '旗舰：复杂推理、长文写作，综合最强' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', desc: '旗舰：最复杂的推理与创作任务' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', desc: '旗舰：超长上下文、多模态（图/视频/音频）' },
  { id: 'grok-4.20-0309-reasoning', name: 'Grok 4.20', desc: '旗舰：深度逻辑推理、超长上下文' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', desc: '均衡：代码、写作、日常问答，能力与速度兼顾' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', desc: '均衡：性能与成本兼顾' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', desc: '均衡：快速多模态、性价比高' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', desc: '轻量：快速响应、简单任务' },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', desc: '国内：代码、中文场景、长上下文' },
  { id: 'zai-org/glm-5-turbo', name: 'GLM-5-Turbo', desc: '国内：中文能力、长文本' },
  { id: 'qwen/qwen3.5-27b', name: 'Qwen 3.5 27B', desc: '国内：性价比、中文能力' },
];

const CANDIDATES_TEXT = ROUTE_CANDIDATES
  .map(c => `- ${c.id}: ${c.name} — ${c.desc}`)
  .join('\n');

const ROUTE_PROMPT = `你是一个"模型路由选择器"。用户开启了智能路由，你的唯一任务是为用户的最新问题挑选最合适的回答方式。

可选模型（id: 名称 — 定位）：
${CANDIDATES_TEXT}

判断规则：
1. 直接回答（direct）：仅当任务足够简单、你有把握直接给出简洁准确回答时——日常闲聊、寒暄、情感陪伴、翻译短句、简单计算、常识性短问答等。需要深度推理、长文创作、代码编写、专业分析的任务一律不要 direct。注意：依赖实时信息（天气、新闻、价格、汇率等）的问题若系统已提供联网搜索结果摘要，可基于摘要直接回答。
2. 路由模型（route）：根据任务类型从可选模型中选最合适的 id：
   - 深度推理/复杂分析 → claude-opus-5 / gpt-5.6-sol / grok-4.20-0309-reasoning
   - 代码编写与调试 → claude-sonnet-5 / deepseek/deepseek-v4-pro
   - 长文本/长上下文 → gemini-3.1-pro-preview / grok-4.20-0309-reasoning
   - 中文场景 → deepseek/deepseek-v4-pro / zai-org/glm-5-turbo / qwen/qwen3.5-27b
   - 快速响应/高性价比 → gemini-3.5-flash / claude-haiku-4-5-20251001 / qwen/qwen3.5-27b
   - 多模态内容理解（图片/视频/音频）→ gemini-3.1-pro-preview / gemini-3.5-flash
   - 实时信息查询（天气、新闻、价格）若必须路由 → 优先 gemini-3.5-flash / claude-haiku-4-5-20251001 这类快速模型，不要用旗舰模型
3. 延续性：用户是在追问上一轮内容（"它""这个""上面说的"等指代）时，优先沿用上一轮使用的模型，除非任务类型明显变化。
4. 若本条消息附带图片，不要直接回答，必须路由到支持图像输入的模型。
5. 若已提供联网搜索结果摘要：优先选择 direct 基于摘要直接回答——天气、新闻、价格这类实时查询，摘要通常足够回答，不需要路由大模型。只有摘要明显缺失或需要深度对比分析时，才路由到模型。

只输出一个 JSON 对象，不要输出任何其他文字，不要用代码块包裹：
{"action": "direct"} 或 {"action": "route", "model": "模型id"}`;

const QUICK_ANSWER_PROMPT = `你是一个轻量 AI 助手，正在与用户聊天。请直接、简洁、准确地回答用户的问题。
要求：
- 语气自然友好，不要提及你是"路由器""判断器"或任何系统机制
- 不要输出 JSON，不要用代码块包裹
- 简单问题一两句话即可；需要分点回答时用简洁的列表
- 若提供了联网搜索结果，优先基于搜索结果回答`;

export interface RouteResult {
  action: 'direct' | 'route';
  /** action=route 时的目标模型 id（保证在白名单内） */
  model?: string;
}

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

/** 去掉模型可能误加的代码块包裹，兼容纯 JSON 输出；model 必须命中白名单才采纳 */
function parseJudgeResponse(raw: string): RouteResult | null {
  const fenced = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const text = (fenced ? fenced[1] : raw).trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed.action === 'direct') return { action: 'direct' };
    if (
      parsed.action === 'route' &&
      typeof parsed.model === 'string' &&
      ROUTE_CANDIDATES.some(c => c.id === parsed.model)
    ) {
      return { action: 'route', model: parsed.model };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 路由判断：这条消息该由哪个模型回答（或直接回答）。
 * @param userText 用户最新一条消息的纯文本
 * @param recentMessages 最近几条历史消息，用于理解追问
 * @param lastModel 上一轮实际回答的模型 id，用于延续性引导
 * @param hasImages 本条消息是否带图（带图不能 direct，必须路由到多模态模型）
 * @param searchContext 已完成的联网搜索结果摘要（可能影响直接回答的可行性）
 */
export async function judgeRoute(
  userText: string,
  recentMessages: Message[] = [],
  lastModel?: string,
  hasImages = false,
  searchContext?: string
): Promise<RouteResult | null> {
  if (!userText.trim()) return null;

  try {
    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);
    if (!apiKey) return null;

    const context = buildContext(recentMessages);
    const parts: string[] = [];
    if (context) parts.push(`【最近对话背景】\n${context}`);
    if (lastModel && lastModel !== AUTO_MODEL_ID) {
      parts.push(`【上一轮回答使用的模型】\n${lastModel}`);
    }
    if (searchContext) parts.push(`【联网搜索结果】\n${searchContext}`);
    parts.push(`【用户最新问题】\n${userText}${hasImages ? '\n（本条消息附带图片，不能直接回答）' : ''}`);

    const response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ROUTER_MODEL,
        messages: [
          { role: 'system', content: ROUTE_PROMPT },
          { role: 'user', content: parts.join('\n\n') },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw) return null;

    return parseJudgeResponse(raw);
  } catch {
    return null;
  }
}

/**
 * 小模型直接回答：judgeRoute 判断为 direct 后单独发起的一次回答请求。
 * 与判断分离：此时小模型以「回答者」身份输出答案正文，不会出现
 * 「我可以直接回答」这类路由器式废话。
 * @returns 回答正文；失败/超时返回 null，调用方回退到流式大模型
 */
export async function quickAnswer(
  userText: string,
  recentMessages: Message[] = [],
  searchContext?: string
): Promise<string | null> {
  if (!userText.trim()) return null;

  try {
    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);
    if (!apiKey) return null;

    const context = buildContext(recentMessages);
    const parts: string[] = [];
    if (context) parts.push(`【最近对话背景】\n${context}`);
    if (searchContext) parts.push(`【联网搜索结果】\n${searchContext}`);
    parts.push(`【用户问题】\n${userText}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANSWER_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: ROUTER_MODEL,
          messages: [
            { role: 'system', content: QUICK_ANSWER_PROMPT },
            { role: 'user', content: parts.join('\n\n') },
          ],
          max_tokens: 1024,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return null;

    const data = await response.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const answer = raw.trim();
    return answer || null;
  } catch {
    return null;
  }
}
