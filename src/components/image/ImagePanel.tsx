import { useRef, useState, useMemo, useCallback, useEffect, useLayoutEffect, type KeyboardEvent, type ChangeEvent, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  TriangleAlert,
  Images,
  Download,
  Trash2,
  Loader2,
  Plus,
  Paperclip,
  SendHorizontal,
  ChevronDown,
  X,
} from 'lucide-react';
import ModelSelector from '../common/ModelSelector';
import { IMAGE_MODELS } from '../../config/models';
import { useImage } from '../../hooks/useImage';
import type { ImageHistoryItem } from '../../types';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB 宽松上限，防止拖入超大文件卡死浏览器

interface FlatCard {
  id: string;          // history.id
  urls: string[];
  index: number;       // 在 urls 中的下标
  url: string;
  prompt: string;
  model: string;
  timestamp: number;
}

function flattenHistory(history: ImageHistoryItem[]): FlatCard[] {
  const cards: FlatCard[] = [];
  history.forEach(item => {
    item.urls.forEach((url, index) => {
      cards.push({
        id: item.id,
        urls: item.urls,
        index,
        url,
        prompt: item.prompt,
        model: item.model,
        timestamp: item.timestamp,
      });
    });
  });
  return cards;
}

function getModelLabel(modelId: string): string {
  return IMAGE_MODELS.find(m => m.id === modelId)?.name || modelId;
}

function triggerDownload(url: string, prompt: string, timestamp: number): void {
  const a = document.createElement('a');
  a.href = url;
  const safeName = prompt.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'image';
  a.download = `${safeName}_${timestamp}.png`;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ============ FloatingSelect 通用浮动面板子组件 ============ */
interface FloatingSelectOption {
  value: string;
  label: string;
}

interface FloatingSelectProps {
  options: FloatingSelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  renderOption?: (opt: FloatingSelectOption, active: boolean) => React.ReactNode;
  itemClassName?: string;
}

function FloatingSelect({ options, value, onChange, disabled, renderOption, itemClassName = 'py-2 px-3' }: FloatingSelectProps) {
  const [open, setOpen] = useState(false);
  const [animVisible, setAnimVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; minWidth: number; placement: 'top' | 'bottom' } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const currentLabel = options.find(o => o.value === value)?.label || value;

  const close = () => {
    setOpen(false);
    setAnimVisible(false);
  };

  const toggle = () => {
    if (disabled) return;
    if (!open) {
      clearTimeout(unmountTimer.current);
      setMounted(true);
      setOpen(true);
    } else {
      close();
    }
  };

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimVisible(true));
      });
    } else {
      unmountTimer.current = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(unmountTimer.current);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !mounted || !triggerRef.current) return;
    const recalc = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const placement: 'top' | 'bottom' = spaceBelow >= spaceAbove ? 'bottom' : 'top';
      if (placement === 'bottom') {
        setPos({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width, placement });
      } else {
        setPos({ bottom: window.innerHeight - rect.top + 4, left: rect.left, minWidth: rect.width, placement });
      }
    };
    requestAnimationFrame(recalc);
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [mounted, open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey as unknown as EventListener);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey as unknown as EventListener);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-full bg-transparent text-white text-xs border border-gray-700/50 px-3 py-1 hover:border-gray-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <span className="whitespace-nowrap">{currentLabel}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {mounted && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            ...(pos.top !== undefined ? { top: pos.top } : {}),
            ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
            left: pos.left,
            minWidth: pos.minWidth,
          }}
          className={`z-[1000] overflow-hidden bg-[rgb(46,47,60)] border border-white/5 rounded-xl shadow-2xl
            transition-all duration-200 ease-out ${pos.placement === 'bottom' ? 'origin-top' : 'origin-bottom'}
            ${animVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
        >
          <div className="py-1.5 flex flex-col gap-1">
            {options.map(opt => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); close(); }}
                  className={`w-full flex items-center gap-2.5 text-sm text-left transition-colors rounded-lg mx-auto ${itemClassName} ${
                    active ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  {renderOption ? renderOption(opt, active) : <span>{opt.label}</span>}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ============ AspectRatioIcon 比例示意图 ============ */
function AspectRatioIcon({ ratio }: { ratio: string }) {
  const baseH = 24;
  let w = baseH;
  let h = baseH;
  let dashed = false;

  if (ratio === 'auto' || ratio === 'Auto') {
    dashed = true;
  } else {
    const parts = ratio.split(':');
    if (parts.length === 2) {
      const rw = parseFloat(parts[0]);
      const rh = parseFloat(parts[1]);
      if (rw > 0 && rh > 0) {
        const scale = baseH / Math.max(rw, rh);
        w = Math.round(rw * scale);
        h = Math.round(rh * scale);
      }
    }
  }

  return (
    <div
      className={`rounded border bg-gray-600/30 flex-shrink-0 ${dashed ? 'border-dashed border-gray-400' : 'border-gray-400'}`}
      style={{ width: w, height: h }}
    />
  );
}

export default function ImagePanel() {
  const {
    selectedModel,
    setSelectedModel,
    uploadedImages,
    addImages,
    removeImage,
    aspectRatio,
    setAspectRatio,
    size,
    setSize,
    quality,
    setQuality,
    pendingTasks,
    generate,
    retryTask,
    cancelTask,
    dismissTask,
    history,
    deleteHistoryItem,
    clearHistory,
    isEditMode,
    maxUploadCount,
    aspectRatioOptions,
    sizeOptions,
    qualityOptions,
    showQuality,
  } = useImage();

  const [prompt, setPrompt] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounter = useRef(0);

  const flatCards = useMemo(() => flattenHistory(history), [history]);

  const handlePickFiles = () => {
    if (uploadedImages.length >= maxUploadCount) return;
    fileInputRef.current?.click();
  };

  // ===== Drag & Drop handlers =====
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    // 只接受 image/* 类型
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setUploadError('仅支持拖拽图片文件');
      return;
    }

    if (uploadedImages.length >= maxUploadCount) {
      setUploadError(`已达到最大上传数量 ${maxUploadCount}`);
      return;
    }

    setUploadError(null);

    // 宽松大小校验（仅拦截超大文件防止浏览器卡死）
    const oversized: string[] = [];
    const accepted: File[] = [];
    imageFiles.forEach(f => {
      if (f.size > MAX_FILE_SIZE) {
        oversized.push(f.name);
      } else {
        accepted.push(f);
      }
    });

    if (oversized.length > 0) {
      setUploadError(`以下图片超过 50MB 已被忽略：${oversized.join(', ')}`);
    }

    if (accepted.length > 0) {
      const dt = new DataTransfer();
      accepted.forEach(f => dt.items.add(f));
      await addImages(dt.files);
    }
  }, [uploadedImages.length, maxUploadCount, addImages]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);

    // 宽松大小校验（仅拦截超大文件防止浏览器卡死）
    const oversized: string[] = [];
    const accepted: File[] = [];
    Array.from(files).forEach(f => {
      if (f.size > MAX_FILE_SIZE) {
        oversized.push(f.name);
      } else {
        accepted.push(f);
      }
    });

    if (oversized.length > 0) {
      setUploadError(`以下图片超过 50MB 已被忽略：${oversized.join(', ')}`);
    }

    if (accepted.length > 0) {
      const dt = new DataTransfer();
      accepted.forEach(f => dt.items.add(f));
      await addImages(dt.files);
    }

    e.target.value = '';
  };

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    generate(trimmed);
    setPrompt('');
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
    setPrompt(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  };

  const handleDownload = (url: string, p: string, ts: number) => {
    triggerDownload(url, p, ts);
  };

  const canGenerate = prompt.trim().length > 0;
  const canAddMore = uploadedImages.length < maxUploadCount;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm border-2 border-dashed border-[rgb(127,96,255)] rounded-xl pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-white">
            <Images className="w-12 h-12 text-[rgb(127,96,255)]" />
            <span className="text-lg font-medium">拖拽图片到此处</span>
            <span className="text-sm text-gray-300">支持 JPG、PNG、WebP 等格式</span>
          </div>
        </div>
      )}
      {/* Upload error banner */}
      {uploadError && (
        <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="flex-1">{uploadError}</span>
          <button
            onClick={() => {
              setUploadError(null);
            }}
            className="text-red-300 hover:text-red-100 text-xs"
          >
            关闭
          </button>
        </div>
      )}

      {/* Photo wall */}
      <div className="flex-1 overflow-y-auto p-6">
        {flatCards.length === 0 && pendingTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Images className="w-16 h-16 mb-4 text-gray-600" strokeWidth={1.5} />
            <p className="text-lg">输入提示词开始创作</p>
            <p className="text-sm mt-2">
              支持 GPT Image 2 / Nanobanana 2 / Nanobanana Pro，可上传参考图进行编辑
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {flatCards.map(card => (
              <div
                key={`${card.id}-${card.index}`}
                className="relative group rounded-xl overflow-hidden bg-gray-800 border border-gray-700 aspect-square"
              >
                <img
                  src={card.url}
                  alt={card.prompt}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleDownload(card.url, card.prompt, card.timestamp)}
                      className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white rounded-lg transition-colors"
                      title="下载"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteHistoryItem(card.id)}
                      className="w-8 h-8 flex items-center justify-center bg-red-500/80 hover:bg-red-600 text-white rounded-lg transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <p className="text-xs text-white/90 line-clamp-3">{card.prompt}</p>
                    <p className="text-[10px] text-gray-300 mt-1">
                      {getModelLabel(card.model)}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {/* 进行中和错误的任务卡片：追加到照片墙末尾，不挤开已有内容 */}
            {pendingTasks.map(task => (
              <div key={task.id} className={`relative rounded-xl overflow-hidden aspect-square ${
                task.status === 'loading'
                  ? 'bg-gray-800 border border-gray-700 animate-pulse'
                  : 'bg-red-950/40 border border-red-800'
              }`}>
                {task.status === 'loading' ? (
                  <div className="flex flex-col items-center justify-center h-full p-3 text-center">
                    <Loader2 className="animate-spin h-8 w-8 text-blue-500 mb-2" />
                    <p className="text-xs text-gray-400 line-clamp-2">{task.prompt}</p>
                    <button
                      onClick={() => cancelTask(task.id)}
                      className="mt-2 text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full p-3 text-center">
                    <TriangleAlert className="h-8 w-8 text-red-400 mb-2" />
                    <p className="text-xs text-red-400 line-clamp-2 mb-2">
                      {task.error}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => retryTask(task.id)}
                        className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                      >
                        重试
                      </button>
                      <button
                        onClick={() => dismissTask(task.id)}
                        className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input area - aligned with ChatInput design */}
      <div className="bg-transparent p-3 md:p-4">
        {/* Row 1: Toolbar */}
        <div className="flex items-center justify-between mb-3">
          {/* Left: ModelSelector + Upload */}
          <div className="flex items-center">
            <ModelSelector
              models={IMAGE_MODELS}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              compact={true}
            />
            <button
              onClick={handlePickFiles}
              disabled={!canAddMore}
              className="ml-2 p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title={canAddMore ? '上传参考图' : `已达到最大数量 ${maxUploadCount}`}
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple={maxUploadCount > 1}
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Right: Parameters + Clear */}
          <div className="flex items-center gap-3">
            {/* Aspect Ratio - FloatingSelect */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">宽高比:</span>
              <FloatingSelect
                options={aspectRatioOptions.map(opt => ({ value: opt, label: opt }))}
                value={aspectRatio}
                onChange={setAspectRatio}
                disabled={aspectRatioOptions.length <= 1}
                itemClassName="py-2.5 px-3"
                renderOption={(opt) => (
                  <>
                    <AspectRatioIcon ratio={opt.value} />
                    <span>{opt.label}</span>
                  </>
                )}
              />
            </div>

            {/* Size - FloatingSelect */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">尺寸:</span>
              <FloatingSelect
                options={sizeOptions.map(opt => ({ value: opt, label: opt }))}
                value={size}
                onChange={setSize}
                disabled={sizeOptions.length <= 1}
              />
            </div>

            {/* Quality */}
            {showQuality && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">质量:</span>
                <FloatingSelect
                  options={qualityOptions.map(opt => ({ value: opt, label: opt }))}
                  value={quality}
                  onChange={setQuality}
                  disabled={qualityOptions.length <= 1}
                />
              </div>
            )}

            {/* Clear History */}
            {history.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('确定要清空所有生成历史吗？')) clearHistory();
                }}
                className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                title="清空历史"
              >
                清空历史
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Unified input container with embedded thumbnails */}
        <div className={`relative rounded-xl transition-colors ${
          uploadedImages.length > 0
            ? 'border border-white/10 focus-within:border-[rgb(127,96,255)]'
            : ''
        }`}>
          {/* Thumbnails area inside input container */}
          {isEditMode && uploadedImages.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap">
                {uploadedImages.map((b64, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={`data:image/jpeg;base64,${b64}`}
                      alt={`upload-${idx}`}
                      className="w-16 h-16 object-cover rounded-lg border border-gray-600"
                    />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs items-center justify-center transition-colors hidden group-hover:flex"
                      title="移除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {canAddMore && (
                  <button
                    onClick={handlePickFiles}
                    className="w-16 h-16 flex flex-col items-center justify-center gap-0.5 border border-dashed border-gray-600 hover:border-blue-500 rounded-lg text-gray-400 hover:text-blue-400 transition-colors"
                    title="添加更多"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="text-[10px]">添加</span>
                  </button>
                )}
              </div>
              <div className="border-b border-gray-600/40" />
            </>
          )}

          {/* Textarea */}
          <div className={`relative ${uploadedImages.length === 0 ? '' : ''}`}>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isEditMode
                  ? '描述如何编辑参考图... (Enter 发送, Shift+Enter 换行)'
                  : '描述你想生成的图片... (Enter 发送, Shift+Enter 换行)'
              }
              className={`w-full bg-transparent text-white px-4 py-3.5 pr-14 resize-none placeholder-gray-500 max-h-[160px] min-h-[80px] focus:outline-none ${
                uploadedImages.length > 0
                  ? 'border-none rounded-b-xl'
                  : 'rounded-xl border border-white/10 focus:border-[rgb(127,96,255)]'
              }`}
              rows={3}
            />

            {/* Send button - absolute positioned bottom-right */}
            <div className="absolute right-3 bottom-3">
              <button
                onClick={handleSubmit}
                disabled={!canGenerate}
                className="p-2 text-[rgb(127,96,255)] hover:text-[rgb(107,76,235)] disabled:text-gray-500 transition-colors"
                title="生成"
              >
                <SendHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
