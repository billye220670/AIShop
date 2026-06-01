import { useState, useRef, useCallback, useEffect } from 'react';
import { Code, Eye, RefreshCw, Copy, Download, X, Check, Globe } from 'lucide-react';
import type { ArtifactBlock } from '../../types';

interface ArtifactPanelProps {
  artifact: ArtifactBlock;
  onClose: () => void;
  isGenerating?: boolean;
  autoPreviewSignal?: number;
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

export default function ArtifactPanel({ artifact, onClose, isGenerating = false, autoPreviewSignal = 0 }: ArtifactPanelProps) {
  const [mode, setMode] = useState<ViewMode>('code');
  const [copied, setCopied] = useState(false);
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
    <div className="flex flex-col h-full bg-[#0d0a1a] overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-[#1a1a2e]">
        {/* 左侧：图标 + 标题 + 刷新按钮 */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
            <Globe className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-medium text-sm truncate">{artifact.title}</span>
          {mode === 'preview' && (
            <button
              onClick={handleRefresh}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10 flex-shrink-0"
              title="刷新预览"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 右侧：模式切换 + 操作按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 模式切换下拉 */}
          <div className="flex items-center bg-[#0d0a1a] rounded-lg p-0.5">
            <button
              onClick={() => setMode('code')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'code'
                  ? 'bg-[rgb(127,96,255)] text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              代码
            </button>
            <button
              onClick={() => !isGenerating && setMode('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'preview'
                  ? 'bg-[rgb(127,96,255)] text-white'
                  : isGenerating
                    ? 'text-gray-600 cursor-not-allowed'
                    : 'text-gray-400 hover:text-gray-200'
              }`}
              title={isGenerating ? '代码生成中，完成后可预览' : ''}
            >
              <Eye className="w-3.5 h-3.5" />
              预览
            </button>
          </div>

          {/* 复制按钮 */}
          <button
            onClick={handleCopy}
            className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10"
            title="复制代码"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* 下载按钮 */}
          <button
            onClick={handleDownload}
            className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10"
            title="下载 HTML"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden relative">
        {mode === 'code' ? (
          <pre ref={codeContainerRef} className="h-full overflow-auto bg-[#161b22] text-sm font-mono leading-relaxed p-4">
            <code
              className="art-code-highlight"
              dangerouslySetInnerHTML={{
                __html: highlightHtml(escapeHtml(artifact.code)),
              }}
            />
            {isGenerating && (
              <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5 align-middle" />
            )}
            <style>{`
              .art-code-highlight { color: #e4e4e7; border-radius: 0; padding: 0; background: transparent; }
              .art-tag { color: rgb(127, 96, 255); }
              .art-attr { color: #93c5fd; }
              .art-val { color: #86efac; }
              .art-comment { color: #6b7280; font-style: italic; }
            `}</style>
          </pre>
        ) : (
          <iframe
            ref={iframeRef}
            srcDoc={artifact.code}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-white"
            title={artifact.title}
          />
        )}
      </div>

      {/* 底部 - 仅生成中显示状态 */}
      {isGenerating && (
        <div className="px-4 py-2 border-t border-gray-700/50 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-xs text-purple-300">正在生成代码...</span>
          </div>
        </div>
      )}
    </div>
  );
}
