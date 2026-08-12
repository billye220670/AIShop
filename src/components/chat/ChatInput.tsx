import { useState, useRef, useEffect, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Plus, Square, X, FileText, MessageSquareQuote, ArrowUp, Globe, Paperclip, SlidersHorizontal, SendHorizontal, Clock } from 'lucide-react';
import { Camera, MediaTypeSelection } from '@capacitor/camera';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { haptic } from '../../utils/haptics';
import { isNativeAndroid } from '../../platform/capabilities';
import type { MessageContent, FileAttachment, Message, ChatFeatureSettings, Model, ContextSegment } from '../../types';
import { parseFile, type ParsedFile } from '../../services/fileParser';
import { compressImageFile } from '../../utils/imageCompress';
import { useDeviceMode } from '../../platform/useDeviceMode';
import ModelSelector from '../common/ModelSelector';
import RoleSelector from '../common/RoleSelector';
import type { RoleData } from '../../db';
import type { UsageTotals } from '../../utils/tokenEstimate';
import ContextRing from './ContextRing';
import ContextPanel from './ContextPanel';
import AttachmentSheet from './AttachmentSheet';

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
}

export default function ChatInput({
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
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 控制是否应该自动聚焦：用户主动聚焦时为 true，主动失焦时为 false
  const shouldFocusRef = useRef(false);
  // 桌面形态聊天控件面板（Artifact/联网搜索开关弹层）
  const [showFeaturePanel, setShowFeaturePanel] = useState(false);
  const featurePanelRef = useRef<HTMLDivElement>(null);
  const featureButtonRef = useRef<HTMLButtonElement>(null);
  // 上下文详情面板开关（桌面形态：点击工具栏环按钮上浮展开）
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  // 安卓端附件面板开关（+ 号按钮弹出底部选择：相册/拍摄/文件）
  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false);

  // 桌面形态：输入框呈现 electron 版两行结构（工具栏 + 圆角边框输入容器），功能逻辑与移动形态共用
  const desktop = useDeviceMode() === 'desktop';

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

  // 激活态（展开布局）同步给父组件，用于隐藏“回到底部”按钮等
  useEffect(() => {
    onActiveChange?.(isFocused || hasContent);
  }, [isFocused, hasContent, onActiveChange]);

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  const MAX_TOTAL_FILES = 5;

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

    // 拼接引用内容
    let finalText = trimmedText;
    if (quotedMessage) {
      const quoteContent = typeof quotedMessage.content === 'string'
        ? quotedMessage.content
        : (quotedMessage.content as MessageContent[]).filter(p => p.type === 'text').map(p => p.text).join('\n');
      finalText = `> ${quoteContent.slice(0, 200).replace(/\n/g, '\n> ')}\n\n${trimmedText}`;
      onRemoveQuote?.();
    }

    if (images.length > 0) {
      const content: MessageContent[] = [];
      content.push({ type: 'text', text: finalText || '' });
      images.forEach(img => {
        content.push({ type: 'image_url', image_url: { url: img } });
      });
      onSend(content, attachments.length > 0 ? attachments : undefined);
    } else {
      onSend(finalText, attachments.length > 0 ? attachments : undefined);
    }

    setText('');
    setImages([]);
    setFiles([]);
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
    setText(e.target.value);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  // Enter 发送（仅桌面形态，electron 版同款交互）
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
                  <div className="w-8 h-8 rounded-md bg-[var(--color-accent-soft)] flex items-center justify-center flex-shrink-0">
                    <MessageSquareQuote className="w-4 h-4 text-[var(--color-accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-200 truncate">引用消息</div>
                    <div className="text-xs text-gray-500 truncate">
                      {typeof quotedMessage.content === 'string'
                        ? quotedMessage.content.slice(0, 30)
                        : (quotedMessage.content as MessageContent[]).filter(p => p.type === 'text').map(p => p.text).join('').slice(0, 30)
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
                <div className="flex gap-2 p-3 pb-2 flex-wrap">
                  {images.map((img, idx) => (
                    <div key={`img-${idx}`} className="relative group">
                      <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-600" draggable={false} />
                      <button
                        onClick={() => removeImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {files.map((file, idx) => (
                    <div key={`file-${idx}`} className="relative group min-w-[200px] max-w-[280px]">
                      <div className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-secondary)] border border-gray-700/50 rounded-lg">
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
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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
                <div className="w-8 h-8 rounded-md bg-[var(--color-accent-soft)] flex items-center justify-center flex-shrink-0">
                  <MessageSquareQuote className="w-4 h-4 text-[var(--color-accent)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 truncate">引用消息</div>
                  <div className="text-xs text-gray-500 truncate">
                    {typeof quotedMessage.content === 'string'
                      ? quotedMessage.content.slice(0, 30)
                      : (quotedMessage.content as MessageContent[]).filter(p => p.type === 'text').map(p => p.text).join('').slice(0, 30)
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
              <div className="flex gap-3 p-3 pb-2 flex-wrap">
                {images.map((img, idx) => (
                  <div key={`img-${idx}`} className="relative">
                    <img src={img} alt="" className="w-[4.5rem] h-[4.5rem] object-cover rounded-2xl" draggable={false} />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 w-5 h-5 bg-gray-600/80 hover:bg-gray-500 text-white rounded-full flex items-center justify-center"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
                {files.map((file, idx) => (
                  <div key={`file-${idx}`} className="relative group min-w-[200px] max-w-[280px]">
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-secondary)] border border-gray-700/50 rounded-lg">
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
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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
          <AttachmentSheet
            isOpen={showAttachmentSheet}
            onClose={() => setShowAttachmentSheet(false)}
            onPickGallery={() => { setShowAttachmentSheet(false); handleNativeGallery(); }}
            onTakePhoto={() => { setShowAttachmentSheet(false); handleNativeCamera(); }}
            onPickFiles={() => { setShowAttachmentSheet(false); handleNativeFiles(); }}
          />
        )}
    </div>
  );
}