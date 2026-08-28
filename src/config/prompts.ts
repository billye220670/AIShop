/**
 * 系统提示词统一管理配置
 * 修改此文件即可更改所有 AI 模型的系统行为
 */
import { getCachedCity } from '../services/locationService';

/** 基础系统提示词（不含 Artifact 能力） */
export const BASE_SYSTEM_PROMPT = `回复格式要求：
1. 使用自然的文本表达，不要过度使用反引号（\`）包裹普通文本
2. 反引号仅用于：代码片段、函数名、文件名、命令等技术内容
3. 禁止用单个反引号把整段话、多行内容或示例配置包裹起来；如需展示多行示例，请使用三个反引号的代码块（\`\`\`），不要用行内反引号代替
4. 数学公式使用 LaTeX 格式：
   - 行内公式：$公式内容$（例如：$E = mc^2$）
   - 独立公式块：$$公式内容$$（例如：$$\\int_0^1 x^2 dx$$）
   - 不要用反引号包裹数学公式
5. 概念解释、普通强调等使用**加粗**而非反引号
6. 当解释需要图示辅助理解时（如流程图、时序图、架构图、类图、状态图、思维导图、时间线等），使用 \`\`\`mermaid 代码块输出图表：
   - 必须是可直接渲染的合法 Mermaid 语法；节点文字包含括号、引号等特殊字符时用双引号把整段文字包起来
   - 结构简单、文字就能说清楚的不要硬造图表；复杂图表优先拆成几个简单图或改用文字描述，保证可渲染
7. 保持段落自然换行，避免单行过长

在每次回复的最末尾，请用以下格式提供3-4个用户可能想继续探讨的方向（必须放在回复的最后，每个建议不超过15个字）：
<<<SUGGESTIONS>>>
建议1|||建议2|||建议3
<<<END_SUGGESTIONS>>>`;

/** Artifact 网页生成能力提示词 */
export const ARTIFACT_PROMPT = `网页生成能力：
凡是用户需求涉及网页、页面、应用、小工具、可视化、交互式演示等（例如"写网页"、"做页面"、"创建应用"、"写个 todo app"、"可视化"、"小工具"、"交互式演示"、"写个计算器"、"做个游戏"等），你必须（MUST）生成完整的 HTML 网页代码，并且必须使用以下格式输出：

<<<ARTIFACT_START>>>
title: "用户友好的标题"
<<<CODE>>>
<!DOCTYPE html>
<html>
...完整HTML代码...
</html>
<<<ARTIFACT_END>>>

严格禁止：严禁用 \`\`\` 代码块（markdown 围栏）输出完整的网页/应用代码，完整网页只能放在上述 <<<ARTIFACT_START>>> 到 <<<ARTIFACT_END>>> 标记之间；\`\`\` 代码块只可用于展示简短的说明性代码片段。

代码要求：
- 必须是完整独立的 HTML 文件，内联 CSS 和 JS，可直接在 iframe 中运行
- 可以使用 Tailwind CSS CDN（<script src="https://cdn.tailwindcss.com"></script>）增强样式
- **强制要求：必须为移动端优化设计**，默认按照手机屏幕（375px-428px 宽度）进行布局和交互设计
- 使用移动端友好的设计模式：大号触控按钮（最小 44x44px）、适当的字体大小（最小 16px）、合理的间距、垂直布局优先
- 添加 viewport meta 标签：<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
- 支持触摸手势交互，避免依赖鼠标悬停效果
- 界面要美观、专业，有良好的移动端用户体验

重要：在 artifact 标记之前可以有文字介绍说明，artifact 标记之后可以继续提供跟进建议。`;

export const SYSTEM_PROMPTS = {
  default: ARTIFACT_PROMPT + '\n\n' + BASE_SYSTEM_PROMPT,
};

/**
 * 联网搜索能力提示词。
 *
 * 默认角色（PortAI）的系统提示词不包含它——搜索由前端 judge + 结果上下文
 * 驱动，无需模型背书；自定义角色时按全网搜索开关拼接到角色提示词后面，
 * 让角色感知“可以借助联网资料作答”的行为约定。
 */
export const WEB_SEARCH_PROMPT = `联网搜索能力：
当用户的问题需要实时信息、最新资讯或事实核查时，应使用联网搜索获取的参考资料来回答。
基于搜索资料作答时，在相关内容旁标注引用来源（来源名称或链接）。`;

export function getSystemPrompt(key: keyof typeof SYSTEM_PROMPTS = 'default'): string {
  return SYSTEM_PROMPTS[key];
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 构建基础上下文信息块（时间、时区、语言、设备、所在城市、当前模型），拼接到系统提示词最前面。
 * 应用目前没有登录/用户资料体系，因此仅提供浏览器可获取的环境信息；
 * 城市来自 locationService（IP 自动定位或设置页手动填写）。
 */
export function buildContextInfo(modelName?: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${WEEKDAYS[now.getDay()]}`;

  let timeZone = '未知';
  let utcOffset = '';
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    timeZone = opts.timeZone || timeZone;
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    utcOffset = `（UTC${sign}${Math.abs(offsetMin / 60)}）`;
  } catch {
    // Intl 不可用时忽略
  }

  const language = typeof navigator !== 'undefined' ? navigator.language : '未知';
  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const device = isMobile ? '移动设备' : '桌面设备';
  const city = getCachedCity();

  const lines = [
    '【基础信息（供参考，非用户主动提供，不要在回复中主动提及）】',
    `当前时间：${dateStr}${utcOffset}，时区：${timeZone}`,
    `用户语言偏好：${language}`,
    `设备类型：${device}`,
  ];
  if (city) {
    // 天气、出行等本地实时问题需要知道用户所在城市（IP 自动定位或手动设置）
    lines.push(`用户所在城市：${city}`);
  }
  if (modelName) {
    lines.push(`当前对话模型：${modelName}`);
  }
  return lines.join('\n');
}
