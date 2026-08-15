/**
 * 生图提示词优化。
 *
 * 小模型只负责"是否生图"的调度判断（见 imageIntentJudge.ts），提示词的
 * 整理与优化统一交给用户当前选择的聊天模型完成，保证生图提示词质量与
 * 判断器解耦：用户说"帮我优化提示词"时，优化由大模型完成；日常生图时
 * 口语化需求也被整理成适合生图模型的结构化提示词。
 *
 * 失败静默返回 null，调用方回退使用用户原文，不影响生图流程。
 */
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';

export interface ImagePromptOptimizeInput {
  /** 用户原始需求文本 */
  userText: string;
  /** 用户当前选择的聊天模型 id（优化走用户模型，成本与质量由用户的选择决定） */
  model: string;
  /** 文生图目标宽高比（非 1:1 时传入，提示词需体现对应构图方向）；编辑任务无 */
  aspectRatio?: string;
  /** 参考图场景说明（编辑/合并时由调用方组装），优化器会把它写进提示词 */
  sceneNote?: string;
}

const OPTIMIZE_SYSTEM_PROMPT = `你是一个"图片生成提示词优化器"。用户想在聊天中生成一张图片，你需要把用户的原始需求改写成一段高质量的中文生图提示词。

要求：
- 忠实于用户意图，不添加用户没有要求的内容
- 补充画面要素让生图模型更容易理解：主体、风格、构图、光线、氛围、色彩、细节等
- 提示词简洁有力，避免啰嗦的套话，通常 60-150 字
- 若提供了目标宽高比，提示词要体现对应的构图方向（如 9:16 竖版海报、16:9 横版壁纸、4:3 日常照片）
- 若提供了参考图说明，把参考图的关系与修改要求写进提示词开头，例如"用户上传的图片在前，之前 AI 生成的图片在后，保持之前生成图片中主体的外观一致"

只输出提示词本身，不要解释、不要引号、不要任何前后缀。`;

/** 优化请求自身要快，给 30s 上限，超时按失败处理回退原文 */
const OPTIMIZE_TIMEOUT_MS = 30000;

export async function optimizeImagePrompt(
  input: ImagePromptOptimizeInput
): Promise<string | null> {
  const { userText, model, aspectRatio, sceneNote } = input;
  if (!userText.trim()) return null;

  try {
    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);
    if (!apiKey) return null;

    const parts: string[] = [];
    if (sceneNote) parts.push(`【参考图说明】\n${sceneNote}`);
    parts.push(`【用户需求】\n${userText}`);
    if (aspectRatio) parts.push(`【目标比例】\n${aspectRatio}（提示词需体现对应构图方向）`);

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
    const optimized = raw.trim();
    return optimized || null;
  } catch {
    return null;
  }
}
