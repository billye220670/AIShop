import { useRef, useState, useMemo, type KeyboardEvent, type ChangeEvent } from 'react';
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
    isGenerating,
    error,
    generate,
    cancelGeneration,
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

  const handleSubmit = async () => {
    if (isGenerating) {
      cancelGeneration();
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) return;
    await generate(trimmed);
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

  const canGenerate = prompt.trim().length > 0 && !isGenerating;
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

      {/* Error banner */}
      {(error || uploadError) && (
        <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm flex items-start gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4 mt-0.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
            />
          </svg>
          <span className="flex-1">{error || uploadError}</span>
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
        {flatCards.length === 0 && !isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-16 h-16 mb-4 text-gray-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="text-lg">输入提示词开始创作</p>
            <p className="text-sm mt-2">
              支持 GPT Image 2 / Nanobanana 2 / Nanobanana Pro，可上传参考图进行编辑
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Loading 占位 */}
            {isGenerating && (
              <div className="relative rounded-xl overflow-hidden bg-gray-800 border border-gray-700 aspect-square animate-pulse flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <svg
                    className="animate-spin w-8 h-8"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span className="text-xs">生成中…</span>
                </div>
              </div>
            )}

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
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteHistoryItem(card.id)}
                      className="w-8 h-8 flex items-center justify-center bg-red-500/80 hover:bg-red-600 text-white rounded-lg transition-colors"
                      title="删除"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
                        />
                      </svg>
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
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
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
            disabled={!canAddMore || isGenerating}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
            title={canAddMore ? '上传参考图' : `已达到最大数量 ${maxUploadCount}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
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
            disabled={isGenerating}
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 resize-none border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500 max-h-[160px] disabled:opacity-60"
            rows={1}
          />

          {isGenerating ? (
            <button
              onClick={handleSubmit}
              className="p-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors flex items-center gap-1"
              title="取消生成"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canGenerate}
              className="p-2.5 bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white rounded-xl transition-colors flex items-center gap-1"
              title="生成"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
