import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Star, X, ArrowLeft, Loader2, Pencil, Trash2, FileText, Image as ImageIcon, LayoutTemplate, Download, MoreHorizontal, Check } from 'lucide-react';
import { isNativePlatform } from '../../platform/capabilities';
import { useDeviceMode } from '../../platform/useDeviceMode';
import type { AssetItem } from '../../types';
import { haptic } from '../../utils/haptics';
import PromptModal from '../common/PromptModal';
import ConfirmModal from '../common/ConfirmModal';
import BlobImage from '../common/BlobImage';
import ImageViewer from '../common/ImageViewer';
import { useBlobUrl } from '../../hooks/useBlobUrl';
import { getBlob, parseBlobRefUrl } from '../../db';

interface LibraryPanelProps {
  assets: AssetItem[];
  /** 已隐藏会话的 id 集合；开关关闭时据此过滤隐藏会话的产物 */
  hiddenConvIds?: Set<string>;
  onRemoveAsset: (id: string) => void;
  onRenameAsset: (id: string, newTitle: string) => void;
}

type KindFilter = 'all' | AssetItem['kind'];

// 右上角三点菜单内的筛选项（按展示顺序：全部、应用、图片、文档；隐藏独立于类型筛选）
const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'artifact', label: '应用' },
  { id: 'image', label: '图片' },
  { id: 'markdown', label: '文档' },
];

const KIND_META: Record<AssetItem['kind'], { label: string; Icon: typeof FileText }> = {
  artifact: { label: '应用', Icon: LayoutTemplate },
  markdown: { label: '文档', Icon: FileText },
  image: { label: '图片', Icon: ImageIcon },
};

function kindLabel(kind: AssetItem['kind']): string {
  return KIND_META[kind].label;
}

/** 触发下载（与图片页同一套：aishop-blob: 地址先取出 blob 建临时 URL） */
async function triggerDownload(url: string, name: string): Promise<void> {
  const blobId = parseBlobRefUrl(url);
  let href = url;
  let temporary = false;
  if (blobId) {
    const record = await getBlob(blobId);
    if (!record) return;
    href = URL.createObjectURL(record.blob);
    temporary = true;
  }
  try {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (temporary) setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
}

/** markdown 预览：只读阅读视图 */
function MarkdownPreviewView({ asset, onDownload }: { asset: AssetItem; onDownload: () => void }) {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="prose prose-invert max-w-none prose-headings:text-gray-100 prose-p:text-gray-200 prose-strong:text-white prose-code:text-blue-300 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-transparent prose-pre:border-none prose-pre:p-0 prose-a:text-blue-400 prose-li:text-gray-200 prose-blockquote:border-gray-600 prose-blockquote:text-gray-300 prose-th:text-gray-200 prose-td:text-gray-300 prose-hr:border-gray-700">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            urlTransform={(url) => url}
          >
            {asset.content ?? ''}
          </ReactMarkdown>
        </div>
        <button
          onClick={onDownload}
          className="mt-6 flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] text-gray-300 transition-colors"
        >
          <Download className="w-4 h-4" />
          下载 Markdown
        </button>
      </div>
    </div>
  );
}

/** 图片资产全屏预览（与聊天同一套 ImageViewer 手势）：库卡片点开图片直接走这里 */
function ImageViewerAsset({ asset, onClose }: { asset: AssetItem; onClose: () => void }) {
  const src = useBlobUrl(asset.urls?.[0] ?? '');
  return src ? <ImageViewer src={src} alt={asset.title} onClose={onClose} /> : null;
}

/** 预览内容分发：artifact 走 iframe，markdown 走阅读视图（图片资产点开直接全屏 ImageViewer，不经过详情页） */
function PreviewBody({ asset }: { asset: AssetItem }) {
  const safeName = asset.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'asset';
  if (asset.kind === 'artifact' && asset.artifact) {
    return (
      <iframe
        srcDoc={asset.artifact.code}
        sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups allow-modals allow-pointer-lock"
        allow="camera; microphone; fullscreen; clipboard-write; clipboard-read; autoplay; geolocation; accelerometer; gyroscope"
        className="w-full h-full border-0 bg-white"
        title={asset.title}
      />
    );
  }
  return (
    <MarkdownPreviewView
      asset={asset}
      onDownload={() => {
        if (!asset.content) return;
        const blob = new Blob([asset.content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.md`;
        a.click();
        URL.revokeObjectURL(url);
      }}
    />
  );
}

export default function LibraryPanel({ assets, hiddenConvIds, onRemoveAsset, onRenameAsset }: LibraryPanelProps) {
  // 类型多选筛选：集合只存具体类型，空集合 = 全部
  const [selectedKinds, setSelectedKinds] = useState<Set<AssetItem['kind']>>(new Set());
  // 右上角三点筛选菜单是否展开
  const [menuOpen, setMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [previewItem, setPreviewItem] = useState<AssetItem | null>(null);
  // 是否显示隐藏会话的产物：默认不勾（切换 tab 会重新挂载组件，state 随之重置，必须每次手动勾选）
  const [showHidden, setShowHidden] = useState(false);
  // 图片资产点开直接全屏预览（ImageViewer），不经过详情页
  const [imageViewerAsset, setImageViewerAsset] = useState<AssetItem | null>(null);
  const [isEntering, setIsEntering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 桌面端预览为沉浸式（悬浮返回按钮 + Esc 关闭），移动端保持顶部导航栏式返回
  const isDesktop = useDeviceMode() === 'desktop';

  // 长按上下文菜单
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AssetItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetItem | null>(null);

  // 长按逻辑
  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** 长按已触发，记录时间戳用于吞掉紧随其后的合成 click。
   *  用时间戳而不是布尔：长按后的合成 click 往往被遮罩接住（不落在卡片上），
   *  布尔标志会残留到下一次普通点击，把那次点击误吞成"没反应"。 */
  const suppressClickRef = useRef(0);
  const SUPPRESS_WINDOW_MS = 500;
  /** 菜单弹出时刻。长按松手瞬间的合成 click 会命中刚覆盖全屏的遮罩，
   *  不吞掉的话菜单弹出即被自己关闭。 */
  const menuOpenedAtRef = useRef(0);

  const visibleAssets = assets.filter(a => {
    // 类型多选：集合为空 = 全部；否则命中任一选中类型
    if (selectedKinds.size > 0 && !selectedKinds.has(a.kind)) return false;
    // 隐藏未勾选（默认）时过滤掉隐藏会话的产物；
    // 无会话标记的历史资产（convId 为空）不在隐藏集合里，不受影响
    if (!showHidden && a.convId && hiddenConvIds?.has(a.convId)) return false;
    return true;
  });

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressOriginRef.current = null;
  };

  const handlePressStart = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearPressTimer();
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      suppressClickRef.current = Date.now();
      menuOpenedAtRef.current = Date.now();
      setMenuOpenId(id);
      window.getSelection?.()?.removeAllRanges();
      haptic();
    }, LONG_PRESS_MS);
  };

  const handlePressMove = (e: React.PointerEvent) => {
    const origin = pressOriginRef.current;
    if (!origin || !pressTimerRef.current) return;
    const dx = Math.abs(e.clientX - origin.x);
    const dy = Math.abs(e.clientY - origin.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
      clearPressTimer();
    }
  };

  useEffect(() => () => clearPressTimer(), []);

  // 三点筛选菜单：点击面板/按钮外部关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = () => setMenuOpenId(null);
    document.addEventListener('click', handleClick);
    document.addEventListener('pointerdown', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('pointerdown', handleClick);
    };
  }, [menuOpenId]);

  const handleClose = () => {
    setIsEntering(false);
    // 等待动画结束后再真正关闭
    setTimeout(() => {
      setPreviewItem(null);
      setIsLoading(false);
    }, 300);
  };

  // 桌面端：Esc 关闭预览。
  // - Web 下 window keydown 已够用（焦点不在 iframe 内时）
  // - Electron 下焦点可能落在 iframe 内部，页面收不到键盘事件，改由主进程
  //   before-input-event 捕获 Escape 后经 IPC 转发（onAppEscape）
  useEffect(() => {
    if (!previewItem || !isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const unsubscribe = window.electronAPI?.onAppEscape?.(handleClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      unsubscribe?.();
    };
  }, [previewItem, isDesktop]);

  const handleOpenPreview = (item: AssetItem) => {
    setPreviewItem(item);
    setIsLoading(item.kind === 'artifact');
    // 下一帧触发进入动画
    requestAnimationFrame(() => {
      setIsEntering(true);
    });
    // 延迟隐藏loading（给iframe时间加载）
    if (item.kind === 'artifact') {
      setTimeout(() => {
        setIsLoading(false);
      }, 800);
    }
  };

  // Preview 模式
  if (previewItem) {
    const MetaIcon = KIND_META[previewItem.kind].Icon;
    return (
      <div
        className={`fixed inset-0 z-[100] bg-[var(--color-bg-base)] flex flex-col transition-transform duration-300 ease-out ${
          isEntering ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ pointerEvents: isEntering ? 'auto' : 'none' }}
      >
        {/* 顶部导航栏：仅移动端显示；桌面端为沉浸式预览，返回按钮悬浮在内容左上角 */}
        {!isDesktop && (
          <div
            className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-[var(--color-bg-primary)]"
            style={{
              // 原生壳（Capacitor）edge-to-edge：预览 fixed 全屏覆盖，不经过 MainLayout，
              // 需自身避让系统状态栏（高度由 MainActivity 注入的 --native-inset-top 提供）
              ...(isNativePlatform() ? { paddingTop: 'var(--native-inset-top, var(--status-bar-height, env(safe-area-inset-top)))' } : {}),
            }}
          >
            {/* 左侧：返回按钮 */}
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/10"
              title="返回"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {/* 中间：标题 */}
            <h1 className="absolute left-1/2 -translate-x-1/2 text-white font-medium text-base truncate max-w-[60%] flex items-center gap-1.5">
              <MetaIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
              {previewItem.title}
            </h1>

            {/* 右侧：占位保持布局平衡 */}
            <div className="w-9" />
          </div>
        )}

        {/* 内容 */}
        <div className="flex-1 overflow-hidden relative">
          {isLoading && (
            <div className="absolute inset-0 bg-[var(--color-bg-base)] flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
                <span className="text-sm text-gray-400">加载中...</span>
              </div>
            </div>
          )}
          {/* 桌面端：左上角悬浮返回按钮（Esc 等效）。
              Electron 中顶栏 52px 为 -webkit-app-region: drag 拖拽区，会拦截覆盖其上的
              （含更高 z-index 的）元素鼠标事件，必须显式声明 no-drag 才能点击 */}
          {isDesktop && (
            <button
              onClick={handleClose}
              className="absolute top-4 left-4 z-20 p-2.5 rounded-full bg-black/50 hover:bg-black/70 text-white shadow-lg backdrop-blur-sm transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="返回（Esc）"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <PreviewBody asset={previewItem} />
        </div>
      </div>
    );
  }

  // Gallery 模式
  return (
    <>
      <div className="flex flex-col h-full bg-[var(--color-bg-base)] overflow-hidden">
        {/* 顶部标题 */}
        <div className="px-4 py-3 bg-[var(--color-bg-base)] flex items-center justify-between">
          <h2 className="text-white font-medium text-lg">我的库</h2>
          {/* 三点筛选菜单：类型多选 + 隐藏开关集中管理 */}
          <div ref={filterMenuRef} className="relative">
            <button
              type="button"
              aria-label="筛选"
              title="筛选"
              onClick={() => { haptic(); setMenuOpen(v => !v); }}
              className="w-9 h-9 rounded-full bg-[var(--color-bg-primary)] flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 z-[160] w-44 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2">
                {KIND_FILTERS.map(f => {
                  const active = f.id === 'all' ? selectedKinds.size === 0 : selectedKinds.has(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        haptic();
                        if (f.id === 'all') {
                          setSelectedKinds(new Set());
                        } else {
                          const kind = f.id as AssetItem['kind'];
                          setSelectedKinds(prev => {
                            const next = new Set(prev);
                            if (next.has(kind)) next.delete(kind);
                            else next.add(kind);
                            return next;
                          });
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                        active
                          ? 'text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                      }`}
                    >
                      <span>{f.label}</span>
                      {active && <Check className="w-4 h-4 text-[var(--color-accent)] ml-auto" />}
                    </button>
                  );
                })}
                <div className="h-px bg-white/10 my-1" />
                <button
                  type="button"
                  onClick={() => { haptic(); setShowHidden(v => !v); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    showHidden
                      ? 'text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  <span>隐藏</span>
                  {showHidden && <Check className="w-4 h-4 text-[var(--color-accent)] ml-auto" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 长按呼出上下文菜单时的背景模糊遮罩 */}
        {menuOpenId && (
          <div
            className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay"
            onClick={() => {
              // 长按松手后的合成 click target 会被刚覆盖全屏的遮罩接住，
              // 不吞掉的话菜单弹出即被自己关闭
              if (Date.now() - menuOpenedAtRef.current < 500) return;
              setMenuOpenId(null);
            }}
            onPointerDown={() => setMenuOpenId(null)}
          />
        )}

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto p-4">
          {visibleAssets.length === 0 ? (
            /* 空状态 */
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Star className="w-12 h-12 text-gray-600 mb-3" />
              <p className="text-gray-500 text-sm">
                {selectedKinds.size === 0
                  ? '还没有保存的内容，对话中收藏应用、保存文档或图片后会出现在这里'
                  : selectedKinds.size === 1
                    ? `还没有${kindLabel([...selectedKinds][0])}，去对话或图片页保存一个吧`
                    : '还没有符合筛选条件的内容，去对话或图片页保存一个吧'}
              </p>
            </div>
          ) : (
            /* 网格布局 */
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleAssets.map(item => {
                const isMenuOpen = menuOpenId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`group relative rounded-xl overflow-hidden bg-[var(--color-bg-secondary)] shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer select-none [-webkit-touch-callout:none] [-webkit-user-select:none] ${
                      isMenuOpen ? 'relative z-[201] context-menu-pop' : ''
                    }`}
                    onPointerDown={e => handlePressStart(item.id, e)}
                    onPointerMove={handlePressMove}
                    onPointerUp={clearPressTimer}
                    onPointerCancel={clearPressTimer}
                    onPointerLeave={clearPressTimer}
                    onContextMenu={e => e.preventDefault()}
                    onTouchStart={e => {
                      // 阻止触摸默认行为（如长按选择文本、保存图片等）
                      if (e.touches.length === 1) {
                        e.preventDefault();
                      }
                    }}
                    onDragStart={e => e.preventDefault()}
                    onClick={() => {
                      if (Date.now() - suppressClickRef.current < SUPPRESS_WINDOW_MS) {
                        suppressClickRef.current = 0;
                        return;
                      }
                      // 图片资产点开直接全屏预览（与聊天同一套手势），应用/文档仍走详情页
                      if (item.kind === 'image') {
                        setImageViewerAsset(item);
                        return;
                      }
                      handleOpenPreview(item);
                    }}
                  >
                    {/* 缩略图区 - 1:1 */}
                    <div className="aspect-square overflow-hidden pointer-events-none flex items-center justify-center">
                      {item.kind === 'markdown' ? (
                        <div className="w-full h-full p-3">
                          <p className="text-xs text-[var(--color-text-secondary)] break-all leading-snug">
                            {item.content}
                          </p>
                        </div>
                      ) : item.thumbnail ? (
                        <BlobImage
                          src={item.thumbnail}
                          alt={item.title}
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-[var(--color-text-secondary)]" />
                      )}
                    </div>

                    {/* 底部标题 */}
                    <div className="px-3 py-3 pointer-events-none">
                      <p className="text-sm text-[var(--color-text-primary)] truncate font-medium">
                        {item.title}
                      </p>
                    </div>

                    {/* 悬浮移除按钮 - 非菜单打开时显示 */}
                    {!isMenuOpen && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveAsset(item.id);
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-red-500/80 opacity-0 group-hover:opacity-100 transition-all duration-200"
                        title="移除"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* 浮动菜单 */}
                    {isMenuOpen && (
                      <div
                        className="absolute right-2 top-2 z-[200] w-40 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2 select-none context-menu-pop"
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setRenameTarget(item);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
                        >
                          <Pencil className="w-4 h-4 flex-shrink-0" />
                          <span>重命名</span>
                        </button>
                        {/* 图片直接全屏预览后没有详情页下载入口，下载挪到长按菜单 */}
                        {item.kind === 'image' && (
                          <button
                            onClick={() => {
                              const url = item.urls?.[0];
                              if (url) {
                                const safeName = item.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'asset';
                                void triggerDownload(url, `${safeName}.png`);
                              }
                              setMenuOpenId(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
                          >
                            <Download className="w-4 h-4 flex-shrink-0" />
                            <span>下载图片</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setDeleteTarget(item);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 active:bg-white/10 hover:bg-white/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4 flex-shrink-0" />
                          <span>删除</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 重命名弹窗 */}
      <PromptModal
        open={renameTarget !== null}
        title={`重命名${renameTarget ? kindLabel(renameTarget.kind) : ''}`}
        initialValue={renameTarget?.title ?? ''}
        placeholder="新标题"
        confirmText="保存"
        cancelText="取消"
        maxLength={50}
        onConfirm={value => {
          if (renameTarget) {
            onRenameAsset(renameTarget.id, value);
          }
          setRenameTarget(null);
        }}
        onCancel={() => setRenameTarget(null)}
      />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={deleteTarget !== null}
        title={`删除${deleteTarget ? kindLabel(deleteTarget.kind) : ''}`}
        message={`确定要从我的库删除「${deleteTarget?.title ?? ''}」吗？此操作无法撤销。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (deleteTarget) onRemoveAsset(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 图片资产全屏预览（与聊天同一套手势/关闭逻辑） */}
      {imageViewerAsset && (
        <ImageViewerAsset asset={imageViewerAsset} onClose={() => setImageViewerAsset(null)} />
      )}
    </>
  );
}
