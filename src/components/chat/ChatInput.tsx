import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';
import { Paperclip, Square, SendHorizontal, Plus, Clock, X, FileText, MessageSquareQuote, SlidersHorizontal } from 'lucide-react';
import type { MessageContent, Model, FileAttachment, Message, ChatFeatureSettings } from '../../types';
import ModelSelector from '../common/ModelSelector';
import { parseFile, type ParsedFile } from '../../services/fileParser';

interface ChatInputProps {
  onSend: (content: string | MessageContent[], attachments?: FileAttachment[]) => void;
  isLoading: boolean;
  onStop: () => void;
  onToggleHistory?: () => void;
  onNewConversation?: () => void;
  models?: Model[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  quotedMessage?: Message | null;
  onRemoveQuote?: () => void;
  featureSettings: ChatFeatureSettings;
  onFeatureSettingsChange: (settings: ChatFeatureSettings) => void;
  webSearchEnabled?: boolean;
  onWebSearchEnabledChange?: (enabled: boolean) => void;
}

export default function ChatInput({
  onSend,
  isLoading,
  onStop,
  onToggleHistory,
  onNewConversation,
  models,
  selectedModel,
  onModelChange,
  quotedMessage,
  onRemoveQuote,
  featureSettings,
  onFeatureSettingsChange,
  webSearchEnabled = false,
  onWebSearchEnabledChange,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showFeaturePanel, setShowFeaturePanel] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const featurePanelRef = useRef<HTMLDivElement>(null);
  const featureButtonRef = useRef<HTMLButtonElement>(null);

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  const MAX_TOTAL_FILES = 5;

  // 点击外部关闭 feature panel
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
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const base64 = ev.target?.result as string;
            setImages(prev => [...prev, base64]);
          };
          reader.readAsDataURL(file);
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
        const reader = new FileReader();
        reader.onload = (ev) => {
          const base64 = ev.target?.result as string;
          setImages(prev => [...prev, base64]);
        };
        reader.readAsDataURL(file);
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

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

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

      {/* Desktop input area - two row layout */}
      <div>
        {/* Row 1: Toolbar */}
        <div className="flex items-center justify-between mb-3">
          {/* Left: ModelSelector + Upload */}
          <div className="flex items-center">
            {models && selectedModel && onModelChange && (
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                onModelChange={onModelChange}
                compact={true}
              />
            )}
            {/* File upload */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="ml-2 p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
              title="上传图片"
            >
              <Paperclip className="w-5 h-5" />
            </button>

          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2">
            {/* Feature settings */}
            <div className="relative">
              <button
                ref={featureButtonRef}
                onClick={() => setShowFeaturePanel(prev => !prev)}
                className={`p-2 transition-colors rounded-lg hover:bg-gray-700 ${
                  showFeaturePanel ? 'text-[var(--color-accent)]' : 'text-gray-400 hover:text-white'
                }`}
                title="聊天控件"
              >
                <SlidersHorizontal className="w-5 h-5" />
              </button>

              {/* Feature Panel Popover */}
              {showFeaturePanel && (
                <div
                  ref={featurePanelRef}
                  className="absolute bottom-full right-0 mb-2 w-64 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl p-4 shadow-2xl z-50"
                >
                  <div className="text-white font-medium text-sm mb-3">聊天控件</div>
                  <div className="text-gray-500 text-xs mb-2">功能</div>
                  {/* Artifact Toggle */}
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-gray-200 text-sm">Artifacts</span>
                    <button
                      onClick={() => onFeatureSettingsChange({ ...featureSettings, artifactEnabled: !featureSettings.artifactEnabled })}
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
                  {/* Web Search Toggle */}
                  <div className="flex items-center justify-between py-1.5 mt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-200 text-sm">联网搜索</span>
                    </div>
                    <button
                      onClick={() => onWebSearchEnabledChange?.(!webSearchEnabled)}
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

            {/* History toggle */}
            <button
              onClick={() => onToggleHistory?.()}
              className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
              title="会话历史"
            >
              <Clock className="w-5 h-5" />
            </button>

            {/* New conversation */}
            <button
              onClick={() => onNewConversation?.()}
              className="w-7 h-7 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-accent-foreground)] rounded-full flex items-center justify-center transition-colors"
              title="新建会话"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Input container with preview + textarea */}
        <div className={`rounded-xl border transition-colors overflow-hidden ${isDragging ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30' : 'border-[var(--color-border)] focus-within:border-[var(--color-accent)]'}`}>
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
          {/* Desktop: unified preview area */}
          {(images.length > 0 || files.length > 0) && (
            <>
              <div className="flex gap-2 p-3 pb-2 flex-wrap">
                {images.map((img, idx) => (
                  <div key={`img-${idx}`} className="relative group">
                    <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-600" />
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
          {/* Textarea */}
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

            {/* Send / Stop button */}
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