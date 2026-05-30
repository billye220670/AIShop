import { useRef, useState, useMemo, type KeyboardEvent, type ChangeEvent } from 'react';
import {
  TriangleAlert,
  Images,
  Download,
  Trash2,
  Loader2,
  Plus,
  Paperclip,
  Sparkles,
} from 'lucide-react';
import ModelSelector from '../common/ModelSelector';
import { IMAGE_MODELS } from '../../config/models';
import { useImage } from '../../hooks/useImage';
import type { ImageHistoryItem } from '../../types';

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const flatCards = useMemo(() => flattenHistory(history), [history]);

  const handlePickFiles = () => {
    if (uploadedImages.length >= maxUploadCount) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);

    // 大小校验
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
      setUploadError(`以下图片超过 4MB 已被忽略：${oversized.join(', ')}`);
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-gray-900/50">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">AI 绘图</h2>
          <ModelSelector
            models={IMAGE_MODELS}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
          />
        </div>
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

      {/* Uploaded images preview bar */}
      {isEditMode && (
        <div className="border-t border-gray-700 bg-gray-900/70 px-4 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">参考图 ({uploadedImages.length}/{maxUploadCount}):</span>
            {uploadedImages.map((b64, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={`data:image/jpeg;base64,${b64}`}
                  alt={`upload-${idx}`}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-600"
                />
                <button
                  onClick={() => removeImage(idx)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center transition-colors"
                  title="移除"
                >
                  ×
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
        </div>
      )}

      {/* Parameters row */}
      <div className="border-t border-gray-700 bg-gray-900 px-4 py-2 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">宽高比:</span>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            disabled={aspectRatioOptions.length <= 1}
            className="bg-gray-700 text-white text-xs rounded-lg px-2.5 py-1 border border-gray-600 focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {aspectRatioOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">尺寸:</span>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="bg-gray-700 text-white text-xs rounded-lg px-2.5 py-1 border border-gray-600 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            {sizeOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {showQuality && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">质量:</span>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="bg-gray-700 text-white text-xs rounded-lg px-2.5 py-1 border border-gray-600 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {qualityOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        )}

        <div className="ml-auto text-xs text-gray-500">
          {isEditMode ? `编辑模式 · 已上传 ${uploadedImages.length}/${maxUploadCount}` : '生成模式'}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-gray-700 bg-gray-900 p-4">
        <div className="flex items-end gap-3">
          <button
            onClick={handlePickFiles}
            disabled={!canAddMore}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
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
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 resize-none border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500 max-h-[160px]"
            rows={1}
          />

          <button
              onClick={handleSubmit}
              disabled={!canGenerate}
              className="p-2.5 bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white rounded-xl transition-colors flex items-center gap-1"
              title="生成"
            >
              <Sparkles className="w-5 h-5" />
            </button>
        </div>
      </div>
    </div>
  );
}
