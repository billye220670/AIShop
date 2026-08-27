import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, Children, memo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Globe, TriangleAlert, Copy, Check, FileText, FileDown, RefreshCw, MessageSquareQuote, ChevronDown, ChevronUp, Search, FoldVertical, Loader2, Brain } from 'lucide-react';
import type { ArtifactBlock } from '../../types';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import type { Message, MessageContent } from '../../types';
import LoadingDots from './LoadingDots';
import MessageImage from './MessageImage';
import { imageDisplaySizeFromRatio, USER_IMAGE_MAX_WIDTH, USER_IMAGE_MAX_HEIGHT } from '../../utils/imageDisplaySize';
import VersionNavigator from './VersionNavigator';
import CompareButton from './CompareButton';
import Toast from '../common/Toast';
import { getPlainText, firstLineOf } from '../../utils/messageText';
import { haptic } from '../../utils/haptics';
import { useDeviceMode } from '../../platform/useDeviceMode';
import { isElectron } from '../../platform/capabilities';

/* ─── 打开外部链接辅助函数 ─── */
function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/* ─── 复制到剪贴板辅助函数 ─── */
async function copyToClipboard(text: string): Promise<boolean> {
  // 方法1: 尝试使用现代 Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      // 验证是否真的复制成功
      try {
        const clipText = await navigator.clipboard.readText();
        if (clipText === text) {
          return true;
        }
      } catch (readErr) {
        // 即使无法验证，仍认为写入成功
        return true;
      }
    } catch (err) {
      // 失败则尝试降级方案
    }
  }

  // 方法2: 降级方案 - 使用 contenteditable div
  try {
    const container = document.createElement('div');
    container.contentEditable = 'true';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '-9999px';
    container.style.width = '1px';
    container.style.height = '1px';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.textContent = text;

    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();

    if (!selection) {
      document.body.removeChild(container);
      return false;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    container.focus();

    const successful = document.execCommand('copy');

    selection.removeAllRanges();
    document.body.removeChild(container);

    if (successful) {
      return true;
    }
  } catch (err) {
    // 继续尝试下一个方案
  }

  // 方法3: 使用 textarea（移动端优化）
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;

    // 移动端友好的样式
    textarea.style.position = 'absolute';
    textarea.style.left = '0';
    textarea.style.top = '0';
    textarea.style.width = '100%';
    textarea.style.height = '2em';
    textarea.style.fontSize = '16px'; // 防止 iOS 缩放
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.color = 'transparent';
    textarea.setAttribute('readonly', '');

    document.body.appendChild(textarea);

    // iOS 特殊处理
    const userAgent = navigator.userAgent.toLowerCase();
    const isiOS = /iphone|ipad|ipod/.test(userAgent);

    if (isiOS) {
      const range = document.createRange();
      range.selectNodeContents(textarea);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      textarea.setSelectionRange(0, text.length);
    } else {
      textarea.focus();
      textarea.select();
    }

    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (successful) {
      return true;
    }
  } catch (err) {
    // 所有方案都失败
  }

  return false;
}

/* ─── CodeBlock 组件：语法高亮 + 复制按钮 + 语言标签 ─── */
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  const handleCopy = async () => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopied(true);
      setToastMessage('已复制到剪贴板');
      setToastType('success');
      setShowToast(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setToastMessage('复制失败，请重试');
      setToastType('error');
      setShowToast(true);
    }
  };

  let highlighted: string;
  if (language && hljs.getLanguage(language)) {
    highlighted = hljs.highlight(code, { language }).value;
  } else {
    highlighted = hljs.highlightAuto(code).value;
  }

  return (
    <>
      {showToast && (
        <Toast
          message={toastMessage}
          type={toastType}
          onClose={() => setShowToast(false)}
        />
      )}
      <div className="relative group rounded-lg overflow-hidden my-3 border border-gray-700">
        {/* 顶部栏：语言标签 + 复制按钮 */}
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-code-bg)] text-xs text-gray-400">
          <span>{language || 'code'}</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-gray-400 hover:text-gray-200 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        {/* 代码区域 */}
        <pre className="!m-0 !rounded-none !bg-[var(--color-code-bg)]">
          <code
            className="block px-4 py-3 overflow-x-auto text-sm !bg-transparent"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </>
  );
}

const PROVIDER_ICON_MAP: Record<string, string> = {
  Anthropic: 'claude-color.svg',
  Google: 'gemini-color.svg',
  OpenAI: 'openai.svg',
  xAI: 'grok.svg',
  DeepSeek: 'deepseek-color.svg',
  '智谱': 'zhipu-color.svg',
  Moonshot: 'kimi-color.svg',
  ByteDance: 'bytedance-color.svg',
  Alibaba: 'qwen-color.svg',
  Xiaomi: 'xiaomimimo.svg',
};

function getProviderIcon(provider: string): string {
  const icon = PROVIDER_ICON_MAP[provider];
  return icon ? `${import.meta.env.BASE_URL}providers/${icon}` : `${import.meta.env.BASE_URL}providers/openai.svg`;
}

/* ─── 搜索高亮：纯文本分支（用户消息 / 多段内容里的文本段） ─── */
function renderTextWithHighlight(
  text: string,
  query: string,
  occurrenceStart: number,
  activeOccurrence?: number
): { nodes: React.ReactNode; occurrenceCount: number } {
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let idx = lower.indexOf(q);
  let occurrence = occurrenceStart;
  let count = 0;
  while (idx !== -1) {
    if (idx > lastIdx) nodes.push(text.slice(lastIdx, idx));
    nodes.push(
      <mark
        key={`m-${occurrence}`}
        className={`search-highlight${occurrence === activeOccurrence ? ' search-highlight-active' : ''}`}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    occurrence++;
    count++;
    lastIdx = idx + query.length;
    idx = lower.indexOf(q, lastIdx);
  }
  if (lastIdx < text.length) nodes.push(text.slice(lastIdx));
  return { nodes, occurrenceCount: count };
}

/* ─── 搜索高亮：markdown 分支 ───
 * ReactMarkdown 把字符串解析成 AST 再渲染，不能对渲染前的源文本插 <mark>
 * 标签（会被转义或破坏语法）。也不能渲染完再直接操作 DOM 包裹 <mark>：
 * 拆文本节点 + normalize 会替换/合并 React fiber 引用的节点，流式追加或
 * 插入新消息时 React commit 用失效节点做 insertBefore 会抛 NotFoundError。
 * 因此高亮必须发生在渲染层：覆盖文本容器/行内组件，对其直接字符串 children
 * 复用 renderTextWithHighlight 拆成 <mark>（高亮节点由 React 管理，与
 * commit 阶段 DOM 操作不再冲突）。code/pre 不覆盖，代码内部保持不高亮，
 * 与旧 DOM 方案的 TreeWalker 跳过行为一致。 */

/* ─── 搜索高亮：markdown 分支的渲染期游标 ───
 * 每条消息一个 useRef 游标：markdown 渲染前重置为 0，各组件按文档顺序
 * （ReactMarkdown 深度优先渲染）累加命中次数，用于标记当前跳转项。
 */


interface MessageBubbleProps {
  message: Message;
  onSuggestionClick?: (text: string) => void;
  showSuggestions?: boolean;
  modelName?: string;
  modelProvider?: string;
  onOpenArtifact?: (artifact: ArtifactBlock) => void;
  onRegenerate?: (messageId: string) => void;
  onQuote?: (message: Message) => void;
  /** 保存为 Markdown 时同步存入「我的库」：消息 id + 标题 + 纯文本内容 */
  onSaveMarkdown?: (messageId: string, title: string, content: string) => void;
  isStreaming?: boolean;
  onCompareWithModel?: (messageId: string, modelId: string) => void;
  onSwitchVersion?: (messageId: string, index: number) => void;
  /** 折叠浏览模式：AI 回复只显示一行摘要，其余全部隐藏 */
  collapsed?: boolean;
  /** 长按菜单里的「查找」入口 */
  onOpenSearch?: () => void;
  /** 长按菜单里的「折叠回复」入口，逻辑与上下快速滑动手势触发的折叠相同 */
  onFold?: () => void;
  /** 对话内搜索关键词，非空时对本条消息文本做高亮 */
  searchQuery?: string;
  /** 当前高亮命中在本条消息内的第几次出现（从 0 开始），无命中或非当前项时为 undefined */
  activeMatchOccurrence?: number;
}

function MessageBubble({ message, onSuggestionClick, showSuggestions, modelName, modelProvider, onOpenArtifact, onRegenerate, onQuote, onSaveMarkdown, isStreaming, onCompareWithModel, onSwitchVersion, collapsed, onOpenSearch, onFold, searchQuery, activeMatchOccurrence }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  // PC 端（精确指针鼠标/触控板）允许自由选择对话文本、放行右键菜单；
  // 触摸设备保持禁止选择 + 长按菜单，避免原生文本选择与长按手势冲突
  const isDesktop = useDeviceMode() === 'desktop' && window.matchMedia('(pointer: fine)').matches;
  const [copied, setCopied] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false); // 新增：控制搜索结果展开/折叠
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // --- 长按上下文菜单（复用 Sidebar.tsx 的长按检测模式） ---
  const [menuOpen, setMenuOpen] = useState(false);
  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** 长按已触发，记录时间戳用于吞掉紧随其后的合成 click。
   *  用时间戳而不是布尔：长按后的合成 click 往往不落在消息上（遮罩/弹窗
   *  接住），布尔标志会残留到下一次普通点击，把那次点击误吞成"没反应"。 */
  const suppressClickRef = useRef(0);
  const SUPPRESS_WINDOW_MS = 500;
  /**
   * 菜单锚点 = 手指按下的视口坐标。
   * 之前菜单是 `absolute right-3 top-3`，锚在整条消息的右上角——长回复有好几屏高，
   * 手指在中段长按时菜单弹在屏幕外或远离手指，看着就像"没弹出来"。
   */
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** 菜单弹出时刻。长按松手瞬间 Chrome 会把合成 click 派发给刚覆盖全屏的
   *  遮罩（pointerup 时遮罩已压住手指），若遮罩 onClick 立刻执行，菜单会被
   *  自己"点外关闭"——弹出后短暂窗口内的 click 必须吞掉。 */
  const menuOpenedAtRef = useRef(0);

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressOriginRef.current = null;
  };

  /**
   * 在视口坐标处打开消息级上下文菜单（移动端长按 / PC 端右键共用）。
   * 坐标含义与长按定时器一致：clientX/Y，定位逻辑会自行做边缘钳制。
   */
  const openMenuAt = (x: number, y: number) => {
    suppressClickRef.current = Date.now();
    menuOpenedAtRef.current = Date.now();
    setMenuPos({ x, y });
    setMenuOpen(true);
    window.getSelection?.()?.removeAllRanges();
    haptic();
  };

  const handlePressStart = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearPressTimer();
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    const { clientX, clientY } = e;
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      openMenuAt(clientX, clientY);
    }, LONG_PRESS_MS);
  };

  const handlePressMove = (e: React.PointerEvent) => {
    const origin = pressOriginRef.current;
    if (!origin || !pressTimerRef.current) return;
    const dx = Math.abs(e.clientX - origin.x);
    const dy = Math.abs(e.clientY - origin.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
      clearPressTimer();
    }
  };

  useEffect(() => () => clearPressTimer(), []);

  useEffect(() => {
    if (!menuOpen) return;
    // 长按松手后的合成 click 会命中刚覆盖全屏的遮罩并继续冒泡到这里，
    // 必须吞掉弹出后短暂窗口内的 click，否则菜单会被"点外关闭"自己关掉；
    // pointerdown 是真实触摸，无需过滤
    const handleClick = () => {
      if (Date.now() - menuOpenedAtRef.current < 500) return;
      setMenuOpen(false);
    };
    const handlePointerDown = () => setMenuOpen(false);
    document.addEventListener('click', handleClick);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen]);

  /**
   * 菜单弹出后锁住背后的滚动。
   * 长按是在手指没抬起时触发的，此刻原生滚动手势已经"归属"给了消息容器，
   * 后续 touchmove 由合成器线程直接滚，JS 拦不住——除非把容器本身变成不可滚。
   * 所以直接改 overflow，并把 scrollTop 还原（overflow 切换会让浏览器夹一次位置）。
   */
  useEffect(() => {
    if (!menuOpen) return;
    const scroller = document.querySelector<HTMLElement>('[data-messages-container]');
    if (!scroller) return;
    const prevOverflow = scroller.style.overflowY;
    const prevTouch = scroller.style.touchAction;
    const frozenTop = scroller.scrollTop;
    scroller.style.overflowY = 'hidden';
    scroller.style.touchAction = 'none';
    if (scroller.scrollTop !== frozenTop) scroller.scrollTop = frozenTop;
    return () => {
      scroller.style.overflowY = prevOverflow;
      scroller.style.touchAction = prevTouch;
      scroller.scrollTop = frozenTop;
    };
  }, [menuOpen]);

  /**
   * 菜单开出来后按实际尺寸自适应位置：优先在手指右下方展开，
   * 贴到视口边缘就翻到另一侧，最后再统一夹进安全边距内。
   * 用 useLayoutEffect 在绘制前落位，避免先闪一下错位。
   */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menuOpen || !el || !menuPos) return;
    const MARGIN = 8;
    const GAP = 6;

    // 高度得先解开：菜单可能已经被上一次的 maxHeight 压过，
    // 不清掉就会一直沿用那个更小的值。
    el.style.maxHeight = '';
    el.style.overflowY = '';
    /* 用 offsetWidth/Height 而不是 getBoundingClientRect：
       弹出动画 context-menu-pop 从 scale(0.92) 起步，此刻 rect 量到的是被缩小
       8% 的尺寸，据此判断"下方放得下"就会少算十几像素，菜单底部正好被切一条。
       offset* 是布局尺寸，不受 transform 影响。 */
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    /* 移动端必须用 visualViewport：window.innerHeight 是"大视口"，
       含浏览器工具栏占掉的那一条，按它算出来的底边在屏幕外，
       菜单就被截断。visualViewport 才是真正可见的那块。 */
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    // visualViewport 的坐标原点跟着页面缩放/平移走，clientX/Y 是相对它的，
    // 所以边界也要换算到同一套坐标里
    // position:fixed 的原点是布局视口，clientX/Y 却相对可见视口，
    // 页面被推上去（比如键盘弹起）时两者差一个 offset，必须补上
    const offsetX = vv?.offsetLeft ?? 0;
    const offsetY = vv?.offsetTop ?? 0;
    const minX = offsetX + MARGIN;
    const maxX = offsetX + vw - MARGIN;
    const minY = offsetY + MARGIN;
    const maxY = offsetY + vh - MARGIN;

    // 手指坐标换算到 fixed 用的那套坐标里
    const anchorX = menuPos.x + offsetX;
    const anchorY = menuPos.y + offsetY;

    let left = anchorX + GAP;
    if (left + width > maxX) left = anchorX - GAP - width; // 右侧放不下 → 翻到左边
    left = Math.min(Math.max(left, minX), Math.max(minX, maxX - width));

    // 上下都塞不进整个菜单时，选空间更大的一侧并让它内部滚动，
    // 而不是硬塞出去被截断
    let top = anchorY + GAP;
    const spaceBelow = maxY - (anchorY + GAP);
    const spaceAbove = anchorY - GAP - minY;
    if (height > spaceBelow) {
      if (height <= spaceAbove) {
        top = anchorY - GAP - height; // 上方放得下 → 翻到上边
      } else {
        const usable = Math.max(spaceBelow, spaceAbove);
        el.style.maxHeight = `${Math.max(120, usable)}px`;
        el.style.overflowY = 'auto';
        top = spaceAbove > spaceBelow ? minY : anchorY + GAP;
      }
    }
    const finalHeight = el.offsetHeight;
    top = Math.min(Math.max(top, minY), Math.max(minY, maxY - finalHeight));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // 展开方向跟着翻，动画的起点才对得上手指
    el.style.transformOrigin = `${top > anchorY ? 'top' : 'bottom'} ${
      left >= anchorX ? 'left' : 'right'
    }`;
    el.style.visibility = 'visible';
  }, [menuOpen, menuPos]);

  // 多版本相关
  const hasMultipleVersions = message.versions && message.versions.length > 1;
  const activeVersion = message.versions?.[message.activeVersionIndex ?? 0];

  // 确定要显示的内容（版本感知）
  const displayContent = activeVersion ? activeVersion.content : message.content;
  const displayIsStreaming = activeVersion ? activeVersion.isStreaming : message.isStreaming;
  const displaySuggestions = activeVersion ? activeVersion.suggestions : message.suggestions;
  const displayArtifact = activeVersion ? activeVersion.artifact : message.artifact;
  const displayWebSearched = activeVersion ? activeVersion.webSearched : message.webSearched;
  const displayWebSearchFailed = activeVersion ? activeVersion.webSearchFailed : message.webSearchFailed;
  const displaySearchResults = activeVersion ? activeVersion.searchResults : message.searchResults;
  const displayWebSearching = activeVersion ? activeVersion.webSearching : message.webSearching;
  const displayStoppedByUser = activeVersion ? activeVersion.stoppedByUser : message.stoppedByUser;
  // 聊天内生成的图片：生成中（shimmer）/ 结果 / 失败信息
  const displayImageGenerating = activeVersion ? activeVersion.imageGenerating : message.imageGenerating;
  const displayGeneratedImages = activeVersion ? activeVersion.generatedImages : message.generatedImages;
  const displayImageGenerateError = activeVersion ? activeVersion.imageGenerateError : message.imageGenerateError;
  // 生图请求的元信息（模型/提示词/宽高比）：骨架与图片占位按比例预占尺寸，回传后不跳变
  const displayGeneratedImage = activeVersion ? activeVersion.generatedImage : message.generatedImage;
  const imagePlaceholderSize = useMemo(
    () => imageDisplaySizeFromRatio(displayGeneratedImage?.aspectRatio),
    [displayGeneratedImage]
  );

  // 保存为 Markdown：下载 .md 文件，同时存入「我的库」（markdown 资产，
  // 按 sourceRef=消息 id 去重，重复保存不会产生重复资产）
  const handleSaveMarkdown = () => {
    const content = getPlainText(displayContent);
    const title = content.slice(0, 20).replace(/[\\/:*?"<>|\n]/g, '_').trim() || '文档';
    onSaveMarkdown?.(message.id, title, content);
    const fileName = `${title}.md`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setToastMessage('已保存到我的库');
    setToastType('success');
    setShowToast(true);
  };

  // AI消息内容为空且正在流式输出 → 显示加载状态
  const isAiLoading = !isUser && displayIsStreaming && (
    typeof displayContent === 'string' ? displayContent === '' : false
  );

  // 预处理内容：将引用标识 [N] 转为可识别的链接格式
  const preprocessCitations = useCallback((text: string) => {
    if (!displaySearchResults || displaySearchResults.length === 0) return text;
    // 匹配 [1], [2] ... [N] 形式的引用标识（排除 markdown 链接语法 [text](url) ）
    return text.replace(/\[(\d+)\](?!\()/g, (match, num) => {
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < displaySearchResults.length) {
        return `[${num}](cite:${num})`;
      }
      return match;
    });
  }, [displaySearchResults]);

  // AI 消息 markdown 搜索高亮：渲染期游标（markdown 分支渲染前重置，
  // 各覆盖组件按文档顺序累加命中次数，标记当前跳转项）
  const searchCursorRef = useRef(0);

  // 渲染层搜索高亮：只处理直接字符串 children（行内组件自身处理自己的文本，
  // 不递归，避免 mark 被二次拆分）。返回的 <mark> 由 React 管理，不破坏 fiber。
  const highlightMarkdownChildren = (children: React.ReactNode): React.ReactNode => {
    const q = searchQuery?.trim();
    if (!q) return children;
    return Children.map(children, (child) => {
      if (typeof child !== 'string') return child;
      const { nodes, occurrenceCount } = renderTextWithHighlight(child, q, searchCursorRef.current, activeMatchOccurrence);
      searchCursorRef.current += occurrenceCount;
      return nodes;
    });
  };

  const renderContent = () => {
    if (typeof displayContent === 'string') {
      if (isUser) {
        if (searchQuery && searchQuery.trim()) {
          const { nodes } = renderTextWithHighlight(displayContent, searchQuery.trim(), 0, activeMatchOccurrence);
          return <p className="whitespace-pre-wrap">{nodes}</p>;
        }
        return <p className="whitespace-pre-wrap">{displayContent}</p>;
      }
      const processedContent = preprocessCitations(displayContent);
      // markdown 渲染前重置高亮游标（各覆盖组件渲染时按文档顺序累加）
      searchCursorRef.current = 0;
      return (
        <div className="prose prose-invert max-w-none prose-headings:text-gray-100 prose-p:text-gray-200 prose-strong:text-white prose-code:text-blue-300 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-transparent prose-pre:border-none prose-pre:p-0 prose-a:text-blue-400 prose-li:text-gray-200 prose-blockquote:border-gray-600 prose-blockquote:text-gray-300 prose-th:text-gray-200 prose-td:text-gray-300 prose-hr:border-gray-700">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            urlTransform={(url) => url}
            components={{
              // 搜索高亮覆盖：文本容器/行内组件用渲染层高亮处理直接文本 children，
              // 与默认标签保持一致（prose 样式由外层容器类负责）。
              // code/pre 不覆盖：代码块内部保持不高亮，且 CodeBlock 依赖纯字符串 props。
              p({ children }) {
                return <p>{highlightMarkdownChildren(children)}</p>;
              },
              li({ children }) {
                return <li>{highlightMarkdownChildren(children)}</li>;
              },
              td({ children }) {
                return <td>{highlightMarkdownChildren(children)}</td>;
              },
              th({ children }) {
                return <th>{highlightMarkdownChildren(children)}</th>;
              },
              h1({ children }) { return <h1>{highlightMarkdownChildren(children)}</h1>; },
              h2({ children }) { return <h2>{highlightMarkdownChildren(children)}</h2>; },
              h3({ children }) { return <h3>{highlightMarkdownChildren(children)}</h3>; },
              h4({ children }) { return <h4>{highlightMarkdownChildren(children)}</h4>; },
              h5({ children }) { return <h5>{highlightMarkdownChildren(children)}</h5>; },
              h6({ children }) { return <h6>{highlightMarkdownChildren(children)}</h6>; },
              blockquote({ children }) {
                return <blockquote>{highlightMarkdownChildren(children)}</blockquote>;
              },
              strong({ children }) {
                return <strong>{highlightMarkdownChildren(children)}</strong>;
              },
              em({ children }) {
                return <em>{highlightMarkdownChildren(children)}</em>;
              },
              del({ children }) {
                return <del>{highlightMarkdownChildren(children)}</del>;
              },
              span({ children }) {
                return <span>{highlightMarkdownChildren(children)}</span>;
              },
              code({ children }) {
                // 不展开其余 props：里面带着 react-markdown 的 node 字段，
                // 传到 DOM 上会触发 React 未知属性警告
                return (
                  <code className="bg-gray-700/40 px-1 py-0.5 rounded text-[0.9em]">
                    {children}
                  </code>
                );
              },
              pre({ children }) {
                // pre 的子节点是 <code>，语言标识挂在它的 className 上
                const codeEl = Array.isArray(children) ? children[0] : children;
                const props = (codeEl as { props?: { className?: string; children?: unknown } })
                  ?.props;
                const match = /language-(\w+)/.exec(props?.className || '');
                const codeStr = String(props?.children ?? '').replace(/\n$/, '');
                return <CodeBlock code={codeStr} language={match?.[1]} />;
              },
              a({ href, children }) {
                // 引用标识：cite:N 格式 → 渲染为圆形数字按钮
                if (href?.startsWith('cite:')) {
                  const num = href.replace('cite:', '');
                  const idx = parseInt(num, 10) - 1;
                  const url = displaySearchResults?.[idx]?.url;
                  return (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); if (url) openUrl(url); }}
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-[10px] font-bold hover:bg-[var(--color-accent)]/40 hover:text-white transition-colors cursor-pointer align-super mx-0.5 no-underline"
                      title={displaySearchResults?.[idx]?.name || `来源 ${num}`}
                    >
                      {num}
                    </button>
                  );
                }
                // 普通链接：用系统浏览器打开（children 过一遍渲染层高亮）
                return (
                  <a
                    href={href}
                    onClick={(e) => { e.preventDefault(); if (href) openUrl(href); }}
                    className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                  >
                    {highlightMarkdownChildren(children)}
                  </a>
                );
              }
            }}
          >
            {processedContent}
          </ReactMarkdown>
          {displayIsStreaming && (
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] animate-[pulse-dot_1.4s_ease-in-out_infinite] ml-1 align-middle shadow-[0_0_8px_var(--color-accent)]" />
          )}
        </div>
      );
    }

    // Multi-part content (text + images)
    const parts = displayContent as MessageContent[];
    // 图片在上、文字在下（微信发图观感）：只调显示顺序，不改数据里的
    // 部分顺序——API 发送与落盘格式保持原样，新老消息显示一致
    const orderedParts = [...parts].sort((a, b) => {
      const rank = (p: MessageContent) => (p.type === 'image_url' ? 0 : 1);
      return rank(a) - rank(b);
    });
    let occurrenceCursor = 0;
    return (
      <div className="space-y-2">
        {orderedParts.map((part, idx) => {
          if (part.type === 'text' && part.text) {
            if (searchQuery && searchQuery.trim()) {
              const { nodes, occurrenceCount } = renderTextWithHighlight(part.text, searchQuery.trim(), occurrenceCursor, activeMatchOccurrence);
              occurrenceCursor += occurrenceCount;
              return <p key={idx} className="whitespace-pre-wrap">{nodes}</p>;
            }
            return <p key={idx} className="whitespace-pre-wrap">{part.text}</p>;
          }
          if (part.type === 'image_url' && part.image_url) {
            // 走 MessageImage 而不是直接 <img>：图片存在 IndexedDB 里，
            // 地址是 aishop-blob:<id>，需要按需换成 object URL 并在卸载时释放
            return (
              <MessageImage
                key={idx}
                src={part.image_url.url}
                alt="上传的图片"
              />
            );
          }
          return null;
        })}
      </div>
    );
  };

  // 用户消息内容拆分：图片不放气泡里（微信式直出，图片在上），文本（若有）保留在气泡里
  const userImageParts = Array.isArray(displayContent)
    ? displayContent.filter(
        (p): p is MessageContent & { image_url: { url: string } } => p.type === 'image_url' && !!p.image_url?.url
      )
    : [];
  const hasUserImages = userImageParts.length > 0;
  const hasUserText =
    typeof displayContent === 'string'
      ? displayContent.trim().length > 0
      : displayContent.some(p => p.type === 'text' && p.text);

  // 用户消息文本渲染：与 renderContent 的文本分支一致（含搜索高亮），
  // 仅在有图片拆分时使用；无图片时整条消息仍走 renderContent
  const renderUserText = () => {
    if (typeof displayContent === 'string') {
      if (searchQuery && searchQuery.trim()) {
        const { nodes } = renderTextWithHighlight(displayContent, searchQuery.trim(), 0, activeMatchOccurrence);
        return <p className="whitespace-pre-wrap">{nodes}</p>;
      }
      return <p className="whitespace-pre-wrap">{displayContent}</p>;
    }
    const textParts = displayContent.filter(
      (p): p is MessageContent & { text: string } => p.type === 'text' && !!p.text
    );
    let occurrenceCursor = 0;
    return (
      <div className="space-y-2">
        {textParts.map((part, idx) => {
          if (searchQuery && searchQuery.trim()) {
            const { nodes, occurrenceCount } = renderTextWithHighlight(part.text, searchQuery.trim(), occurrenceCursor, activeMatchOccurrence);
            occurrenceCursor += occurrenceCount;
            return <p key={idx} className="whitespace-pre-wrap">{nodes}</p>;
          }
          return <p key={idx} className="whitespace-pre-wrap">{part.text}</p>;
        })}
      </div>
    );
  };

  // 用户消息：加上长按上下文菜单（目前只有复制），气泡样式保持原样
  if (isUser) {
    return (
      <>
        {showToast && (
          <Toast
            message={toastMessage}
            type={toastType}
            onClose={() => setShowToast(false)}
          />
        )}
        {menuOpen && createPortal(
          /* 同 AI 分支：portal + touch-none，避免遮罩上的手势被误传成背景滚动 */
          <div
            className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay touch-none overscroll-none"
            onClick={() => {
              // 长按松手后的合成 click target 会被刚覆盖全屏的遮罩接住，
              // 不吞掉的话菜单弹出即被自己关闭
              if (Date.now() - menuOpenedAtRef.current < 500) return;
              setMenuOpen(false);
            }}
            onPointerDown={() => setMenuOpen(false)}
            onTouchMove={e => e.preventDefault()}
          />,
          document.body
        )}
        <div
          className={`relative flex flex-col items-end mb-4 ${isDesktop ? 'select-text' : 'select-none [-webkit-touch-callout:none]'} ${menuOpen ? 'z-[201]' : ''}`}
          onPointerDown={isDesktop ? undefined : handlePressStart}
          onPointerMove={handlePressMove}
          onPointerUp={clearPressTimer}
          onPointerCancel={clearPressTimer}
          onPointerLeave={clearPressTimer}
          /* Web PC 端右键弹出与移动端长按一致的消息级菜单；Electron 端不弹
             （查找走 Ctrl+F），移动端维持拦截默认菜单 */
          onContextMenu={e => {
            e.preventDefault();
            if (isDesktop && !isElectron()) openMenuAt(e.clientX, e.clientY);
          }}
          onClick={e => {
            if (Date.now() - suppressClickRef.current < SUPPRESS_WINDOW_MS) {
              suppressClickRef.current = 0;
              // 长按松手后的合成 click 若继续冒泡到 document，会被「点击外部
              // 关闭菜单」的监听器接住，把刚弹出的菜单立刻关掉，这里必须掐断
              e.stopPropagation();
            }
          }}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 max-w-[80%] justify-end">
              {message.attachments.map((file, idx) => (
                <div key={idx} className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-secondary)] border border-gray-700/50 rounded-lg min-w-[200px] max-w-[280px]">
                  <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-[var(--color-accent-soft)]">
                    <FileText className="w-5 h-5 text-[var(--color-accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-200 font-medium truncate">{file.name}</div>
                    <div className="text-xs text-gray-500">File</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 用户发的图片不放气泡里（微信式直出，图片在上）；文本（若有）仍在气泡里 */}
          {hasUserImages && (
            <div className={`max-w-[80%] space-y-2 ${hasUserText ? 'mb-2' : ''}`}>
              {userImageParts.map((part, idx) => (
                <MessageImage
                  key={idx}
                  src={part.image_url.url}
                  alt="上传的图片"
                  maxWidth={USER_IMAGE_MAX_WIDTH}
                  maxHeight={USER_IMAGE_MAX_HEIGHT}
                />
              ))}
            </div>
          )}
          {(hasUserText || !hasUserImages) && (
            <div className="max-w-[80%] rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-none px-4 py-3 bg-[var(--color-accent)] text-[var(--color-accent-foreground)]">
              {hasUserImages ? renderUserText() : renderContent()}
            </div>
          )}

          {/* 长按上下文菜单：目前只有复制，后续要加别的操作再往这里补 */}
          {menuOpen && createPortal(
            <div
              ref={menuRef}
              style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
              className="z-[200] w-52 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2 select-none context-menu-pop"
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
            >
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  const text = getPlainText(displayContent);
                  const success = await copyToClipboard(text);
                  setToastMessage(success ? '已复制到剪贴板' : '复制失败，请重试');
                  setToastType(success ? 'success' : 'error');
                  setShowToast(true);
                }}
                // iOS 长按手势结束后首次 tap 的合成 click 会被 WebKit 吞掉，
                // 菜单项用 pointerup 触发（不受抑制），onClick 保留给键盘兜底
                onPointerUp={async e => {
                  if (e.button !== 0) return;
                  setMenuOpen(false);
                  const text = getPlainText(displayContent);
                  const success = await copyToClipboard(text);
                  setToastMessage(success ? '已复制到剪贴板' : '复制失败，请重试');
                  setToastType(success ? 'success' : 'error');
                  setShowToast(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
              >
                <Copy className="w-5 h-5 flex-shrink-0" />
                <span>复制</span>
              </button>
            </div>,
            document.body
          )}
        </div>
      </>
    );
  }

  // 折叠浏览模式：AI 回复只显示原文第一行（超宽省略），其余全部隐藏
  // 不做寒暄过滤/智能摘要 —— 用户自己发的消息本来就没被折叠，是天然的定位锚点
  if (collapsed && !displayIsStreaming) {
    return (
      <div className="flex justify-start mb-3 fold-line-in">
        {/* 折叠态给个气泡外形（和用户气泡镜像：左下方角是直角），
            用户才知道这一行是一个可点开的整体，而不是一段被截断的文字 */}
        <div
          role="button"
          tabIndex={0}
          aria-label="展开这条回复"
          className="fold-collapsed-bubble group flex items-center gap-2.5 max-w-[85%] px-4 py-4 rounded-tl-2xl rounded-tr-2xl rounded-br-2xl rounded-bl-none bg-[var(--color-bg-secondary)] text-left cursor-pointer transition-colors hover:bg-[var(--color-bg-elevated)] active:bg-[var(--color-bg-elevated)]"
        >
          <span className="flex-1 min-w-0 truncate whitespace-nowrap text-sm text-gray-300">
            {firstLineOf(displayContent) || '（空）'}
          </span>
          <ChevronDown className="flex-shrink-0 w-4 h-4 text-gray-500 group-hover:text-gray-300" />
        </div>
      </div>
    );
  }

  // AI消息：无背景、无边框、撑满宽度
  return (
    <>
      {showToast && (
        <Toast
          message={toastMessage}
          type={toastType}
          onClose={() => setShowToast(false)}
        />
      )}
      {menuOpen && createPortal(
        /* 同样要 portal + touch-none：留在原地会被消息容器裁掉，
           而 touch-action:none 保证落在遮罩上的手势不会传成背景滚动 */
        <div
          className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay touch-none overscroll-none"
          onClick={() => {
            // 长按松手后的合成 click target 会被刚覆盖全屏的遮罩接住，
            // 不吞掉的话菜单弹出即被自己关闭
            if (Date.now() - menuOpenedAtRef.current < 500) return;
            setMenuOpen(false);
          }}
          onPointerDown={() => setMenuOpen(false)}
          onTouchMove={e => e.preventDefault()}
        />,
        document.body
      )}
      <div
        /* 菜单打开时只把这条消息抬到遮罩之上，绝不能加 transform 类
           （比如 context-menu-pop 的 scale）：一是整条回复被缩放看着像"内容被放大"，
           二是带 transform 的祖先会成为 position:fixed 的包含块，把菜单从
           手指坐标拽回这条消息的角上 */
        className={`relative flex justify-start mb-4 ${isDesktop ? 'select-text' : 'select-none [-webkit-touch-callout:none]'} ${menuOpen ? 'z-[201]' : ''}`}
        onPointerDown={!displayIsStreaming && !isStreaming && !isDesktop ? handlePressStart : undefined}
        onPointerMove={handlePressMove}
        onPointerUp={clearPressTimer}
        onPointerCancel={clearPressTimer}
        onPointerLeave={clearPressTimer}
        /* Web PC 端右键弹出与移动端长按一致的消息级菜单（流式中不弹，与长按禁用条件一致）；
           Electron 端不弹（查找走 Ctrl+F），移动端维持拦截默认菜单 */
        onContextMenu={e => {
          e.preventDefault();
          if (isDesktop && !isElectron() && !displayIsStreaming && !isStreaming) openMenuAt(e.clientX, e.clientY);
        }}
        onClick={e => {
          if (Date.now() - suppressClickRef.current < SUPPRESS_WINDOW_MS) {
            suppressClickRef.current = 0;
            // 长按松手后的合成 click 若继续冒泡到 document，会被「点击外部
            // 关闭菜单」的监听器接住，把刚弹出的菜单立刻关掉，这里必须掐断
            e.stopPropagation();
          }
        }}
      >
        <div className="w-full px-4 py-3 text-gray-100">
        {/* 模型图标 + 名称 / 版本导航 */}
        <div className="flex items-center gap-2 mb-4">
          {hasMultipleVersions ? (
            <VersionNavigator
              versions={message.versions!}
              activeIndex={message.activeVersionIndex ?? 0}
              onSwitch={(idx) => onSwitchVersion?.(message.id, idx)}
            />
          ) : modelProvider === 'Auto' ? (
            <>
              <Brain className="w-5 h-5 text-[var(--color-accent)]" />
              <span className="text-sm font-medium text-gray-300">{modelName || 'Portify'}</span>
            </>
          ) : (
            <>
              <img
                src={modelProvider ? getProviderIcon(modelProvider) : `${import.meta.env.BASE_URL}providers/openai.svg`}
                alt={modelProvider || 'AI'}
                className="w-5 h-5"
              />
              <span className="text-sm font-medium text-gray-300">{modelName || 'AI'}</span>
            </>
          )}
        </div>

        {/* 联网搜索提示 - 始终在最顶部实时显示，不受 loading 状态影响 */}
        {displayWebSearching && (
          <div className="inline-flex items-center py-1.5 px-3 mb-3 rounded-lg">
            <svg className="w-4 h-4 mr-2 text-[var(--color-accent)] animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-base text-gray-400">正在搜索...</span>
          </div>
        )}

        {!displayWebSearching && displayWebSearched && displaySearchResults && displaySearchResults.length > 0 && (
          <div className="inline-flex items-center py-1.5 px-3 mb-3 cursor-pointer hover:bg-gray-800/50 rounded-lg transition-colors group" onClick={() => setShowSearchResults(!showSearchResults)}>
            <span className="text-base text-gray-500">已搜索{displaySearchResults.length}个来源</span>
            <button className="ml-auto p-1 opacity-50 hover:opacity-100 transition-opacity">
              {showSearchResults ? (
                <ChevronUp className="w-4 h-4 ml-1" />
              ) : (
                <ChevronDown className="w-4 h-4 ml-1" />
              )}
            </button>
          </div>
        )}

        {/* 加载状态 - 搜索中时不显示 loading 动画 */}
        {isAiLoading && !displayWebSearching && <LoadingDots />}

        {/* 正常内容 */}
        {!isAiLoading && (
          <>

            {/* 可折叠的搜索结果 */}
            {displaySearchResults && displaySearchResults.length > 0 && !displayWebSearching && (
              <div className={`transition-all duration-300 ease-in-out overflow-hidden ${
                showSearchResults ? 'max-h-[500px] opacity-100 my-3' : 'max-h-0 opacity-0 my-0'
              }`}>
                <div className="p-3 bg-[var(--color-bg-primary)] border border-gray-700 rounded-xl overflow-hidden">
                  <div className="overflow-y-auto max-h-[400px] space-y-2">
                  {displaySearchResults.map((source, idx) => (
                    <div
                      key={idx}
                      onClick={() => openUrl(source.url)}
                      className="flex items-start gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors group cursor-pointer"
                    >
                      <img 
                        src={`https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(source.url)}`}
                        alt="icon"
                        className="w-4 h-4 mt-0.5 flex-shrink-0 rounded-sm"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-300 font-medium line-clamp-1 truncate">{source.name}</div>
                        <div className="text-xs text-gray-500 line-clamp-1 truncate">{source.siteName || source.url}</div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-xs text-blue-400">↗</span>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            )}

            {displayWebSearchFailed && (
              <div className="flex items-center gap-1.5 text-xs text-yellow-400 mb-3">
                <TriangleAlert className="w-3.5 h-3.5" />
                <span>联网搜索失败，以下回答未参考网络信息</span>
              </div>
            )}

            {/* 主要内容 */}
            {renderContent()}

            {/* 聊天内生成的图片：生成中显示 shimmer 骨架（按请求比例占位、无边框），完成后图片原位显示，失败显示错误 */}
            {displayImageGenerating && (
              <div
                className="mt-3 relative overflow-hidden rounded-xl bg-[var(--color-bg-secondary)]"
                style={{ width: imagePlaceholderSize.width, height: imagePlaceholderSize.height }}
              >
                <div className="image-shimmer-sweep" />
                <div className="relative flex flex-col items-center justify-center gap-2 h-full">
                  <Loader2 className="w-6 h-6 text-[var(--color-accent)] animate-spin" />
                  <span className="text-xs text-gray-400">正在生成图片...</span>
                </div>
              </div>
            )}
            {displayGeneratedImages && displayGeneratedImages.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {displayGeneratedImages.map((url, idx) => (
                  <MessageImage key={idx} src={url} alt="生成的图片" initialSize={imagePlaceholderSize} />
                ))}
              </div>
            )}
            {displayImageGenerateError && !displayImageGenerating && (
              <div className="mt-3 flex items-start gap-2 text-xs text-red-400 rounded-lg px-3 py-2.5 bg-red-950/30">
                <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap">图片生成失败：{displayImageGenerateError}</span>
              </div>
            )}

            {/* 用户停止生成的状态提示 */}
            {displayStoppedByUser && (
              <>
                {typeof displayContent === 'string' && displayContent.trim().length > 0 ? (
                  // 有内容：显示分割线
                  <div className="flex items-center justify-center my-4">
                    <span className="text-sm text-[var(--color-text-secondary)]">用户已停止</span>
                  </div>
                ) : (
                  // 无内容：显示请求已被取消的卡片
                  <div className="my-3 py-6 px-4 bg-[var(--color-bg-secondary)] rounded-3xl">
                    <div className="flex items-center gap-2 text-gray-400 mb-4">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" strokeWidth="2" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01" />
                      </svg>
                      <span className="text-sm">请求已被取消。</span>
                    </div>
                    <button
                      onClick={() => onRegenerate?.(message.id)}
                      className="w-full py-2.5 px-4 bg-[var(--color-bg-hover)] hover:bg-[var(--color-bg-elevated)] text-gray-200 rounded-full transition-colors text-sm font-medium"
                    >
                      立即重新生成
                    </button>
                  </div>
                )}
              </>
            )}

            {displayArtifact && (
              <div
                onClick={() => onOpenArtifact?.(displayArtifact)}
                className="mt-3 p-4 rounded-2xl cursor-pointer hover:brightness-110 transition-all flex items-center gap-3 relative overflow-hidden"
              >
                {/* 渐变背景层：顶部色/底部色由 --color-artifact-bg-top/bottom 按模式区分（暗色保持原始样式） */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: `linear-gradient(to bottom, var(--color-artifact-bg-top), var(--color-artifact-bg-bottom))`
                  }}
                />

                {/* 内容层 */}
                <div className="relative z-10 flex items-center gap-3 w-full">
                  <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                    {/* 浅色模式下由 .artifact-globe-icon 保持白色（深色模式回退原始 text-white） */}
                    <Globe className="artifact-globe-icon w-5 h-5 text-white" />
                  </div>
                  <div>
                    {/* 文字用原始类：深色模式白字/灰字；浅色模式由全局 text-white/text-gray-400 覆盖为深色文字 */}
                    <div className="text-white font-medium text-sm">{displayArtifact.title}</div>
                    <div className="text-gray-400 text-xs">点击预览</div>
                  </div>
                </div>
              </div>
            )}
            {showSuggestions &&
              displaySuggestions &&
              displaySuggestions.length > 0 &&
              !displayIsStreaming && (
                <div className="flex flex-wrap gap-2 mt-5">
                  {displaySuggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSuggestionClick?.(suggestion)}
                      className="text-sm px-4 py-2 bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/25 text-gray-200 rounded-full transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            {/* 消息操作按钮组 - 仅 AI 消息且非流式生成中 */}
            {!displayIsStreaming && !isStreaming && (
              <div className="mt-6 pt-6 border-t border-gray-700/30">
                {/* 多模型比较按钮 - 独立一行 */}
                {onCompareWithModel && (
                  <div className="mb-2">
                    <CompareButton
                      messageModelId={activeVersion?.model || message.model || ''}
                      usedModelIds={message.versions?.map(v => v.model) || (message.model ? [message.model] : [])}
                      onCompare={(modelId) => onCompareWithModel(message.id, modelId)}
                      disabled={isStreaming || displayIsStreaming || (message.versions?.some(v => v.isStreaming) ?? false)}
                    />
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {/* 复制 */}
                  <button
                    onClick={async () => {
                      const text = getPlainText(displayContent);
                      const success = await copyToClipboard(text);
                      if (success) {
                        setCopied(true);
                        setToastMessage('已复制到剪贴板');
                        setToastType('success');
                        setShowToast(true);
                        setTimeout(() => setCopied(false), 1500);
                      } else {
                        setToastMessage('复制失败，请重试');
                        setToastType('error');
                        setShowToast(true);
                      }
                    }}
                    className="p-2.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                    title="复制"
                  >
                    {copied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
                  </button>
                  {/* 保存为 Markdown（下载 .md 文件 + 存入我的库） */}
                  <button
                    onClick={handleSaveMarkdown}
                    className="p-2.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                    title="保存为 Markdown"
                  >
                    <FileDown className="w-5 h-5" />
                  </button>
                  {/* 重新生成 */}
                  {onRegenerate && (
                    <button
                      onClick={() => onRegenerate(message.id)}
                      className="p-2.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                      title="重新生成"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  )}
                  {/* 引用 */}
                  {onQuote && (
                    <button
                      onClick={() => onQuote(message)}
                      className="p-2.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                      title="引用"
                    >
                      <MessageSquareQuote className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        </div>

        {/* 长按上下文菜单：消息级操作（复制/保存/重新生成/引用，跟下方常驻按钮行保持一致）
            + 细分割线 + 全局操作（查找/折叠回复）
            用 portal 挂到 body：position:fixed 仍会被带 transform / overflow / filter
            的祖先当成包含块并裁剪（消息区是 overflow-y-auto，外层还有
            MainLayout 的 translateX），只有脱离整棵子树才彻底不受影响 */}
        {menuOpen && createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
            className="z-[200] w-52 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2 select-none context-menu-pop"
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          >
            <button
              onClick={async () => {
                setMenuOpen(false);
                const text = getPlainText(displayContent);
                const success = await copyToClipboard(text);
                setToastMessage(success ? '已复制到剪贴板' : '复制失败，请重试');
                setToastType(success ? 'success' : 'error');
                setShowToast(true);
              }}
              // iOS 长按手势结束后首次 tap 的合成 click 会被 WebKit 吞掉，
              // 菜单项用 pointerup 触发（不受抑制），onClick 保留给键盘兜底
              onPointerUp={async e => {
                if (e.button !== 0) return;
                setMenuOpen(false);
                const text = getPlainText(displayContent);
                const success = await copyToClipboard(text);
                setToastMessage(success ? '已复制到剪贴板' : '复制失败，请重试');
                setToastType(success ? 'success' : 'error');
                setShowToast(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
            >
              <Copy className="w-5 h-5 flex-shrink-0" />
              <span>复制</span>
            </button>
            {/* 生成图片的消息无纯文本可存，长按不提供「保存为 Markdown」 */}
            {!displayGeneratedImages?.length && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  handleSaveMarkdown();
                }}
                onPointerUp={e => {
                  if (e.button !== 0) return;
                  setMenuOpen(false);
                  handleSaveMarkdown();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
              >
                <FileDown className="w-5 h-5 flex-shrink-0" />
                <span>保存为 Markdown</span>
              </button>
            )}
            {onRegenerate && (
              <button
                onClick={() => { setMenuOpen(false); onRegenerate(message.id); }}
                onPointerUp={e => {
                  if (e.button !== 0) return;
                  setMenuOpen(false);
                  onRegenerate(message.id);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
              >
                <RefreshCw className="w-5 h-5 flex-shrink-0" />
                <span>重新生成</span>
              </button>
            )}
            {onQuote && (
              <button
                onClick={() => { setMenuOpen(false); onQuote(message); }}
                onPointerUp={e => {
                  if (e.button !== 0) return;
                  setMenuOpen(false);
                  onQuote(message);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
              >
                <MessageSquareQuote className="w-5 h-5 flex-shrink-0" />
                <span>引用</span>
              </button>
            )}

            {/* 细分割线：把上面消息级操作和下面全局操作分开 */}
            <div className="my-1 mx-2 border-t border-white/5" />

            <button
              onClick={() => { setMenuOpen(false); onOpenSearch?.(); }}
              onPointerUp={e => {
                if (e.button !== 0) return;
                setMenuOpen(false);
                onOpenSearch?.();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
            >
              <Search className="w-5 h-5 flex-shrink-0" />
              <span>查找</span>
            </button>
            {onFold && (
              <button
                onClick={() => { setMenuOpen(false); onFold(); }}
                onPointerUp={e => {
                  if (e.button !== 0) return;
                  setMenuOpen(false);
                  onFold();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
              >
                <FoldVertical className="w-5 h-5 flex-shrink-0" />
                <span>折叠回复</span>
              </button>
            )}
          </div>,
          document.body
        )}
      </div>
    </>
  );
}

// 虚拟化滚动时视口窗口频繁变化会带动整列表重渲染，
// memo 让 props 未变的消息（markdown / KaTeX / 代码高亮的重组件）跳过重渲染
export default memo(MessageBubble);
