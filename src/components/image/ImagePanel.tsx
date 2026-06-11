import { useRef, useState, useMemo, useCallback, useEffect, useLayoutEffect, type KeyboardEvent, type ChangeEvent, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  TriangleAlert,
  Images,
  Plus,
  Paperclip,
  SendHorizontal,
  ChevronDown,
  X,
} from 'lucide-react';
import ModelSelector from '../common/ModelSelector';
import { IMAGE_MODELS } from '../../config/models';
import { useImage } from '../../hooks/useImage';
import type { ImageHistoryItem, PendingImageTask } from '../../types';
import MasonryPhotoWall from './MasonryPhotoWall';
import type { PhotoItem } from './MasonryPhotoWall';
import PhotoCard, { LoadingCard, ErrorCard } from './PhotoCard';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB 宽松上限，防止拖入超大文件卡死浏览器

interface FlatCard {
  id: string;          // history.id
  urls: string[];
  index: number;       // 在 urls 中的下标
  url: string;
  prompt: string;
  model: string;
  timestamp: number;
  width?: number;
  height?: number;
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
        width: item.width,
        height: item.height,
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

function FloatingSelect({ options, value, onChange, disabled, renderOption, itemClassName = 'py-2 px-5' }: FloatingSelectProps) {
  const [open, setOpen] = useState(false);
  const [animVisible, setAnimVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; minWidth: number; width: number; placement: 'top' | 'bottom' } | null>(null);
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
      // 计算右对齐的位置：left = buttonRight - menuWidth
      // menuWidth 使用按钮宽度，确保右对齐
      const rightAlignedLeft = rect.right - rect.width;
      if (placement === 'bottom') {
        setPos({ top: rect.bottom + 4, left: rightAlignedLeft, minWidth: rect.width, width: rect.width, placement });
      } else {
        setPos({ bottom: window.innerHeight - rect.top + 4, left: rightAlignedLeft, minWidth: rect.width, width: rect.width, placement });
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
        className="flex items-center gap-2 rounded-full bg-[#2a2a30] text-white text-sm border border-white/5 px-4 py-2 hover:border-gray-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
            width: pos.width,
          }}
          className={`z-[1000] overflow-hidden bg-[var(--color-bg-elevated)] border border-white/5 rounded-xl shadow-2xl
            transition-all duration-200 ease-out ${pos.placement === 'bottom' ? 'origin-top' : 'origin-bottom'}
            ${animVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
        >
          <div className="py-2 px-2 flex flex-col gap-1">
            {options.map(opt => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); close(); }}
                  className={`w-full flex items-center gap-2.5 text-sm text-left transition-colors rounded-lg ${itemClassName} ${
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

/* ============ AspectRatioGrid 九宫格比例选择器 ============ */
interface AspectRatioGridProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function AspectRatioGrid({ options, value, onChange, disabled }: AspectRatioGridProps) {
  const [open, setOpen] = useState(false);
  const [animVisible, setAnimVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [mounted, setMounted] = useState(false);

  const toggle = () => {
    if (disabled) return;
    if (!open) {
      clearTimeout(unmountTimer.current);
      setMounted(true);
      setOpen(true);
    } else {
      setOpen(false);
      setAnimVisible(false);
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

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setAnimVisible(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setAnimVisible(false); }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="flex items-center gap-2 rounded-full bg-[#2a2a30] text-white text-sm border border-white/5 px-4 py-2 hover:border-gray-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <AspectRatioIcon ratio={value} />
        <span className="whitespace-nowrap">{value}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {mounted && (
        <div
          className={`absolute bottom-full mb-2 right-0 z-[1000] w-max bg-[var(--color-bg-elevated)] border border-white/5 rounded-xl shadow-2xl p-4 grid grid-cols-3 gap-3 transition-all duration-200 ease-out origin-bottom
            ${animVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
        >
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); setAnimVisible(false); }}
              className={`flex flex-col items-center justify-between px-4 py-3 rounded-lg transition-colors min-w-[64px] ${
                value === opt ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5'
              }`}
            >
              <div className="flex items-start justify-center h-8">
                <AspectRatioIcon ratio={opt} />
              </div>
              <span className="text-xs mt-2">{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);
  const lastSubmitRef = useRef(0);

  const flatCards = useMemo(() => flattenHistory(history), [history]);

  const handlePickFiles = () => {
    if (uploadedImages.length >= maxUploadCount) return;
    fileInputRef.current?.click();
  };

  // ===== Drag & Drop handlers =====
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
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

    // Case 1: 外部文件拖入
    if (files && files.length > 0) {
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
      return;
    }

    // Case 2: 内部图片 URL 拖入（照片墙拖拽）
    const rawUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!rawUrl) return;

    // 解析 text/uri-list 格式：可能包含多行，# 开头为注释，取第一个有效 URL
    const url = rawUrl
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))[0];
    if (!url) return;

    if (uploadedImages.length >= maxUploadCount) {
      setUploadError(`已达到最大上传数量 ${maxUploadCount}`);
      return;
    }

    setUploadError(null);

    try {
      let file: File;

      if (url.startsWith('data:image')) {
        // data URI：直接解码为 File，无需网络请求
        const resp = await fetch(url);
        const blob = await resp.blob();
        file = new File([blob], 'reference.png', { type: blob.type || 'image/png' });
      } else if (url.startsWith('blob:')) {
        // blob URL：直接 fetch 获取 blob
        const resp = await fetch(url);
        const blob = await resp.blob();
        file = new File([blob], 'reference.png', { type: blob.type || 'image/png' });
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        // 远程 URL：先尝试 fetch，失败则用 Image+canvas 回退
        let blob: Blob | null = null;
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            blob = await resp.blob();
          }
        } catch {
          // fetch 失败（CORS等），使用 canvas 回退
        }

        if (!blob) {
          // Image + canvas 回退方案（绕过 CORS 限制）
          blob = await new Promise<Blob>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              if (!ctx) { reject(new Error('Canvas不可用')); return; }
              ctx.drawImage(img, 0, 0);
              canvas.toBlob(b => {
                if (b) resolve(b);
                else reject(new Error('转换失败'));
              }, 'image/png');
            };
            img.onerror = () => {
              // canvas 也失败时，尝试不带 crossOrigin 加载（仍可显示但无法读取像素）
              // 此时直接用 URL 创建一个空 fetch 会失败，改为提示
              reject(new Error('图片加载失败'));
            };
            img.src = url;
          });
        }

        file = new File([blob], 'reference.png', { type: blob.type || 'image/png' });
      } else if (url.startsWith('local-image://')) {
        // Electron 自定义协议：通过 IPC 从主进程读取 base64
        const electronAPI = (window as unknown as { electronAPI?: { readImageAsBase64?: (url: string) => Promise<string | null> } }).electronAPI;
        const base64 = electronAPI?.readImageAsBase64
          ? await electronAPI.readImageAsBase64(url)
          : null;
        if (!base64) {
          setUploadError('无法读取本地图片');
          return;
        }
        const resp = await fetch(`data:image/png;base64,${base64}`);
        const lBlob = await resp.blob();
        file = new File([lBlob], 'reference.png', { type: lBlob.type || 'image/png' });
      } else {
        // 其他格式的 URL（不认识的协议），尝试 fetch 兜底
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          file = new File([blob], 'reference.png', { type: blob.type || 'image/png' });
        } catch {
          setUploadError('不支持该类型的拖入内容');
          return;
        }
      }

      const dt = new DataTransfer();
      dt.items.add(file);
      await addImages(dt.files);
    } catch {
      setUploadError('无法加载该图片作为参考图');
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
    // 防止 500ms 内重复提交（Enter + Button 同帧双触发）
    const now = Date.now();
    if (now - lastSubmitRef.current < 500) return;
    lastSubmitRef.current = now;
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

  // 将本地图片 URL 转为 File 并添加为参考图
  const addReferenceImage = useCallback(async (url: string) => {
    if (uploadedImages.length >= maxUploadCount) {
      setUploadError(`已达到最大上传数量 ${maxUploadCount}`);
      return;
    }
    setUploadError(null);
    try {
      let file: File;
      if (url.startsWith('local-image://')) {
        const electronAPI = (window as unknown as { electronAPI?: { readImageAsBase64?: (url: string) => Promise<string | null> } }).electronAPI;
        const base64 = electronAPI?.readImageAsBase64
          ? await electronAPI.readImageAsBase64(url)
          : null;
        if (!base64) { setUploadError('无法读取本地图片'); return; }
        const resp = await fetch(`data:image/png;base64,${base64}`);
        const blob = await resp.blob();
        file = new File([blob], 'reference.png', { type: blob.type || 'image/png' });
      } else {
        const resp = await fetch(url);
        const blob = await resp.blob();
        file = new File([blob], 'reference.png', { type: blob.type || 'image/png' });
      }
      const dt = new DataTransfer();
      dt.items.add(file);
      await addImages(dt.files);
    } catch {
      setUploadError('无法加载该图片作为参考图');
    }
  }, [uploadedImages.length, maxUploadCount, addImages]);

  // 将 FlatCard[] 转为 PhotoItem[]
  const photoItems: PhotoItem[] = useMemo(() =>
    flatCards.map(card => ({
      id: `${card.id}-${card.index}`,
      url: card.url,
      prompt: card.prompt,
      model: getModelLabel(card.model),
      timestamp: card.timestamp,
      width: card.width,
      height: card.height,
      _flatCard: card, // 保留原始数据供回调使用
    })),
    [flatCards],
  );

  // 卡片渲染回调：布局层与卡片层解耦
  const renderCard = useCallback((item: PhotoItem) => {
    const card = item._flatCard as FlatCard;
    return (
      <PhotoCard
        item={item}
        onDownload={() => handleDownload(card.url, card.prompt, card.timestamp)}
        onDelete={() => deleteHistoryItem(card.id)}
        onNativeDrag={(url) => {
          const electronAPI = (window as unknown as { electronAPI?: { startDrag?: (url: string) => void } }).electronAPI;
          electronAPI?.startDrag?.(url);
        }}
        onDragEnd={(_item, clientX, clientY) => {
          // hit-test：是否释放在输入区域内
          const area = inputAreaRef.current;
          if (!area) return;
          const rect = area.getBoundingClientRect();
          if (
            clientX >= rect.left && clientX <= rect.right &&
            clientY >= rect.top && clientY <= rect.bottom
          ) {
            addReferenceImage(card.url);
          }
        }}
      />
    );
  }, [deleteHistoryItem, handleDownload, addReferenceImage]);

  // Pending 任务卡片（loading + error）
  const pendingPhotoItems: PhotoItem[] = useMemo(() =>
    pendingTasks.map(task => ({
      id: task.id,
      _task: task,
    })),
    [pendingTasks],
  );

  const renderPendingCard = useCallback((item: PhotoItem) => {
    const task = item._task as PendingImageTask;
    if (task.status === 'loading') {
      return (
        <LoadingCard
          id={task.id}
          prompt={task.prompt}
          onCancel={cancelTask}
        />
      );
    }
    return (
      <ErrorCard
        id={task.id}
        error={task.error || '生成失败'}
        onRetry={retryTask}
        onDismiss={dismissTask}
      />
    );
  }, [cancelTask, retryTask, dismissTask]);

  const canGenerate = prompt.trim().length > 0;
  const canAddMore = uploadedImages.length < maxUploadCount;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
    >
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

      {/* Photo wall - Masonry layout, fills entire panel */}
      <div className="absolute inset-0 overflow-hidden">
        {flatCards.length === 0 && pendingTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Images className="w-16 h-16 mb-4 text-gray-600" strokeWidth={1.5} />
            <p className="text-sm">创作的内容将在这里显示</p>
          </div>
        ) : (
          <MasonryPhotoWall
            items={[...photoItems, ...pendingPhotoItems]}
            renderCard={(item, _index) => {
              const task = item._task as PendingImageTask | undefined;
              if (task) {
                return renderPendingCard(item);
              }
              return renderCard(item);
            }}
            gutter={3}
            scrollPaddingBottom={200}
            emptyContent={null}
          />
        )}
      </div>

      {/* 底部黑渐变遮罩 - 从下到上 */}
      <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none z-10"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)' }}
      />

      {/* Input area - overlay on top of photo wall */}
      <div
        ref={inputAreaRef}
        className="absolute bottom-0 left-0 right-0 z-20 p-3 md:p-4"
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay - only covers input area */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm border-2 border-dashed border-[var(--color-accent)] rounded-xl pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-white">
              <Images className="w-10 h-10 text-[var(--color-accent)]" />
              <span className="text-base font-medium">拖拽图片到此处作为参考图</span>
              <span className="text-xs text-gray-300">支持拖入外部图片或照片墙中的已生成图片</span>
            </div>
          </div>
        )}
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
              className="ml-2 p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-[#2a2a30] disabled:opacity-40 disabled:cursor-not-allowed"
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
            {/* Aspect Ratio - 九宫格面板 */}
            <AspectRatioGrid
              options={aspectRatioOptions}
              value={aspectRatio}
              onChange={setAspectRatio}
              disabled={aspectRatioOptions.length <= 1}
            />

            {/* Size - FloatingSelect */}
            <div className="flex items-center gap-1.5">
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


          </div>
        </div>

        {/* Row 2: Unified input container with embedded thumbnails */}
        <div className="relative rounded-xl bg-[#1a1a1f] border border-white/10 focus-within:border-[var(--color-accent)] transition-colors">
          {/* Thumbnails area inside input container */}
          {isEditMode && uploadedImages.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap">
                {uploadedImages.map((b64, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={`data:image/jpeg;base64,${b64}`}
                      alt={`upload-${idx}`}
                      draggable={false}
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
                  : '描述你的图片，或拖拽图片到此处作为参考'
              }
              className={`w-full bg-transparent text-white px-4 py-3.5 pr-14 resize-none placeholder-gray-500 max-h-[160px] min-h-[80px] focus:outline-none rounded-xl`}
              rows={3}
            />

            {/* Send button - absolute positioned bottom-right */}
            <div className="absolute right-3 bottom-3">
              <button
                onClick={handleSubmit}
                disabled={!canGenerate}
                className="p-2 text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] disabled:text-gray-500 transition-colors"
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
