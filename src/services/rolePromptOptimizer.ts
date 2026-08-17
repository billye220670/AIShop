/**
 * 角色系统提示词优化。
 *
 * 用户在创建/编辑自定义角色时点击「优化提示词」：让当前选择的聊天模型
 * 先理解用户描述里想创建的角色类型、功能意图与使用场景，再产出一条
 * 可直接作为系统提示词使用的高质量中文提示词（判断与生成合一，避免
 * 两段式对话放大成本与延迟）。
 *
 * 失败静默返回 null，调用方保留用户原文并提示，不影响编辑流程。
 */
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';

export interface RolePromptOptimizeInput {
  /** 用户输入的角色描述（口语想法、功能需求或已有的提示词） */
  userText: string;
  /** 用户当前选择的聊天模型 id（优化走用户模型，成本与质量由用户的选择决定） */
  model: string;
}

const OPTIMIZE_SYSTEM_PROMPT = `你是「AI 角色系统提示词优化师」。用户会给你一段关于想要创建的 AI 角色的描述——可能是随口说说的想法、功能需求，也可能是一段已经写好的提示词。你需要：

1. 先判断用户想创建的角色类型、功能意图与使用场景（例如：编程助手、写作助手、翻译、语言老师、客服、游戏角色扮演、情感陪伴、知识问答等）；
2. 把用户的描述改写成一条可以直接作为系统提示词使用的高质量中文提示词。

优化后的系统提示词要求：
- 开头用一句话定义角色身份、名称与核心职责
- 分点列出核心能力与行为准则，每点简洁明确
- 明确语气风格与回答格式偏好（如使用 Markdown、代码块等）
- 补充能力边界：不确定时如实说明，不编造事实
- 忠实于用户意图，不擅自添加用户没有要求的功能
- 全文 150-300 字，中文，精炼无套话

只输出优化后的系统提示词本身，不要解释你的判断过程、不要引号、不要任何前后缀。`;

/** 优化请求自身要快，给 30s 上限，超时按失败处理回退原文 */
const OPTIMIZE_TIMEOUT_MS = 30000;

export async function optimizeRolePrompt(
  input: RolePromptOptimizeInput
): Promise<string | null> {
  const { userText, model } = input;
  if (!userText.trim()) return null;

  try {
    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);
    if (!apiKey) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPTIMIZE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
            { role: 'user', content: userText },
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
    const optimized = raw.trim();
    return optimized || null;
  } catch {
    return null;
  }
}
