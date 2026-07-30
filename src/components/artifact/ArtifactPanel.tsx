import { useState, useRef, useCallback, useEffect } from 'react';
import { Code, Eye, RefreshCw, Copy, Download, X, Check, Globe, Star, Loader2, ArrowLeft } from 'lucide-react';
import html2canvas from 'html2canvas';
import type { ArtifactBlock } from '../../types';

interface ArtifactPanelProps {
  artifact: ArtifactBlock;
  onClose: () => void;
  isGenerating?: boolean;
  autoPreviewSignal?: number;
  isFavorite?: boolean;
  onToggleFavorite?: (thumbnail?: string) => void;
}

type ViewMode = 'code' | 'preview';

/* 简易 HTML 语法着色 */
function highlightHtml(code: string): string {
  return code
    // 注释
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="art-comment">$1</span>')
    // 标签名
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="art-tag">$2</span>')
    // 属性名="值"
    .replace(/([\w-]+)(=)("(?:[^"\\]|\\.)*")/g, '<span class="art-attr">$1</span>$2<span class="art-val">$3</span>')
    // 属性名='值'
    .replace(/([\w-]+)(=)('(?:[^'\\]|\\.)*')/g, '<span class="art-attr">$1</span>$2<span class="art-val">$3</span>');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function captureArtifactThumbnail(iframe: HTMLIFrameElement): Promise<string> {
  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc || !iframeDoc.body) throw new Error('Cannot access iframe');

  const canvas = await html2canvas(iframeDoc.body, {
    width: 800,
    height: 800,
    windowWidth: 800,
    windowHeight: 800,
    useCORS: true,
    logging: false,
  });

  // 裁剪为 1:1 正方形并缩小
  const size = 400;
  const resizedCanvas = document.createElement('canvas');
  resizedCanvas.width = size;
  resizedCanvas.height = size;
  const ctx = resizedCanvas.getContext('2d')!;
  // 取原始 canvas 的中央正方形区域
  const sourceSize = Math.min(canvas.width, canvas.height);
  const sx = (canvas.width - sourceSize) / 2;
  const sy = 0; // 从顶部开始截取
  ctx.drawImage(canvas, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

  return resizedCanvas.toDataURL('image/jpeg', 0.7);
}

export default function ArtifactPanel({ artifact, onClose, isGenerating = false, autoPreviewSignal = 0, isFavorite = false, onToggleFavorite }: ArtifactPanelProps) {
  const [mode, setMode] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codeContainerRef = useRef<HTMLPreElement>(null);
  const prevSignalRef = useRef(autoPreviewSignal);

  // 流式生成时强制代码模式
  useEffect(() => {
    if (isGenerating) {
      setMode('code');
    }
  }, [isGenerating]);

  // 流式结束信号：自动切换到预览模式
  useEffect(() => {
    if (autoPreviewSignal > 0 && autoPreviewSignal !== prevSignalRef.current) {
      setMode('preview');
    }
    prevSignalRef.current = autoPreviewSignal;
  }, [autoPreviewSignal]);

  // 代码区域自动滚动到底部（跟随新内容）
  useEffect(() => {
    if (isGenerating && codeContainerRef.current) {
      codeContainerRef.current.scrollTop = codeContainerRef.current.scrollHeight;
    }
  }, [isGenerating, artifact.code]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [artifact.code]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([artifact.code], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title || 'artifact'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [artifact]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = '';
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.srcdoc = artifact.code;
        }
      }, 50);
    }
  }, [artifact.code]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-base)] overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-[var(--color-bg-primary)]">
        {/* 左侧：返回按钮 */}
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10 flex-shrink-0"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* 中间占位 */}
        <div className="flex-1" />

        {/* 右侧：操作按钮 + 模式切换 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {mode === 'preview' && (
            <button
              onClick={handleRefresh}
              className="p-2 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10"
              title="刷新预览"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          {/* 收藏按钮 */}
          <button
            onClick={async () => {
              if (!onToggleFavorite) return;
              if (isFavorite) {
                onToggleFavorite();
              } else {
                // 截图后收藏
                try {
                  setCapturing(true);
                  if (iframeRef.current) {
                    const thumbnail = await captureArtifactThumbnail(iframeRef.current);
                    onToggleFavorite(thumbnail);
                  } else {
                    // iframe 不可用时降级为无缩略图
                    onToggleFavorite();
                  }
                } catch (e) {
                  console.error('Failed to capture thumbnail:', e);
                  onToggleFavorite();
                } finally {
                  setCapturing(false);
                }
              }
            }}
            disabled={capturing}
            className={`p-2 transition-colors rounded-md hover:bg-white/10 ${
              isFavorite ? 'text-yellow-500' : 'text-gray-400 hover:text-white'
            } ${capturing ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={isFavorite ? '取消收藏' : '收藏'}
          >
            {capturing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Star className="w-4 h-4" fill={isFavorite ? 'currentColor' : 'none'} />
            )}
          </button>

          {/* 下载按钮 */}
          <button
            onClick={handleDownload}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10"
            title="下载 HTML"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* 模式切换 - 仅图标 */}
          <div className="flex items-center bg-[var(--color-bg-base)] rounded-full px-1 py-0.5 gap-0.5">
            <button
              onClick={() => setMode('code')}
              className={`p-2 rounded-full transition-colors ${
                mode === 'code'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="代码"
            >
              <Code className="w-4 h-4" />
            </button>
            <button
              onClick={() => !isGenerating && setMode('preview')}
              className={`p-2 rounded-full transition-colors ${
                mode === 'preview'
                  ? 'bg-[var(--color-accent)] text-white'
                  : isGenerating
                    ? 'text-gray-600 cursor-not-allowed'
                    : 'text-gray-400 hover:text-gray-200'
              }`}
              title={isGenerating ? '代码生成中，完成后可预览' : '预览'}
            >
              <Eye className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden relative">
        {mode === 'code' ? (
          <pre ref={codeContainerRef} className="h-full overflow-auto bg-[var(--color-code-bg)] text-sm font-mono leading-relaxed p-4">
            <code
              className="art-code-highlight"
              dangerouslySetInnerHTML={{
                __html: highlightHtml(escapeHtml(artifact.code)),
              }}
            />
            {isGenerating && (
              <span className="inline-block w-2 h-4 bg-[var(--color-accent)] animate-pulse ml-0.5 align-middle" />
            )}
            <style>{`
              .art-code-highlight { color: #e4e4e7; border-radius: 0; padding: 0; background: transparent; }
              .art-tag { color: var(--color-accent); }
              .art-attr { color: #93c5fd; }
              .art-val { color: #86efac; }
              .art-comment { color: #6b7280; font-style: italic; }
            `}</style>
          </pre>
        ) : (
          <iframe
            ref={iframeRef}
            srcDoc={artifact.code}
            sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups allow-modals allow-pointer-lock"
            allow="camera; microphone; fullscreen; clipboard-write; clipboard-read; autoplay; geolocation; accelerometer; gyroscope"
            className="w-full h-full border-0 bg-white"
            title={artifact.title}
          />
        )}
      </div>

      {/* 底部 - 仅生成中显示状态 */}
      {isGenerating && (
        <div className="px-4 py-2 border-t border-gray-700/50 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
            <span className="text-xs text-[var(--color-accent)]">正在生成代码...</span>
          </div>
        </div>
      )}
    </div>
  );
}
