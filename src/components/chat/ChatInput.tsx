import { useState, useRef, type KeyboardEvent, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';
import { Paperclip, Square, ArrowUp, SendHorizontal, Plus, Clock, X, FileText } from 'lucide-react';
import type { MessageContent, Model, FileAttachment } from '../../types';
import ModelSelector from '../common/ModelSelector';
import { parseFile, type ParsedFile } from '../../services/fileParser';

interface ChatInputProps {
  onSend: (content: string | MessageContent[], attachments?: FileAttachment[]) => void;
  isLoading: boolean;
  onStop: () => void;
  onFocusChange?: (focused: boolean) => void;
  onToggleHistory?: () => void;
  onNewConversation?: () => void;
  models?: Model[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
}

export default function ChatInput({
  onSend,
  isLoading,
  onStop,
  onFocusChange,
  onToggleHistory,
  onNewConversation,
  models,
  selectedModel,
  onModelChange,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    if (images.length > 0) {
      const content: MessageContent[] = [];
      content.push({ type: 'text', text: trimmedText || '' });
      images.forEach(img => {
        content.push({ type: 'image_url', image_url: { url: img } });
      });
      onSend(content, attachments.length > 0 ? attachments : undefined);
    } else {
      onSend(trimmedText, attachments.length > 0 ? attachments : undefined);
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

    const allowedExts = ['txt', 'md', 'pdf', 'csv', 'json'];
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
      className={`bg-transparent p-3 md:p-4 relative transition-all ${isDragging ? 'ring-2 ring-purple-500 bg-purple-500/5 rounded-xl' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 共用的文件 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.pdf,.csv,.json,image/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* 拖拽遮罩提示 */}
      {isDragging && (
        <div className="absolute inset-0 bg-purple-600/10 border-2 border-dashed border-purple-400 rounded-xl flex items-center justify-center z-40 pointer-events-none">
          <div className="text-purple-200 text-sm font-medium px-4 py-2 bg-gray-900/80 rounded-lg shadow-lg">
            拖放文件到此处上传
          </div>
        </div>
      )}

    
      {/* Mobile input bar */}
      <div className="md:hidden">
        <div className={`bg-gray-900 border border-transparent focus-within:border-[rgb(127,96,255)] transition-colors ${
          (images.length > 0 || files.length > 0) ? 'rounded-2xl' : 'rounded-full'
        }`}>
          {/* Mobile: unified preview area */}
          {(images.length > 0 || files.length > 0) && (
            <>
              <div className="flex gap-2 p-3 pb-2 flex-wrap">
                {images.map((img, idx) => (
                  <div key={`img-${idx}`} className="relative group">
                    <img src={img} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-600" />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {files.map((file, idx) => (
                  <div key={`file-${idx}`} className="relative flex items-center gap-3 px-3 py-2.5 bg-[#1e2030] border border-gray-700/50 rounded-lg min-w-[200px] max-w-[280px]">
                    <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-purple-500/15">
                      <FileText className="w-5 h-5 text-[rgb(127,96,255)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 font-medium truncate">{file.name}</div>
                      <div className="text-xs text-gray-500">File · {formatFileSize(file.size)}{file.truncated ? ' · 已截断' : ''}</div>
                    </div>
                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute top-1 right-1 p-0.5 text-gray-500 hover:text-red-400 transition-colors rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-700/60 mx-3" />
            </>
          )}
          {/* Mobile input row */}
          <div className="relative">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-gray-800 z-10"
              title="添加媒体"
            >
              <Plus className="w-5 h-5" />
            </button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => { setIsFocused(true); onFocusChange?.(true); }}
              onBlur={() => { setIsFocused(false); onFocusChange?.(false); }}
              placeholder="询问任何问题..."
              className="w-full bg-transparent text-white pl-12 pr-12 py-3.5 resize-none placeholder-gray-500 focus:outline-none max-h-[200px] min-h-[52px]"
              rows={1}
            />
            {(isFocused || text.trim()) && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSubmit}
                disabled={!text.trim() && images.length === 0 && files.length === 0}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1.5 bg-[rgb(127,96,255)] disabled:bg-gray-700 disabled:text-gray-500 hover:bg-[rgb(107,76,235)] text-white transition-colors rounded-full z-10"
                title="发送"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
  
      {/* Desktop input area - two row layout */}
      <div className="hidden md:block">
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
              className="w-7 h-7 bg-[rgb(127,96,255)] hover:bg-[rgb(107,76,235)] text-white rounded-full flex items-center justify-center transition-colors"
              title="新建会话"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Input container with preview + textarea */}
        <div className="rounded-xl border border-white/10 focus-within:border-[rgb(127,96,255)] transition-colors overflow-hidden">
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
                  <div key={`file-${idx}`} className="relative flex items-center gap-3 px-3 py-2.5 bg-[#1e2030] border border-gray-700/50 rounded-lg min-w-[200px] max-w-[280px]">
                    <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-purple-500/15">
                      <FileText className="w-5 h-5 text-[rgb(127,96,255)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 font-medium truncate">{file.name}</div>
                      <div className="text-xs text-gray-500">File · {formatFileSize(file.size)}{file.truncated ? ' · 已截断' : ''}</div>
                    </div>
                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute top-1 right-1 p-0.5 text-gray-500 hover:text-red-400 transition-colors rounded"
                    >
                      <X className="w-3.5 h-3.5" />
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
                  className="p-2 text-[rgb(127,96,255)] hover:text-[rgb(107,76,235)] disabled:text-gray-500 transition-colors"
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
