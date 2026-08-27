/**
 * Mermaid 图表块：```mermaid 代码块的专用渲染组件。
 *
 * 会话内呈现为与代码块一致的卡片（顶栏 = 语言标签 + 操作按钮，主体 = 图表预览），
 * 点击预览打开全屏查看器（支持捏合/滚轮缩放），可下载 Mermaid 源码（.mmd）或 PNG。
 *
 * 主题适配：监听 documentElement 的 data-mode 属性，亮色用 mermaid "default" 主题、
 * 暗色用 "dark" 主题，切换后自动重新渲染。
 *
 * 流式中（代码还不完整）与渲染失败时只显示源码，不做图表渲染。
 *
 * mermaid 通过动态 import 按需加载（独立 chunk），不含图表的会话不会付出体积代价。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, FileCode2, Loader2, Maximize2, TriangleAlert, X } from 'lucide-react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import Toast from '../common/Toast';
import { saveImageToDevice, SAVE_SHARE_CANCELED } from '../../services/imageContextActions';

/* ─── mermaid 懒加载（模块级单例，全局只加载一次） ─── */
type MermaidLib = typeof import('mermaid').default;
let mermaidLoader: Promise<MermaidLib> | null = null;
function loadMermaid(): Promise<MermaidLib> {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then(m => m.default);
  }
  return mermaidLoader;
}

/** 已应用的主题；只在亮/暗切换时重新 initialize，避免重复初始化 */
let mermaidThemeApplied: string | null = null;
function applyMermaidTheme(mm: MermaidLib, mode: 'light' | 'dark'): void {
  const theme = mode === 'light' ? 'default' : 'dark';
  if (mermaidThemeApplied === theme) return;
  mm.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  mermaidThemeApplied = theme;
}

/** render 用的全局递增 id：mermaid.render 要求 id 唯一，重复会渲染失败 */
let mermaidIdSeq = 0;

/* ─── 亮/暗模式订阅：设置面板直接改 documentElement.dataset.mode，这里监听属性变化 ─── */
function useColorMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.mode === 'light' ? 'light' : 'dark')
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMode(document.documentElement.dataset.mode === 'light' ? 'light' : 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

/* ─── 复制文本：优先 Clipboard API，兜底 textarea + execCommand（移动端 WebView） ─── */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 继续走兜底
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * SVG 标记 → PNG data URL。
 * 按 viewBox 原始尺寸 2 倍分辨率光栅化，背景填当前主题背景色，
 * 保证导出的图在相册/文件管理器里打开与 App 内观感一致。
 */
async function svgToPngDataUrl(svgMarkup: string, bgColor: string): Promise<string> {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const svgEl = doc.documentElement as unknown as SVGSVGElement;
  const vb = svgEl.viewBox?.baseVal;
  const width = vb && vb.width > 0 ? vb.width : 800;
  const height = vb && vb.height > 0 ? vb.height : 600;
  // 画布绘制需要明确的 width/height 属性；同时移除渲染期 max-width 约束
  svgEl.setAttribute('width', String(width));
  svgEl.setAttribute('height', String(height));
  svgEl.removeAttribute('style');
  const xml = new XMLSerializer().serializeToString(svgEl);
  const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 光栅化失败'));
      img.src = svgUrl;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

interface MermaidBlockProps {
  code: string;
  /** 流式中：只展示源码。此时代码不完整，渲染必然失败且无意义 */
  streaming?: boolean;
}

export default function MermaidBlock({ code, streaming = false }: MermaidBlockProps) {
  const mode = useColorMode();
  /** 渲染结果快照：带对应的源码，代码变化后旧结果自动作废（回到加载中），
   *  避免在 effect 里同步 setState 重置状态 */
  const [result, setResult] = useState<{ code: string; svg?: string; failed?: boolean } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 渲染图表：代码 / 亮暗模式变化时重新执行；流式中跳过。
  // setState 只发生在异步回调里（旧结果靠 code 比对作废），不在 effect 体同步调
  useEffect(() => {
    if (streaming) return;
    let cancelled = false;
    (async () => {
      try {
        const mm = await loadMermaid();
        applyMermaidTheme(mm, mode);
        await mm.parse(code);
        const { svg: rendered } = await mm.render(`mermaid-block-${++mermaidIdSeq}`, code);
        if (!cancelled) setResult({ code, svg: rendered });
      } catch {
        // 语法错误 / 渲染失败：退回源码展示，内容不丢
        if (!cancelled) setResult({ code, failed: true });
      }
    })();
    return () => { cancelled = true; };
  }, [code, mode, streaming]);

  // 快照只对应当前代码且不在流式中才有效，否则视为加载中 / 待渲染
  const fresh = !streaming && result?.code === code ? result : null;
  const svg = fresh?.svg ?? null;
  const renderFailed = !!fresh?.failed;

  useEffect(
    () => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); },
    []
  );

  // 查看器打开时：Esc 关闭（桌面习惯）
  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerOpen]);

  // Android 壳返回键：查看器打开时消费 back-requested 关闭（而非最小化 App），与图片查看器一致
  useEffect(() => {
    if (!viewerOpen) return;
    const onBackRequested = (e: Event) => {
      e.preventDefault();
      setViewerOpen(false);
    };
    window.addEventListener('back-requested', onBackRequested);
    return () => window.removeEventListener('back-requested', onBackRequested);
  }, [viewerOpen]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  const handleCopy = async () => {
    const ok = await copyText(code);
    showToast(ok ? '已复制到剪贴板' : '复制失败，请重试', ok ? 'success' : 'error');
    if (ok) {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadSource = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.mmd';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showToast('已下载 Mermaid 源码');
  };

  const handleDownloadPng = async () => {
    if (!svg || downloading) return;
    setDownloading(true);
    try {
      // 背景取当前主题背景色：导出图观感与 App 内一致
      const bg = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-bg-primary').trim() || '#ffffff';
      const dataUrl = await svgToPngDataUrl(svg, bg);
      // 与聊天图片同一套保存链路：Android 进相册 / iOS 系统分享 / PC 浏览器下载
      await saveImageToDevice(dataUrl, 'mermaid-diagram');
      showToast('图片已保存');
    } catch (e) {
      // 用户在系统分享面板取消不算失败
      if (e instanceof Error && e.message === SAVE_SHARE_CANCELED) return;
      showToast('保存图片失败，请重试', 'error');
    } finally {
      setDownloading(false);
    }
  };

  /** 顶栏操作按钮（卡片与全屏查看器共用样式） */
  const actionBtnCls = 'flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-gray-200 hover:bg-white/5 active:bg-white/10 transition-colors disabled:opacity-40';

  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      <div className="relative group rounded-lg overflow-hidden my-3 border border-gray-700">
        {/* 顶部栏：语言标签 + 操作按钮（与 CodeBlock 一致的结构） */}
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-code-bg)] text-xs text-gray-400">
          <span>mermaid</span>
          <div className="flex items-center gap-1">
            <button onClick={handleCopy} className={actionBtnCls} title="复制源码" aria-label="复制源码">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button onClick={handleDownloadSource} className={actionBtnCls} title="下载 Mermaid 源码" aria-label="下载 Mermaid 源码">
              <FileCode2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleDownloadPng} disabled={!svg || downloading} className={actionBtnCls} title="下载 PNG" aria-label="下载 PNG">
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            </button>
            {svg && !streaming && (
              <button onClick={() => setViewerOpen(true)} className={actionBtnCls} title="查看大图" aria-label="查看大图">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 主体：渲染成功 = 图表预览（点开大图）；流式中 / 渲染失败 = 源码 */}
        {svg && !streaming ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="查看大图"
            className="mermaid-inline cursor-zoom-in bg-[var(--color-bg-primary)] px-4 py-3 transition-colors hover:bg-[var(--color-bg-secondary)]"
            onClick={() => setViewerOpen(true)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setViewerOpen(true); }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <>
            {renderFailed && (
              <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-amber-400/90 bg-[var(--color-code-bg)] border-t border-gray-700/50">
                <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0" />
                <span>图表渲染失败，显示源码</span>
              </div>
            )}
            {!renderFailed && !streaming && (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-gray-400 bg-[var(--color-bg-primary)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>正在渲染图表…</span>
              </div>
            )}
            <pre className="!m-0 !rounded-none !bg-[var(--color-code-bg)]">
              <code className="block px-4 py-3 overflow-x-auto text-sm !bg-transparent">{code}</code>
            </pre>
          </>
        )}
      </div>

      {/* 全屏查看器：大图 + 缩放 + 下载入口 */}
      {viewerOpen && svg && createPortal(
        <div
          className="fixed inset-0 z-[220] bg-[var(--color-bg-base)] flex flex-col touch-none overscroll-none"
          onClick={() => setViewerOpen(false)}
        >
          {/* 顶栏：标题 + 下载 + 关闭 */}
          <div
            className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)] flex-shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <span className="px-1 text-sm font-medium text-[var(--color-text-primary)]">Mermaid 图表</span>
            <div className="flex items-center gap-1">
              <button onClick={handleDownloadSource} className={actionBtnCls} title="下载 Mermaid 源码" aria-label="下载 Mermaid 源码">
                <FileCode2 className="w-5 h-5" />
              </button>
              <button onClick={handleDownloadPng} disabled={downloading} className={actionBtnCls} title="下载 PNG" aria-label="下载 PNG">
                {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              </button>
              <button onClick={() => setViewerOpen(false)} className={actionBtnCls} title="关闭" aria-label="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          {/* 内容区：与图片查看器同一套缩放方案（捏合/滚轮/双击） */}
          <div className="flex-1 min-h-0" onClick={e => e.stopPropagation()}>
            <TransformWrapper
              initialScale={1}
              minScale={1}
              maxScale={4}
              limitToBounds
              centerZoomedOut
              centerOnInit
              doubleClick={{ mode: 'toggle', step: 1, animationTime: 180 }}
              wheel={{ step: 0.3 }}
            >
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%' }}
              >
                <div className="mermaid-fit w-full h-full p-4" dangerouslySetInnerHTML={{ __html: svg }} />
              </TransformComponent>
            </TransformWrapper>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
