/**
 * 图片生成意图判断。
 *
 * 结构与 searchJudge.ts / titleGenerator.ts 一致：用固定的便宜小模型做一次
 * 非流式请求，失败静默返回兜底结果，不影响正常发送流程。
 *
 * 背景：聊天里用户想生成图片时，需要先给一句确认回复、再紧接着调生图服务。
 * 这里加一层轻量判断，让"聊天"和"生图"两条路径自动分流：判断为生图意图时
 * 不走大模型流式，改为回复确认文案 + 调生图 API。
 */
import type { Message } from '../types';
import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';

/** 判断本身只是个分类任务，用便宜快模型即可，和 searchJudge 使用同一个模型 */
const JUDGE_MODEL = 'doubao-1-5-pro-32k-250115';

/** 判断请求本身要快，附带的历史上下文不需要很多，够理解追问就行 */
const MAX_CONTEXT_MESSAGES = 4;

/** 聊天内生图支持的比例（与图片面板 useImage 的 GOOGLE_ASPECT_RATIOS 保持一致） */
const SUPPORTED_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];

const JUDGE_PROMPT = `你是一个"用户意图判断器"。你会看到用户最新的消息，可能还附带最近几轮对话作为背景。你的唯一任务是判断：用户是否想让 AI 生成一张图片（包括修改/编辑用户上传的图片，以及继续修改上一张 AI 生成的图片），并在需要时选出最合适的宽高比。

需要生成图片的情况，例如：
- 用户明确要求画/生成/制作一张图："画一只猫"、"生成一张海报"、"帮我设计一个logo"、"做一张壁纸"、"生成产品的宣传图"
- 用户希望把文字描述变成视觉画面：插画、照片风格、设计稿、表情包、示意图、图标等
- 用户说"配图"、"配一张图"、"出图"、"画一下"等表达生成图片的意图
- 用户本条消息附带图片（消息中会标注"本条消息附带N张图片"）并要求修改、编辑、调整这些图片（改风格、换背景、加元素、去水印、修瑕疵、扩图、多图合成等），这属于图片编辑任务，同样 needImage=true

【编辑上一张 AI 生成的图片】
- 最近对话背景中，AI 的某条消息会标注"（AI生成了图片）"，表示 AI 刚刚生成过一张图片
- 如果用户最新消息没有附带新图片，但表达了修改、调整、延续上一张 AI 图片的意图（如"把背景换成红色"、"换个动漫风格"、"加个文字"、"去掉水印"、"放大一点"、"调亮一些"、"把它改成油画"、"这张再改改"等修改性表达），needImage=true，且这是图片编辑任务，输出 "editPrevious": true
- 如果用户明确想要一张全新的图片（如"再画一张…"、"生成一张新的…"、"另一张…"、"重新画…"、或提出全新的画面主题），needImage=true，但这是文生图任务，不要输出 editPrevious
- 用户消息既不像修改上一张、也不像新生成时，一律按文生图处理（宁可新生成一张，也不要误拿旧图当底图）

【合并用户新上传的图片与上一张 AI 生成的图片】
- 用户本条消息附带了新图片，且消息内容指代了上一张 AI 图片中的主体（如"让她坐在沙发上"中的"她"、"把这个人放进这张图"、"和上一张合成"等），表示需要把两张图结合使用：needImage=true，同时输出 "editPrevious": true（此时 editPrevious 表示合并参考：用户新图 + 上一张 AI 图都传给生图接口）
- 仅当消息明确指代上一张 AI 图的内容时才输出 editPrevious；用户只是修改自己新上传的图片（如"把这张图调亮一点"、"给这张图加个滤镜"）时，不要输出 editPrevious

不需要生成图片的情况，例如：
- 日常闲聊、问答、写作、翻译、代码等纯文字任务
- 用户只是在讨论或询问图片相关问题（如"这张图是什么意思"、"怎么把图片变清晰"），没有要求生成新图
- 用户想优化、改进、扩写、润色、评价或分析一段图片生成提示词（如"帮我优化这个提示词"、"把这段提示词改得更详细"、"这个prompt怎么改进"），只要他没有要求生成图片：这类请求只需要文字回答，needImage=false
- 用户上传图片只是为了让你分析内容（识别、解读），而不是要改图

回复与比例规则：
- 判断为图片编辑任务（用户带图要求修改，或修改上一张 AI 图）时：reply 用确认修改的语气，例如"好的，我来为您做出对应修改～"、"收到，马上为您调整～"；不要输出 aspectRatio 字段（生成比例由系统按原图自动确定）
- 判断为文生图任务（用户没有带图，也不是修改上一张 AI 图）时：reply 用确认生成的语气，例如"好的，我来为你生成图片～"，并从以下比例列表中选择最合适的宽高比：
  - 1:1 正方形：头像、logo、图标、表情包、证件照、通用主题（如"画一只猫"）
  - 3:2 横向：日常风景照、横幅类照片
  - 2:3 纵向：竖幅海报、人物全身照
  - 4:3 横向稍宽：屏保、演示图、常见照片比例
  - 3:4 纵向稍窄：海报、电商图、小红书封面
  - 16:9 宽屏横版：桌面壁纸、视频封面、网页横幅、横版场景
  - 9:16 竖屏：手机壁纸、短视频封面、竖版海报、故事图
  - 21:9 超宽：超宽屏壁纸、电影横幅、超长横幅

选择规则：
- 用户明确要求横版/竖版、或明确说出具体比例（如"16:9"、"3:2"）、或明确说出用途（"手机壁纸"→9:16，"桌面壁纸"→16:9，"头像"→1:1，"海报"→3:4或9:16）时，必须遵守用户要求，从列表中选最接近的值
- 用户没有明确要求时，根据内容自然属性判断；通用主题默认 1:1

提示词的整理与优化由后续流程用聊天模型完成，你不需要输出 prompt。只输出一个 JSON 对象，不要输出任何其他文字，不要用代码块包裹：
{"needImage": true 或 false, "reply": "需要生成图片时，给出一句简短自然的确认回复（10-20字）：文生图用"好的，我来为你生成图片～"的语气，图片编辑用"好的，我来为您做出对应修改～"的语气；不需要则省略该字段", "editPrevious": "编辑任务需要结合上一张 AI 图片时输出 true：用户不带图修改上一张 AI 图，或带新图但消息指代上一张 AI 图的主体需要合并参考；不需要则省略该字段", "aspectRatio": "仅文生图任务需要输出，从上述列表中选出的宽高比（如 "16:9"）；图片编辑任务省略该字段"}`;

export interface ImageIntentResult {
  needImage: boolean;
  /** 判断为生图意图时，先展示给用户的确认回复；否则为空 */
  reply?: string;
  /** true = 需要结合上一张 AI 生成的图片：用户不带图时作为唯一编辑参考；用户带新图且消息指代上一张 AI 图主体时，与用户新图合并作为参考 */
  editPrevious?: boolean;
  /** 仅文生图任务：从模型支持列表里选出的宽高比；未明确时为空（走默认 1:1）。图片编辑任务的比例由系统按原图确定，此项为空 */
  aspectRatio?: string;
}

/** 判断失败时的兜底：不生成图片，保持原有聊天流程（判断层故障不该误触发生图） */
const FAIL_OPEN: ImageIntentResult = { needImage: false };

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
    .map((m) => {
      const text = toPlainText(m.content);
      // AI 消息生成过图时标注，让判断器知道"上一张 AI 图存在"，
      // 从而能识别用户不带图、但想继续修改这张图的意图（多轮图编辑）
      const imgNote =
        m.role === 'assistant' && m.generatedImages && m.generatedImages.length > 0
          ? '\n（AI生成了图片）'
          : '';
      return `${m.role === 'user' ? '用户' : 'AI'}：${text}${imgNote}`;
    })
    .join('\n');
}

/** 归一化模型输出的比例：只接受支持列表里的值；auto/全角冒号/非法值一律回落为空（走默认比例） */
function normalizeAspectRatio(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase().replace(/：/g, ':');
  if (!value || value === 'auto') return undefined;
  return SUPPORTED_ASPECT_RATIOS.includes(value) ? value : undefined;
}

/** 去掉模型可能误加的代码块包裹，兼容纯 JSON 输出 */
function parseJudgeResponse(raw: string): ImageIntentResult | null {
  const fenced = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const text = (fenced ? fenced[1] : raw).trim();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.needImage !== 'boolean') return null;
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : undefined;
    return {
      needImage: parsed.needImage,
      reply: reply || undefined,
      editPrevious: parsed.editPrevious === true ? true : undefined,
      aspectRatio: normalizeAspectRatio(parsed.aspectRatio),
    };
  } catch {
    return null;
  }
}

/**
 * 判断用户这条消息是否想生成图片。
 * @param userText 用户最新一条消息的纯文本
 * @param recentMessages 最近几条历史消息，用于理解追问（如"再画个蓝色的"）
 * @param imageCount 用户本条消息附带的图片数量（>0 时按图片编辑任务判断：改图意图 + 修改语气回复）
 */
export async function judgeImageIntent(
  userText: string,
  recentMessages: Message[] = [],
  imageCount = 0
): Promise<ImageIntentResult> {
  if (!userText.trim()) return { needImage: false };

  try {
    const provider = await settingsService.getProvider('llm');
    const apiKey = await settingsService.getApiKey(provider);
    const config = getProviderConfig(provider);
    if (!apiKey) return FAIL_OPEN;

    const context = buildContext(recentMessages);
    // 带图标注：让判断器知道本条消息附带图片，从而识别为图片编辑任务并输出修改语气的回复
    const imageNote = imageCount > 0 ? `（本条消息附带 ${imageCount} 张图片）` : '';
    const userContent = context
      ? `【最近对话背景】\n${context}\n\n【用户最新消息】${imageNote}\n${userText}`
      : imageNote
        ? `${imageNote}\n${userText}`
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
        max_tokens: 300,
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
