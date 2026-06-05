import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ImageGenerationParams, ImageHistoryItem, PendingImageTask } from '../types';
import { IMAGE_MODELS } from '../config/models';
import { generateImage as apiGenerateImage } from '../services/imageApi';

const MODEL_KEY = 'aishop_image_model';
const HISTORY_KEY = 'aishop_image_history';

// ---------- 模型分组工具 ----------
function isGptModel(id: string): boolean {
  return id === 'gpt-image-2';
}
function isGoogleModel(id: string): boolean {
  return id === 'gemini-3.1-flash' || id === 'gemini-3-pro';
}

// ---------- 选项定义 ----------
const GOOGLE_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
const GPT_SIZES = ['1024x1024', '1024x1536', '1536x1024', '2048x2048'];
const GOOGLE_FLASH_SIZES = ['0.5K', '1K', '2K', '4K'];
const GOOGLE_PRO_SIZES = ['1K', '2K', '4K'];
const GPT_QUALITIES = ['low', 'medium', 'high'];

function getDefaultSize(modelId: string): string {
  if (isGptModel(modelId)) return '1024x1024';
  return '1K';
}
function getDefaultAspectRatio(modelId: string): string {
  // GPT 不使用 aspect_ratio，统一占位 'auto'
  if (isGptModel(modelId)) return 'auto';
  return '1:1';
}
function getMaxUploadCount(modelId: string): number {
  if (isGptModel(modelId)) return 1;
  if (isGoogleModel(modelId)) return 14;
  return 1;
}

// ---------- localStorage 工具 ----------
function loadModel(): string {
  try {
    const v = localStorage.getItem(MODEL_KEY);
    if (v && IMAGE_MODELS.some(m => m.id === v)) return v;
  } catch {
    /* ignore */
  }
  return IMAGE_MODELS[0].id;
}
function saveModel(id: string): void {
  try {
    localStorage.setItem(MODEL_KEY, id);
  } catch {
    /* ignore */
  }
}
function loadHistory(): ImageHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((it): it is ImageHistoryItem => {
      return (
        it &&
        typeof it.id === 'string' &&
        Array.isArray(it.urls) &&
        typeof it.prompt === 'string' &&
        typeof it.model === 'string' &&
        typeof it.timestamp === 'number'
      );
    });
  } catch {
    return [];
  }
}
function saveHistory(list: ImageHistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save image history:', e);
  }
}

// ---------- 图片压缩 ----------
/**
 * 将图片文件压缩为 base64（不含 data:image/...;base64, 前缀）。
 * 最大边长 1024px，JPEG 质量 0.85。
 */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 1024;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = (height / width) * maxSize;
            width = maxSize;
          } else {
            width = (width / height) * maxSize;
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1] || '';
        resolve(base64);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = (e.target?.result as string) || '';
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

// ---------- Hook ----------
export function useImage() {
  const [selectedModel, setSelectedModelState] = useState<string>(() => loadModel());
  const [history, setHistory] = useState<ImageHistoryItem[]>(() => loadHistory());

  const [uploadedImages, setUploadedImages] = useState<string[]>([]);

  const [aspectRatio, setAspectRatio] = useState<string>(() =>
    getDefaultAspectRatio(loadModel())
  );
  const [size, setSize] = useState<string>(() => getDefaultSize(loadModel()));
  const [quality, setQuality] = useState<string>('medium');

  // 并发队列状态
  const [pendingTasks, setPendingTasks] = useState<PendingImageTask[]>([]);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  // 持久化
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // 组件卸载时清理所有 controllers
  useEffect(() => {
    return () => {
      controllersRef.current.forEach(c => c.abort());
      controllersRef.current.clear();
    };
  }, []);

  // 切换模型时：重置参数 + 裁剪超量上传 + 持久化
  const setSelectedModel = useCallback((id: string) => {
    setSelectedModelState(id);
    saveModel(id);
    setAspectRatio(getDefaultAspectRatio(id));
    setSize(getDefaultSize(id));
    setQuality('medium');
    // 裁剪超过新模型最大上传数量的图片
    const max = getMaxUploadCount(id);
    setUploadedImages(prev => (prev.length > max ? prev.slice(0, max) : prev));
  }, []);

  // ---------- 上传图片管理 ----------
  const addImages = useCallback(
    async (files: FileList) => {
      const max = getMaxUploadCount(selectedModel);
      const remain = max - uploadedImages.length;
      if (remain <= 0) return;
      const list = Array.from(files).slice(0, remain);
      const compressed: string[] = [];
      for (const f of list) {
        if (!f.type.startsWith('image/')) continue;
        try {
          const b64 = await compressImage(f);
          compressed.push(b64);
        } catch (e) {
          console.error('压缩失败:', e);
        }
      }
      if (compressed.length > 0) {
        setUploadedImages(prev => [...prev, ...compressed].slice(0, max));
      }
    },
    [selectedModel, uploadedImages.length]
  );

  const removeImage = useCallback((index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearImages = useCallback(() => {
    setUploadedImages([]);
  }, []);

  // ---------- 计算属性 ----------
  const isEditMode = uploadedImages.length > 0;
  const maxUploadCount = useMemo(() => getMaxUploadCount(selectedModel), [selectedModel]);

  const aspectRatioOptions = useMemo(() => {
    if (isGptModel(selectedModel)) return ['auto'];
    // Google
    return isEditMode ? ['auto', ...GOOGLE_ASPECT_RATIOS] : [...GOOGLE_ASPECT_RATIOS];
  }, [selectedModel, isEditMode]);

  const sizeOptions = useMemo(() => {
    if (isGptModel(selectedModel)) return GPT_SIZES;
    if (selectedModel === 'gemini-3.1-flash') return GOOGLE_FLASH_SIZES;
    if (selectedModel === 'gemini-3-pro') return GOOGLE_PRO_SIZES;
    return ['1K'];
  }, [selectedModel]);

  const qualityOptions = GPT_QUALITIES;
  const showQuality = isGptModel(selectedModel);

  // 派生的"有效值"：若当前选择不在选项内，回落到第一个选项。
  const effectiveAspectRatio = aspectRatioOptions.includes(aspectRatio)
    ? aspectRatio
    : aspectRatioOptions[0];
  const effectiveSize = sizeOptions.includes(size) ? size : sizeOptions[0];

  // ---------- 内部：用给定参数发起请求 ----------
  const executeTask = useCallback(async (params: ImageGenerationParams) => {
    const taskId = crypto.randomUUID();
    const task: PendingImageTask = {
      id: taskId,
      prompt: params.prompt,
      model: params.model,
      params,
      status: 'loading',
      createdAt: Date.now(),
    };

    // 添加到队列（追加到末尾，避免把已有内容挤开）
    setPendingTasks(prev => [...prev, task]);

    // 独立的 AbortController（超时由 imageApi 内部控制，这里仅用于用户手动取消）
    const controller = new AbortController();
    controllersRef.current.set(taskId, controller);

    try {
      const urls = await apiGenerateImage(params, controller.signal);
      // 限制返回数量不超过请求的 n，并去重
      const dedupedUrls = [...new Set(urls)].slice(0, params.n || 1);
      // 成功后保存到本地
      const electronAPI = (window as unknown as { electronAPI?: { saveImageLocal?: (url: string, fileName: string) => Promise<string | null> } }).electronAPI;
      const localUrls: string[] = [];
      for (const url of dedupedUrls) {
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
        if (electronAPI?.saveImageLocal) {
          const saved = await electronAPI.saveImageLocal(url, fileName);
          if (saved) {
            localUrls.push(`local-image://${saved}`);
          } else {
            localUrls.push(url); // fallback to original
          }
        } else {
          localUrls.push(url); // non-electron fallback
        }
      }
      // 成功：从队列移除，加入历史
      setPendingTasks(prev => prev.filter(t => t.id !== taskId));
      const historyItem: ImageHistoryItem = {
        id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
        urls: localUrls,
        prompt: params.prompt,
        model: params.model,
        timestamp: Date.now(),
        aspectRatio: isGoogleModel(params.model) ? params.aspectRatio : undefined,
        size: params.size,
        quality: isGptModel(params.model) ? params.quality : undefined,
        sourceImages: params.images ? params.images.length : undefined,
      };
      // 追加到末尾：保持与 loading 卡片在原位置一致，避免完成后图片跳到最前
      setHistory(prev => [...prev, historyItem]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // 检查是用户手动取消还是超时
        if (!controllersRef.current.has(taskId)) {
          // 手动取消：直接移除
          setPendingTasks(prev => prev.filter(t => t.id !== taskId));
          return;
        }
        // 超时
        setPendingTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: 'error' as const, error: '请求超时，请稍后重试' } : t
        ));
      } else {
        setPendingTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: 'error' as const, error: err instanceof Error ? err.message : '生成失败' } : t
        ));
      }
    } finally {
      controllersRef.current.delete(taskId);
    }
  }, []);

  // ---------- 生成（对外接口）----------
  const generate = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      const isEdit = uploadedImages.length > 0;
      const params: ImageGenerationParams = {
        prompt: trimmed,
        model: selectedModel,
        n: 1,
      };

      if (isEdit) {
        params.images = [...uploadedImages];
      }

      if (isGptModel(selectedModel)) {
        params.size = effectiveSize;
        params.quality = quality;
      } else if (isGoogleModel(selectedModel)) {
        params.size = effectiveSize;
        params.aspectRatio = isEdit ? 'auto' : effectiveAspectRatio;
      }

      // 非阻塞：不 await，让任务独立运行
      executeTask(params);
    },
    [effectiveAspectRatio, effectiveSize, quality, selectedModel, uploadedImages, executeTask]
  );

  // ---------- 重试：用原参数重新发起 ----------
  const retryTask = useCallback((taskId: string) => {
    const task = pendingTasks.find(t => t.id === taskId);
    if (!task) return;
    // 移除旧的错误任务
    setPendingTasks(prev => prev.filter(t => t.id !== taskId));
    // 用原参数重新生成
    executeTask(task.params);
  }, [pendingTasks, executeTask]);

  // ---------- 取消指定任务 ----------
  const cancelTask = useCallback((taskId: string) => {
    const controller = controllersRef.current.get(taskId);
    if (controller) {
      controllersRef.current.delete(taskId); // 先删除，让 abort 处理知道是手动取消
      controller.abort();
    }
    setPendingTasks(prev => prev.filter(t => t.id !== taskId));
  }, []);

  // ---------- 关闭错误卡片 ----------
  const dismissTask = useCallback((taskId: string) => {
    setPendingTasks(prev => prev.filter(t => t.id !== taskId));
  }, []);

  // ---------- 历史 ----------
  const deleteHistoryItem = useCallback((id: string) => {
    setHistory(prev => prev.filter(it => it.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return {
    // 模型
    selectedModel,
    setSelectedModel,

    // 上传图片
    uploadedImages,
    addImages,
    removeImage,
    clearImages,

    // 参数（对外暴露派生后的有效值，避免选项变化导致的脏值）
    aspectRatio: effectiveAspectRatio,
    setAspectRatio,
    size: effectiveSize,
    setSize,
    quality,
    setQuality,

    // 生成（并发队列）
    pendingTasks,
    generate,
    retryTask,
    cancelTask,
    dismissTask,

    // 历史
    history,
    deleteHistoryItem,
    clearHistory,

    // 计算属性
    isEditMode,
    maxUploadCount,
    aspectRatioOptions,
    sizeOptions,
    qualityOptions,
    showQuality,
  };
}
