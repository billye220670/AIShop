import { useState, useRef, useEffect, useMemo, memo, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Plus, Square, X, FileText, MessageSquareQuote, ArrowUp, Globe, Paperclip, SlidersHorizontal, SendHorizontal, Clock } from 'lucide-react';
import { Camera, MediaTypeSelection } from '@capacitor/camera';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { haptic } from '../../utils/haptics';
import { isNativeAndroid } from '../../platform/capabilities';
import type { MessageContent, FileAttachment, Message, ChatFeatureSettings, Model, ContextSegment, AssetItem } from '../../types';
import { parseFile, type ParsedFile } from '../../services/fileParser';
import { compressImageFile } from '../../utils/imageCompress';
import { useDeviceMode } from '../../platform/useDeviceMode';
import { useAssets } from '../../hooks/useAssets';
import ModelSelector from '../common/ModelSelector';
import RoleSelector from '../common/RoleSelector';
import BlobImage from '../common/BlobImage';
import type { RoleData } from '../../db';
import type { UsageTotals } from '../../utils/tokenEstimate';
import ContextRing from './ContextRing';
import ContextPanel from './ContextPanel';
import AttachmentSheet from './AttachmentSheet';
import LibraryPickerSheet from './LibraryPickerSheet';
import LibraryAtPanel from './LibraryAtPanel';
import PinyinMatch from 'pinyin-match';
import CustomSelect from '../common/CustomSelect';
import { settingsService } from '../../services/settingsService';
import { getImageModelsByApiProvider } from '../../config/models';
import { ATTACH_CHAT_IMAGE_EVENT } from '../../services/imageContextActions';

interface ChatInputProps {
  onSend: (content: string | MessageContent[], attachments?: FileAttachment[]) => void;
  isLoading: boolean;
  onStop: () => void;
  /** 历史记录面板开关（仅桌面形态使用：聊天控件按钮左侧的时钟按钮） */
  onToggleHistory?: () => void;
  onNewConversation?: () => void;
  quotedMessage?: Message | null;
  onRemoveQuote?: () => void;
  featureSettings: ChatFeatureSettings;
  onFeatureSettingsChange: (settings: ChatFeatureSettings) => void;
  webSearchEnabled?: boolean;
  onWebSearchEnabledChange?: (enabled: boolean) => void;
  /** 输入框进入/退出激活（展开）态时通知父组件 */
  onActiveChange?: (active: boolean) => void;
  // 模型与角色选择（仅桌面形态使用：工具栏左侧同款下拉选择器）
  models?: Model[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  roles?: RoleData[];
  selectedRoleId?: string;
  onRoleSelect?: (roleId: string) => void;
  onRolesChanged?: () => void;
  // 上下文占用环（桌面形态：位于聊天控件按钮左侧；数据与移动端顶栏同源）
  realUsage?: UsageTotals;
  contextLimit?: number;
  isCompacting?: boolean;
  isAwaitingUsage?: boolean;
  /** 会话 id：切换会话时重挂载环，避免沿用上一个会话的填充量 */
  conversationId?: string;
  segments?: ContextSegment[];
  onCompactActive?: () => void;
  onOpenSegment?: (segmentId: string) => void;
  onDeleteSegment?: (segmentId: string) => void;
  /** 已隐藏会话的 id 集合：@ 引用面板与 +号库面板据此过滤隐藏会话的产物 */
  hiddenConvIds?: Set<string>;
}

function ChatInput({
  onSend,
  isLoading,
  onStop,
  onToggleHistory,
  onNewConversation,
  quotedMessage,
  onRemoveQuote,
  featureSettings,
  onFeatureSettingsChange,
  webSearchEnabled = false,
  onWebSearchEnabledChange,
  onActiveChange,
  models,
  selectedModel,
  onModelChange,
  roles,
  selectedRoleId,
  onRoleSelect,
  onRolesChanged,
  realUsage,
  contextLimit,
  isCompacting,
  isAwaitingUsage,
  conversationId,
  segments,
  onCompactActive,
  onOpenSegment,
  onDeleteSegment,
  hiddenConvIds,
}: ChatInputProps) {
  // 上传限制常量提前到 useImage 事件监听之前声明，供附件面板与「修改图片」塞图统一使用
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  const MAX_TOTAL_FILES = 5;
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 最近一次经 @ 面板插入的引用位置：防止选中后紧跟的输入（如补空格）导致面板重新弹出
  const acceptedAtRef = useRef<{ atIndex: number; title: string } | null>(null);
  // 控制是否应该自动聚焦：用户主动聚焦时为 true，主动失焦时为 false
  const shouldFocusRef = useRef(false);
  // 桌面形态聊天控件面板（Artifact/联网搜索开关弹层）
  const [showFeaturePanel, setShowFeaturePanel] = useState(false);
  const featurePanelRef = useRef<HTMLDivElement>(null);
  const featureButtonRef = useRef<HTMLButtonElement>(null);
  // 上下文详情面板开关（桌面形态：点击工具栏环按钮上浮展开）
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  // 安卓端附件面板开关（+ 号按钮弹出底部选择：相册/拍摄/文件/库）
  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false);
  // 安卓端「库」选择面板开关（附件面板点「库」后切换出的更高面板）
  const [showLibrarySheet, setShowLibrarySheet] = useState(false);
  // ---- 聊天控件里的图片模型选择器（仅桌面形态渲染），与图片面板共享 localStorage 选中态 ----
  const [imageProvider, setImageProvider] = useState<string>('fastapi');
  const [imageModel, setImageModel] = useState<string>(() => {
    try {
      return localStorage.getItem('aishop_image_model') || '';
    } catch {
      return '';
    }
  });
  // PC 端 @ 引用「我的库」面板状态：open 时 atIndex 是 @ 在完整文本中的位置，query 是 @ 后的搜索词，
  // pos 是 @ 光标的像素坐标（viewport，面板 Portal 到 body 后 fixed 定位直接使用）
  const [atPanel, setAtPanel] = useState<{
    open: boolean;
    atIndex: number;
    query: string;
    selectedIndex: number;
    pos: { left: number; bottom: number } | null;
  }>({ open: false, atIndex: 0, query: '', selectedIndex: 0, pos: null });
  // @ 面板 DOM 引用：全局 mousedown 判断点击是否落在面板内
  const atPanelRef = useRef<HTMLDivElement>(null);

  // 「我的库」资产：附件面板选「库」时打开选择器，进入时 refresh 保证拿到最新数据
  const { assets: libraryAssets, refresh: refreshLibrary } = useAssets();
  // 过滤隐藏会话的产物：@ 引用面板与 +号库面板不展示隐藏会话的资产（与「我的库」开关关闭态一致）；
  // 无会话标记的历史资产不受影响
  const visibleLibraryAssets = useMemo(() => {
    if (!hiddenConvIds || hiddenConvIds.size === 0) return libraryAssets;
    return libraryAssets.filter(a => !(a.convId && hiddenConvIds.has(a.convId)));
  }, [libraryAssets, hiddenConvIds]);

  // 桌面形态：输入框呈现 electron 版两行结构（工具栏 + 圆角边框输入容器），功能逻辑与移动形态共用
  const desktop = useDeviceMode() === 'desktop';

  // 当前图片提供商下可选用的生图模型（聊天控件面板里的图片模型选择器用）
  const imageModels = useMemo(
    () => getImageModelsByApiProvider(imageProvider),
    [imageProvider]
  );

  // 挂载时读取图片提供商，并保证选中模型属于当前 provider：
  // 切到选不中的模型时回落为该 provider 的第一个模型（仅自动校正，不覆盖用户显式选择）。
  // 当前选中值从 localStorage 读（与 state 同源），避免依赖引入闭包。
  useEffect(() => {
    let cancelled = false;
    void settingsService.getProvider('image').then(p => {
      if (cancelled) return;
      setImageProvider(p);
      const list = getImageModelsByApiProvider(p);
      let current = '';
      try { current = localStorage.getItem('aishop_image_model') || ''; } catch { /* ignore */ }
      if (!current && imageModel) current = imageModel; // 首次挂载 fallback
      const valid = list.some(m => m.id === current);
      if (!valid && list.length > 0) {
        setImageModel(list[0].id);
        try { localStorage.setItem('aishop_image_model', list[0].id); } catch { /* ignore */ }
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在挂载时校正一次
  }, []);

  // 用户从选择器切换图片模型：写 localStorage，与图片面板（useImage）共享选中态
  const handleImageModelChange = (id: string) => {
    setImageModel(id);
    try { localStorage.setItem('aishop_image_model', id); } catch { /* ignore */ }
  };

  const hasContent = text.trim().length > 0 || images.length > 0 || files.length > 0 || !!quotedMessage;

  // 点击外部关闭聊天控件面板（仅桌面形态使用）
  useEffect(() => {
    if (!showFeaturePanel) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        featurePanelRef.current && !featurePanelRef.current.contains(e.target as Node) &&
        featureButtonRef.current && !featureButtonRef.current.contains(e.target as Node)
      ) {
        setShowFeaturePanel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFeaturePanel]);

  // @ 引用面板：全局 mousedown 关闭——点击面板自身或 textarea 内部保持（textarea 内继续输入过滤），
  // 点击输入框其他区域（工具栏/预览区/发送按钮）或页面任意处均关闭；
  // onBlur 只在焦点迁移时触发，点击不可聚焦元素不会失焦，因此必须用全局 mousedown 兜底
  useEffect(() => {
    if (!atPanel.open) return;
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (atPanelRef.current?.contains(t)) return;
      if (textareaRef.current?.contains(t)) return;
      setAtPanel(prev => (prev.open ? { ...prev, open: false } : prev));
    };
    document.addEventListener('mousedown', handleGlobalMouseDown);
    return () => document.removeEventListener('mousedown', handleGlobalMouseDown);
  }, [atPanel.open]);

  // 点击面板外部关闭上下文面板（仅桌面形态使用）
  useEffect(() => {
    if (!contextPanelOpen) return;
    const close = () => setContextPanelOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextPanelOpen]);

  // Esc 关闭上下文面板
  useEffect(() => {
    if (!contextPanelOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setContextPanelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [contextPanelOpen]);

  // 布局切换到展开态后自动聚焦 textarea，确保键盘弹出
  useEffect(() => {
    if (shouldFocusRef.current && (isFocused || hasContent) && textareaRef.current) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [isFocused, hasContent]);

  // 激活态（展开布局）同步给父组件，用于隐藏”回到底部”按钮等
  useEffect(() => {
    onActiveChange?.(isFocused || hasContent);
  }, [isFocused, hasContent, onActiveChange]);

  // 图片上下文菜单「修改图片」：把图片塞进输入框预览区并聚焦，等用户补充修改文字后发送。
  // 限制最多 MAX_TOTAL_FILES 张（与手动上传一致），自动聚焦让用户接着输入。
  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      if (!url) return;
      setImages(prev => {
        if (prev.length + files.length >= MAX_TOTAL_FILES) return prev;
        return prev.includes(url) ? prev : [...prev, url];
      });
      // 展开输入框并聚焦，键盘弹起
      shouldFocusRef.current = true;
      setIsFocused(true);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener(ATTACH_CHAT_IMAGE_EVENT, handler);
    return () => window.removeEventListener(ATTACH_CHAT_IMAGE_EVENT, handler);
  }, [files]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  const handleSubmit = () => {
    const trimmedText = text.trim();
    if (!trimmedText && images.length === 0 && files.length === 0) return;
    if (isLoading) return;

    // 构建 attachments 元数据
    const attachments: FileAttachment[] = files.map(f => ({
      name: f.name,
      size: f.size,
      textContent: f.textContent,
      truncated: f.truncated,
    }));

    // 拼接引用内容：生图消息引用的是图片本身——图片走图片通道发给模型（模型可见），
    // 文本只留占位说明；普通消息引用拼接 > 引用文本
    let finalText = trimmedText;
    const quotedImageUrls = quotedMessage?.generatedImages ?? [];
    if (quotedMessage) {
      if (quotedImageUrls.length > 0) {
        finalText = `> [引用图片]\n\n${trimmedText}`;
      } else {
        const quoteContent = typeof quotedMessage.content === 'string'
          ? quotedMessage.content
          : (quotedMessage.content as MessageContent[]).filter(p => p.type === 'text').map(p => p.text).join('\n');
        finalText = `> ${quoteContent.slice(0, 200).replace(/\n/g, '\n> ')}\n\n${trimmedText}`;
      }
      onRemoveQuote?.();
    }

    // 兜底解析：文本中手动输入的 @标题 命中库资产 → 内容进附件（图片进图片通道）；
    // 通过 @ 面板选中的资产已走附件通道（files/images），文本不再含 @，不会重复附加
    const allImages = [...images, ...quotedImageUrls];
    const allAttachments = [...attachments];
    if (trimmedText.includes('@')) {
      const refTitles = new Set<string>();
      for (const asset of libraryAssets) {
        const token = `@${asset.title}`;
        if (refTitles.has(asset.title) || !trimmedText.includes(token)) continue;
        refTitles.add(asset.title);
        if (asset.kind === 'image') {
          const url = asset.urls?.[0];
          if (url) allImages.push(url);
          continue;
        }
        const content = asset.kind === 'markdown' ? (asset.content ?? '') : (asset.artifact?.code ?? '');
        const ext = asset.kind === 'markdown' ? 'md' : 'html';
        const safeName = asset.title.replace(/[/\\?%*:|"<>]/g, ' ').trim() || `库内容_${asset.id.slice(0, 6)}`;
        allAttachments.push({ name: `${safeName}.${ext}`, size: content.length, textContent: content, truncated: false });
      }
    }

    if (allImages.length > 0) {
      const content: MessageContent[] = [];
      content.push({ type: 'text', text: finalText || '' });
      allImages.forEach(img => {
        content.push({ type: 'image_url', image_url: { url: img } });
      });
      onSend(content, allAttachments.length > 0 ? allAttachments : undefined);
    } else {
      onSend(finalText, allAttachments.length > 0 ? allAttachments : undefined);
    }

    setText('');
    setImages([]);
    setFiles([]);
    closeAtPanel();
    // 发送后立即失焦，关闭键盘
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    shouldFocusRef.current = false;
    setIsFocused(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.blur();
    }
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    // 输入时按光标位置同步 @ 引用面板（过滤/自动关闭）
    updateAtPanel(value, e.target.selectionStart ?? value.length);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  // 光标纯移动（方向键/点击）时同步 @ 引用面板；
  // 注意读 DOM 实时值而非 text state：onChange 后紧接着的 onSelect 里 state 尚未刷新
  const handleSelect = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.target as HTMLTextAreaElement;
    updateAtPanel(el.value, el.selectionStart ?? el.value.length);
  };

  // ---- @ 引用「我的库」面板逻辑（PC 端，仿 AI IDE 输入框） ----

  // 按标题过滤库资产，最多展示 8 项；支持拼音/拼音首字母匹配中文标题（与侧边栏会话搜索同款方案）
  const filterAtAssets = (query: string): AssetItem[] => {
    const q = query.trim().toLowerCase();
    return visibleLibraryAssets
      .filter(a => {
        if (!q) return true;
        if (a.title.toLowerCase().includes(q)) return true;
        return PinyinMatch.match(a.title, q) !== false;
      })
      .slice(0, 8);
  };

  const closeAtPanel = () => setAtPanel(prev => (prev.open ? { ...prev, open: false } : prev));

  // 用不可见的镜像节点复刻 textarea 排版，并定位到 textarea 所在位置，
  // 算出光标相对 textarea 边框的像素坐标（已含 padding、已扣滚动），供 @ 面板跟随定位
  const getCaretPosition = (el: HTMLTextAreaElement): { left: number; top: number } | null => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const mirror = document.createElement('div');
    mirror.style.cssText = [
      'position:absolute',
      'visibility:hidden',
      'pointer-events:none',
      'white-space:pre-wrap',
      'word-break:break-word',
      'overflow-wrap:break-word',
      `font:${style.font}`,
      `line-height:${style.lineHeight}`,
      `padding:${style.padding}`,
      `border:${style.border}`,
      `width:${style.width}`,
      'box-sizing:border-box',
      `top:${rect.top + window.scrollY}px`,
      `left:${rect.left + window.scrollX}px`,
    ].join(';');
    const caret = el.selectionStart ?? el.value.length;
    const span = document.createElement('span');
    span.textContent = '\u200b';
    mirror.appendChild(document.createTextNode(el.value.slice(0, caret)));
    mirror.appendChild(span);
    document.body.appendChild(mirror);
    const left = span.offsetLeft;
    const top = span.offsetTop - el.scrollTop;
    document.body.removeChild(mirror);
    return { left, top };
  };

  // 检测光标前最后一个 @ 是否构成引用触发：@ 前必须是开头或非字母数字（避免邮箱等误触发，
  // 中文后直接打 @ 也能弹出面板），query 为 @ 后到光标前的文本；过滤后无结果 → 面板自动关闭
  const updateAtPanel = (value: string, caret: number) => {
    if (!desktop) return;
    const before = value.slice(0, caret);
    const lastAt = before.lastIndexOf('@');
    if (lastAt === -1) {
      closeAtPanel();
      return;
    }
    const prev = lastAt > 0 ? before[lastAt - 1] : '';
    if (prev && /\w/.test(prev)) {
      closeAtPanel();
      return;
    }
    const query = before.slice(lastAt + 1);
    if (query.includes('\n')) {
      closeAtPanel();
      return;
    }
    // 刚插入的引用后紧跟的输入（如补个空格）不再重新弹面板，其他改动走正常过滤
    const acc = acceptedAtRef.current;
    if (acc && lastAt === acc.atIndex && (query === acc.title || query === `${acc.title} `)) {
      closeAtPanel();
      return;
    }
    if (visibleLibraryAssets.length === 0 || filterAtAssets(query).length === 0) {
      closeAtPanel();
      return;
    }
    // 计算 @ 光标像素位置（viewport 坐标，面板 Portal 到 body 后 fixed 定位直接使用）：
    // 面板始终在 @ 正上方 overlay 弹出（输入框位于窗口底部，上方聊天区空间充足）
    const ta = textareaRef.current;
    let pos: { left: number; bottom: number } | null = null;
    if (ta) {
      const p = getCaretPosition(ta);
      if (p) {
        const taRect = ta.getBoundingClientRect();
        const gap = 8;
        pos = { left: taRect.left + p.left, bottom: window.innerHeight - (taRect.top + p.top) + gap };
      }
    }
    setAtPanel(prev => {
      // 同一触发点输入变化时保留选中索引（夹紧），新触发点从第一项开始
      const selectedIndex = prev.open && prev.atIndex === lastAt && prev.query === query
        ? Math.min(prev.selectedIndex, filterAtAssets(query).length - 1)
        : 0;
      return { open: true, atIndex: lastAt, query, selectedIndex, pos };
    });
  };

  // 确认选中：删除文本中的 @query 引用标记，资产内容进附件/图片通道，
  // 与导入「我的库」同一形态——输入框上方预览区显示 chip，可单独移除
  const acceptAtAsset = (asset: AssetItem) => {
    const el = textareaRef.current;
    if (!el) {
      closeAtPanel();
      return;
    }
    const caret = el.selectionStart ?? text.length;
    const atIdx = text.slice(0, caret).lastIndexOf('@');
    if (atIdx === -1) {
      closeAtPanel();
      return;
    }
    // 1) 移除文本中的 @query（内容改由下方附件通道携带，发送时不重复附加）
    const newText = text.slice(0, atIdx) + text.slice(caret);
    setText(newText);
    // 2) 资产进对应通道：图片 → 图片 chip；md/artifact → 附件 chip（完整内容不截断）；
    //    同一资产不允许重复添加（图片按 url、附件按文件名去重，函数式更新避免闭包过期）
    if (asset.kind === 'image') {
      const url = asset.urls?.[0];
      if (url) setImages(prev => (prev.includes(url) ? prev : [...prev, url]));
    } else {
      const content = asset.kind === 'markdown' ? (asset.content ?? '') : (asset.artifact?.code ?? '');
      const ext = asset.kind === 'markdown' ? 'md' : 'html';
      const safeName = asset.title.replace(/[/\\?%*:|"<>]/g, ' ').trim() || `库内容_${asset.id.slice(0, 6)}`;
      const name = `${safeName}.${ext}`;
      setFiles(prev => (prev.some(f => f.name === name) ? prev : [...prev, { name, size: content.length, textContent: content, truncated: false }]));
    }
    acceptedAtRef.current = null;
    closeAtPanel();
    // 光标移到删除点，恢复聚焦并重算高度
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(atIdx, atIdx);
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    });
  };

  // 鼠标悬停同步键盘选中项
  const handleAtHover = (index: number) => {
    setAtPanel(prev => (prev.open ? { ...prev, selectedIndex: index } : prev));
  };

  // Enter 发送（仅桌面形态，electron 版同款交互）；@ 面板打开时 ↑↓/Enter/Esc 接管选择
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (atPanel.open) {
      const items = filterAtAssets(atPanel.query);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAtPanel(prev => ({ ...prev, selectedIndex: Math.min(prev.selectedIndex + 1, items.length - 1) }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAtPanel(prev => ({ ...prev, selectedIndex: Math.max(prev.selectedIndex - 1, 0) }));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const asset = items[atPanel.selectedIndex];
        if (asset) acceptAtAsset(asset);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAtPanel();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          // 粘贴的截图压缩后再入列：避免大图 base64 撑大请求体与 IndexedDB
          const base64 = await compressImageFile(file);
          setImages(prev => [...prev, base64]);
        }
      }
    }
  };

  const isImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  };

  // 共用文件处理逻辑
  const processFiles = async (fileList: File[]) => {
    for (const file of fileList) {
      // 大小限制
      if (file.size > MAX_FILE_SIZE) {
        alert(`文件 "${file.name}" 超过 20MB 限制`);
        continue;
      }
      // 总数限制
      const currentTotal = images.length + files.length;
      if (currentTotal >= MAX_TOTAL_FILES) {
        alert(`最多只能添加 ${MAX_TOTAL_FILES} 个文件（图片+文档合计）`);
        break;
      }

      if (isImageFile(file)) {
        // 压缩后再入列：发送、落盘、云同步都拿小图，弱网下不再撑爆请求体
        const base64 = await compressImageFile(file);
        setImages(prev => [...prev, base64]);
      } else {
        try {
          const parsed = await parseFile(file);
          setFiles(prev => [...prev, parsed]);
        } catch (err) {
          alert(`文件解析失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      }
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;
    await processFiles(Array.from(selectedFiles));
    e.target.value = '';
  };

  // ---- 安卓端原生附件能力（仅 isNativeAndroid 时调用，web/Electron 不触发） ----

  // 原生返回的 webPath（blob: URL）转 File，走 web 同款压缩/解析流程
  const webPathToFile = async (webPath: string, name: string): Promise<File | null> => {
    try {
      const resp = await fetch(webPath);
      const blob = await resp.blob();
      if (!blob.size) return null;
      return new File([blob], name, { type: blob.type || 'image/jpeg' });
    } catch {
      return null;
    }
  };

  // 文件选择器 readData 的 base64 结果转 File
  const base64ToFile = (base64: string, name: string, type: string): File => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name, { type });
  };

  // 相册：系统 Photo Picker（Android 13+ 原生多选）
  const handleNativeGallery = async () => {
    try {
      const result = await Camera.chooseFromGallery({
        mediaType: MediaTypeSelection.Photo,
        allowMultipleSelection: true,
        limit: Math.max(1, MAX_TOTAL_FILES - images.length - files.length),
        quality: 85,
      });
      const fileList: File[] = [];
      for (const [i, media] of result.results.entries()) {
        if (!media.webPath) continue;
        const file = await webPathToFile(media.webPath, `photo_${Date.now()}_${i}.jpg`);
        if (file) fileList.push(file);
      }
      if (fileList.length > 0) await processFiles(fileList);
    } catch {
      // 用户取消选择，静默忽略
    }
  };

  // 拍摄：系统相机
  const handleNativeCamera = async () => {
    try {
      const media = await Camera.takePhoto({ quality: 85, saveToGallery: false });
      if (!media.webPath) return;
      const file = await webPathToFile(media.webPath, `camera_${Date.now()}.jpg`);
      if (file) await processFiles([file]);
    } catch {
      // 用户取消拍照，静默忽略
    }
  };

  // 文件：系统文件选择器（SAF，无权限要求）
  const handleNativeFiles = async () => {
    try {
      const result = await FilePicker.pickFiles({ readData: true });
      const fileList: File[] = [];
      for (const picked of result.files) {
        if (!picked.data) continue;
        fileList.push(base64ToFile(picked.data, picked.name, picked.mimeType || 'application/octet-stream'));
      }
      if (fileList.length > 0) await processFiles(fileList);
    } catch {
      // 用户取消选择，静默忽略
    }
  };

  // 附件面板「库」：先收起矮面板（等关闭动画播完）再弹出更高的库选择面板；
  // 点击瞬间就刷新资产，利用关闭动画的 300ms 让数据先加载完，打开时不闪空状态
  const handlePickLibrary = () => {
    setShowAttachmentSheet(false);
    refreshLibrary();
    setTimeout(() => {
      setShowLibrarySheet(true);
    }, 300); // 与 BottomSheet 关闭动画时长一致
  };

  // 库选择确认：图片进 images（blob 引用发送时自动内联），文档/应用转成 ParsedFile 进 files，
  // 与系统文件选择共用同一套附件形态与数量限制
  const handleLibraryConfirm = (selected: AssetItem[]) => {
    const remaining = MAX_TOTAL_FILES - images.length - files.length;
    if (selected.length > remaining) {
      alert(`最多只能添加 ${MAX_TOTAL_FILES} 个文件（图片+文档合计），超出部分已忽略`);
    }
    let added = 0;
    for (const item of selected) {
      if (added >= remaining) break;
      if (item.kind === 'image') {
        const url = item.urls?.[0];
        if (!url) continue;
        setImages(prev => [...prev, url]);
        added++;
        continue;
      }
      const content = item.kind === 'markdown' ? (item.content ?? '') : (item.artifact?.code ?? '');
      const ext = item.kind === 'markdown' ? 'md' : 'html';
      const safeName = item.title.replace(/[/\\?%*:|"<>]/g, ' ').trim() || `库内容_${item.id.slice(0, 6)}`;
      // 库内容完整上传：用户显式选择的资产不截断，保证模型拿到完整内容
      setFiles(prev => [...prev, { name: `${safeName}.${ext}`, size: content.length, textContent: content, truncated: false }]);
      added++;
    }
    setShowLibrarySheet(false);
  };

  // + 号按钮统一入口：安卓端先收起键盘/恢复输入框位置，再弹底部附件面板；其余平台沿用 web 文件选择
  const handlePlusClick = () => {
    haptic();
    if (isNativeAndroid()) {
      // 输入框激活被键盘顶起时：先失焦收起键盘、恢复输入框位置，再弹出附件面板
      if (textareaRef.current) {
        textareaRef.current.blur();
      }
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      shouldFocusRef.current = false;
      setIsFocused(false);
      setShowAttachmentSheet(true);
    } else {
      fileInputRef.current?.click();
    }
  };

  // 拖拽上传
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    const allowedExts = ['txt', 'md', 'pdf', 'csv', 'json', 'doc', 'docx', 'pptx', 'ppt', 'rtf', 'odt', 'odp', 'ods', 'xlsx', 'xls'];
    const validFiles = Array.from(droppedFiles).filter(file => {
      if (file.type.startsWith('image/')) return true;
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      return allowedExts.includes(ext);
    });

    if (validFiles.length === 0) {
      alert('不支持的文件格式');
      return;
    }

    await processFiles(validFiles);
  };

  const handleFocus = () => {
    if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
    shouldFocusRef.current = true;
    setIsFocused(true);
  };

  const handleBlur = () => {
    // 延迟重置，确保发送按钮等点击事件能正常触发
    shouldFocusRef.current = false;
    closeAtPanel();
    blurTimerRef.current = setTimeout(() => setIsFocused(false), 150);
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 桌面形态：electron 版两行结构（工具栏 + 圆角边框输入容器）；历史按钮已由圆圈进度环替代，环与聊天控件同处工具栏右侧
  if (desktop) {
    // 上下文环仅在有用量数据时显示（与移动端 TopNavBar 一致）
    const showRing = Boolean(realUsage && contextLimit);
    return (
      <div
        className={`bg-transparent p-4 relative transition-all ${isDragging ? 'ring-2 ring-[var(--color-accent)] bg-[var(--color-accent)]/5 rounded-xl' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 共用的文件 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.pdf,.csv,.json,.doc,.docx,.pptx,.ppt,.rtf,.odt,.odp,.ods,.xlsx,.xls,image/*"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />

        {/* 拖拽遮罩提示 */}
        {isDragging && (
          <div className="absolute inset-0 bg-[var(--color-accent)]/10 border-2 border-dashed border-[var(--color-accent)] rounded-xl flex items-center justify-center z-40 pointer-events-none">
            <div className="text-[var(--color-accent)] text-sm font-medium px-4 py-2 bg-gray-900/80 rounded-lg shadow-lg">
              拖放文件到此处上传
            </div>
          </div>
        )}

        <div>
          {/* Row 1: 工具栏 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {/* 模型选择器（electron 同款位置：工具栏最左，非 compact 下拉形态） */}
              {models && models.length > 0 && selectedModel && onModelChange && (
                <ModelSelector
                  models={models}
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
                />
              )}
              {/* 角色选择器（与模型选择器同款，放其右侧） */}
              <RoleSelector
                roles={roles}
                selectedRoleId={selectedRoleId}
                onRoleSelect={onRoleSelect}
                onRolesChanged={onRolesChanged}
                selectedModel={selectedModel}
              />
              {/* 上传 */}
              <button
                onClick={() => { haptic(); fileInputRef.current?.click(); }}
                className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-[var(--color-bg-hover)]"
                title="上传图片"
              >
                <Paperclip className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {/* 上下文占用环（web 同款圆圈进度按钮，位于聊天控件左侧） */}
              {showRing && (
                <div
                  onClick={e => e.stopPropagation()}
                  onPointerDown={e => e.stopPropagation()}
                  // 面板展开时把环提到遮罩之上，保持清晰
                  className={contextPanelOpen ? 'relative z-[201]' : undefined}
                >
                  <ContextRing
                    // 按会话重挂载，避免切换时沿用上一个会话的填充量
                    key={conversationId}
                    realUsage={realUsage!}
                    contextLimit={contextLimit!}
                    isCompacting={isCompacting ?? false}
                    isAwaitingUsage={isAwaitingUsage ?? false}
                    isOpen={contextPanelOpen}
                    onClick={() => setContextPanelOpen(v => !v)}
                  />
                </div>
              )}
              {/* 历史记录（electron 同款位置：聊天控件按钮左侧，点击右侧滑出历史面板） */}
              <button
                onClick={() => onToggleHistory?.()}
                className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-[var(--color-bg-hover)]"
                title="会话历史"
              >
                <Clock className="w-5 h-5" />
              </button>
              {/* 聊天控件（Artifact / 联网搜索开关） */}
              <div className="relative">
                <button
                  ref={featureButtonRef}
                  onClick={() => { haptic(); setShowFeaturePanel(prev => !prev); }}
                  className={`p-2 transition-colors rounded-lg hover:bg-[var(--color-bg-hover)] ${
                    showFeaturePanel ? 'text-[var(--color-accent)]' : 'text-gray-400 hover:text-white'
                  }`}
                  title="聊天控件"
                >
                  <SlidersHorizontal className="w-5 h-5" />
                </button>

                {/* 聊天控件面板 */}
                {showFeaturePanel && (
                  <div
                    ref={featurePanelRef}
                    className="absolute bottom-full right-0 mb-2 w-64 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-xl p-4 shadow-2xl z-50"
                  >
                    <div className="text-[var(--color-text-primary)] font-medium text-sm mb-3">聊天控件</div>
                    {/* 图片生成模型选择器：列出当前图片提供商支持的全部生图模型，选中态与图片面板共享 */}
                    <div className="mb-3">
                      <div className="text-gray-500 text-xs mb-1.5">图片生成</div>
                      {imageModels.length > 0 ? (
                        <CustomSelect
                          value={imageModel}
                          onChange={handleImageModelChange}
                          options={imageModels.map(m => ({ value: m.id, label: m.name }))}
                          className="!py-2 !px-3"
                        />
                      ) : (
                        <div className="text-xs text-gray-500 py-1.5">当前图片提供商暂无可用模型</div>
                      )}
                    </div>
                    <div className="text-gray-500 text-xs mb-2">功能</div>
                    {/* Artifact 开关 */}
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-gray-200 text-sm">Artifacts</span>
                      <button
                        onClick={() => { haptic(); onFeatureSettingsChange({ ...featureSettings, artifactEnabled: !featureSettings.artifactEnabled }); }}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                          featureSettings.artifactEnabled ? 'bg-[var(--color-accent)]' : 'bg-gray-600'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                            featureSettings.artifactEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                    {/* 联网搜索开关 */}
                    <div className="flex items-center justify-between py-1.5 mt-1">
                      <span className="text-gray-200 text-sm">联网搜索</span>
                      <button
                        onClick={() => { haptic(); onWebSearchEnabledChange?.(!webSearchEnabled); }}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                          webSearchEnabled ? 'bg-[var(--color-accent)]' : 'bg-gray-600'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                            webSearchEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 新建会话 */}
              <button
                onClick={() => onNewConversation?.()}
                className="w-7 h-7 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-accent-foreground)] rounded-full flex items-center justify-center transition-colors"
                title="新建会话"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 虚焦遮罩：点击任意处关闭上下文面板 */}
          {contextPanelOpen && showRing && (
            <div
              className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay"
              onClick={() => setContextPanelOpen(false)}
              onPointerDown={() => setContextPanelOpen(false)}
            />
          )}

          {/* 上下文详情面板：从工具栏上方上浮 */}
          {contextPanelOpen && showRing && (
            <ContextPanel
              realUsage={realUsage!}
              contextLimit={contextLimit!}
              isCompacting={isCompacting ?? false}
              isAwaitingUsage={isAwaitingUsage ?? false}
              onCompact={() => {
                onCompactActive?.();
                setContextPanelOpen(false);
              }}
              segments={segments}
              onOpenSegment={segmentId => {
                onOpenSegment?.(segmentId);
                setContextPanelOpen(false);
              }}
              onDeleteSegment={onDeleteSegment}
              positionClassName="absolute right-4 bottom-full mb-2 w-80"
            />
          )}

          {/* Row 2: 输入容器 */}
          <div className="rounded-xl border border-[var(--color-border)] focus-within:border-[var(--color-accent)] transition-colors overflow-hidden">
            {/* 引用消息缩略图 */}
            {quotedMessage && (
              <div className="p-3 pb-2">
                <div className="flex items-center gap-2 bg-[var(--color-bg-primary)] border border-gray-700 rounded-lg px-3 py-2">
                  {/* 生图消息引用的是图片本身：显示缩略图；普通消息显示引用图标 */}
                  {quotedMessage.generatedImages?.length ? (
                    <BlobImage src={quotedMessage.generatedImages[0]} alt="引用图片" className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-md bg-[var(--color-accent-soft)] flex items-center justify-center flex-shrink-0">
                      <MessageSquareQuote className="w-4 h-4 text-[var(--color-accent)]" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-200 truncate">引用消息</div>
                    <div className="text-xs text-gray-500 truncate">
                      {quotedMessage.generatedImages?.length
                        ? '[图片]'
                        : (typeof quotedMessage.content === 'string'
                            ? quotedMessage.content.slice(0, 30)
                            : (quotedMessage.content as MessageContent[]).filter(p => p.type === 'text').map(p => p.text).join('').slice(0, 30)
                          )
                      }
                    </div>
                  </div>
                  <button onClick={() => onRemoveQuote?.()} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* 预览区 */}
            {(images.length > 0 || files.length > 0) && (
              <>
                <div className="flex gap-2 p-3 pb-2 overflow-x-auto [&::-webkit-scrollbar]:h-[2px]">
                  {images.map((img, idx) => (
                    <div key={`img-${idx}`} className="relative group shrink-0">
                      <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg" draggable={false} />
                      <button
                        onClick={() => removeImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center transition-colors"
                        title="移除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {files.map((file, idx) => (
                    <div key={`file-${idx}`} className="relative group shrink-0 min-w-[200px] max-w-[280px]">
                      <div className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg">
                        <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-[var(--color-accent-soft)]">
                          <FileText className="w-5 h-5 text-[var(--color-accent)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-200 font-medium truncate">{file.name}</div>
                          <div className="text-xs text-gray-500">File · {formatFileSize(file.size)}{file.truncated ? ' · 已截断' : ''}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeFile(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-red-500 text-white rounded-full transition-colors"
                        title="移除"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-700/60 mx-3" />
              </>
            )}

            {/* Textarea + 发送/停止 */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                onSelect={handleSelect}
                onPaste={handlePaste}
                placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
                className="w-full bg-transparent text-white px-4 py-3.5 pr-14 resize-none placeholder-gray-500 max-h-[200px] min-h-[80px] focus:outline-none"
                rows={3}
              />
              <div className="absolute right-3 bottom-3">
                {isLoading ? (
                  <button
                    onClick={onStop}
                    className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors"
                    title="停止生成"
                  >
                    <Square className="w-4 h-4" fill="currentColor" strokeWidth={0} />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={!text.trim() && images.length === 0 && files.length === 0}
                    className="p-2 text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] disabled:text-gray-500 transition-colors"
                    title="发送"
                  >
                    <SendHorizontal className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* @ 引用「我的库」上浮面板：固定宽度，始终在 @ 光标正上方 overlay 弹出，随输入实时过滤，无匹配自动关闭 */}
              {atPanel.open && atPanel.pos && filterAtAssets(atPanel.query).length > 0 && (
                <LibraryAtPanel
                  items={filterAtAssets(atPanel.query)}
                  selectedIndex={atPanel.selectedIndex}
                  onSelect={acceptAtAsset}
                  onHover={handleAtHover}
                  panelRef={atPanelRef}
                  position={atPanel.pos}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-transparent relative transition-all ${isDragging ? 'ring-2 ring-[var(--color-accent)] bg-[var(--color-accent)]/5 rounded-xl' : ''} ${isFocused ? '!p-0' : 'p-4'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 共用的文件 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.pdf,.csv,.json,.doc,.docx,.pptx,.ppt,.rtf,.odt,.odp,.ods,.xlsx,.xls,image/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* 拖拽遮罩提示 */}
      {isDragging && (
        <div className="absolute inset-0 bg-[var(--color-accent)]/10 border-2 border-dashed border-[var(--color-accent)] rounded-xl flex items-center justify-center z-40 pointer-events-none">
          <div className="text-[var(--color-accent)] text-sm font-medium px-4 py-2 bg-gray-900/80 rounded-lg shadow-lg">
            拖放文件到此处上传
          </div>
        </div>
      )}

      {/* Row 2: Input container with preview + textarea */}
        <div className={`transition-colors overflow-hidden bg-[var(--color-bg-primary)] ${isDragging ? 'ring-2 ring-[var(--color-accent)]' : ''} ${isFocused ? 'rounded-t-2xl' : (hasContent ? 'rounded-2xl' : 'rounded-full')}`}>
          {/* 引用消息缩略图 */}
          {quotedMessage && (
            <div className="p-3 pb-2">
              <div className="flex items-center gap-2 bg-[var(--color-bg-button)]/80 rounded-full px-3 py-2 max-w-md">
                {/* 生图消息引用的是图片本身：显示缩略图；普通消息显示引用图标 */}
                {quotedMessage.generatedImages?.length ? (
                  <BlobImage src={quotedMessage.generatedImages[0]} alt="引用图片" className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-md bg-[var(--color-accent-soft)] flex items-center justify-center flex-shrink-0">
                    <MessageSquareQuote className="w-4 h-4 text-[var(--color-accent)]" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 truncate">引用消息</div>
                  <div className="text-xs text-gray-500 truncate">
                    {quotedMessage.generatedImages?.length
                      ? '[图片]'
                      : (typeof quotedMessage.content === 'string'
                          ? quotedMessage.content.slice(0, 30)
                          : (quotedMessage.content as MessageContent[]).filter(p => p.type === 'text').map(p => p.text).join('').slice(0, 30)
                        )
                    }
                  </div>
                </div>
                <button onClick={() => onRemoveQuote?.()} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          {/* Desktop: unified preview area */}
          {(images.length > 0 || files.length > 0) && (
            <>
              <div className="flex gap-3 p-3 pb-2 overflow-x-auto [&::-webkit-scrollbar]:h-[2px]">
                {images.map((img, idx) => (
                  <div key={`img-${idx}`} className="relative shrink-0">
                    <BlobImage src={img} alt="" className="w-[4.5rem] h-[4.5rem] object-cover rounded-2xl" draggable={false} />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 w-5 h-5 bg-gray-600/80 hover:bg-gray-500 text-white rounded-full flex items-center justify-center"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
                {files.map((file, idx) => (
                  <div key={`file-${idx}`} className="relative group shrink-0 min-w-[200px] max-w-[280px]">
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg">
                      <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-[var(--color-accent-soft)]">
                        <FileText className="w-5 h-5 text-[var(--color-accent)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-200 font-medium truncate">{file.name}</div>
                        <div className="text-xs text-gray-500">File · {formatFileSize(file.size)}{file.truncated ? ' · 已截断' : ''}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-red-500 text-white rounded-full transition-colors"
                      title="移除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {/* Textarea */}
          {(isFocused || hasContent) ? (
            <div className="relative flex flex-col">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                onPaste={handlePaste}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder="询问任何问题..."
                className="w-full bg-transparent text-white px-4 py-4 resize-none placeholder-gray-500 max-h-[200px] min-h-[64px] focus:outline-none"
                rows={2}
              />
              <div className="flex items-center justify-between px-2 pb-3">
                <div className="flex items-center gap-1">
                  {/* + 按钮 */}
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handlePlusClick}
                    className="px-2 py-2 text-gray-400 hover:text-white transition-colors"
                    title="上传文件"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  {/* 联网搜索开关 */}
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { haptic(); onWebSearchEnabledChange?.(!webSearchEnabled); }}
                    className={`p-2 rounded-full transition-colors ${
                      webSearchEnabled ? 'bg-[var(--color-accent)]' : 'hover:bg-[var(--color-bg-hover)]'
                    }`}
                    title="全网搜索"
                  >
                    <Globe
                      className={`w-5 h-5 ${webSearchEnabled ? '' : 'text-gray-400'}`}
                      style={webSearchEnabled ? { color: 'var(--color-accent-foreground)' } : undefined}
                    />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {/* Send button */}
                  {!isLoading && (
                    <button
                      onClick={handleSubmit}
                      disabled={!hasContent}
                      className={`p-1.5 rounded-full transition-colors ${hasContent ? 'hover:opacity-90 cursor-pointer' : 'cursor-not-allowed'}`}
                      style={{ backgroundColor: hasContent ? 'var(--color-accent)' : 'var(--color-bg-button)' }}
                      title="发送"
                    >
                      <ArrowUp className={`w-4 h-4 ${hasContent ? 'text-black' : 'text-gray-400'}`} strokeWidth={2.5} />
                    </button>
                  )}
                  {/* Stop button */}
                  {isLoading && (
                    <button
                      onClick={onStop}
                      className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors"
                      title="停止生成"
                    >
                      <Square className="w-4 h-4" fill="currentColor" strokeWidth={0} />
                    </button>
                  )}
                </div>
              </div>
              {/* 底部渐隐 */}
              {isFocused && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
                  style={{
                    background: 'linear-gradient(to bottom, transparent, var(--color-bg-base))',
                  }}
                />
              )}
            </div>
          ) : (
            <div className="relative flex items-start">
              {/* + 按钮 */}
              <button
                onClick={handlePlusClick}
                className="pl-4 pr-2 text-gray-400 hover:text-white transition-colors"
                style={{ paddingTop: '14px', paddingBottom: '14px' }}
                title="上传文件"
              >
                <Plus className="w-5 h-5" />
              </button>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                onPaste={handlePaste}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder="询问任何问题..."
                className="flex-1 bg-transparent text-white pr-4 py-3 resize-none placeholder-gray-500 max-h-[200px] min-h-[48px] focus:outline-none"
                rows={1}
              />
              {/* Send button */}
              {!isLoading && (
                <div className="pr-3 py-3">
                  <button
                    onClick={handleSubmit}
                    disabled={!hasContent}
                    className={`p-1.5 rounded-full transition-colors ${hasContent ? 'hover:opacity-90 cursor-pointer' : 'cursor-not-allowed'}`}
                    style={{ backgroundColor: hasContent ? 'var(--color-accent)' : 'var(--color-bg-button)' }}
                    title="发送"
                  >
                    <ArrowUp className={`w-4 h-4 ${hasContent ? 'text-black' : 'text-gray-400'}`} strokeWidth={2.5} />
                  </button>
                </div>
              )}
              {/* Stop button */}
              {isLoading && (
                <div className="pr-2 py-2">
                  <button
                    onClick={onStop}
                    className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors"
                    title="停止生成"
                  >
                    <Square className="w-4 h-4" fill="currentColor" strokeWidth={0} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 安卓端附件底部面板：仅 Android 原生壳渲染，web/Electron 不受影响 */}
        {isNativeAndroid() && (
          <>
            <AttachmentSheet
              isOpen={showAttachmentSheet}
              onClose={() => setShowAttachmentSheet(false)}
              onPickGallery={() => { setShowAttachmentSheet(false); handleNativeGallery(); }}
              onTakePhoto={() => { setShowAttachmentSheet(false); handleNativeCamera(); }}
              onPickFiles={() => { setShowAttachmentSheet(false); handleNativeFiles(); }}
              onPickLibrary={handlePickLibrary}
            />
            {/* 附件面板「库」二级面板：更高，多选后确定上传到输入框 */}
            <LibraryPickerSheet
              isOpen={showLibrarySheet}
              onClose={() => setShowLibrarySheet(false)}
              assets={visibleLibraryAssets}
              onConfirm={handleLibraryConfirm}
            />
          </>
        )}
    </div>
  );
}

// 聊天面板因虚拟化滚动高频重渲染，输入框组件体量大（工具栏/附件面板等），
// memo + 上游稳定回调让它只在自身相关 props 变化时重渲染
export default memo(ChatInput);