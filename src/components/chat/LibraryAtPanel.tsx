import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import BlobImage from '../common/BlobImage';
import type { AssetItem } from '../../types';

interface LibraryAtPanelProps {
  /** 过滤后的资产列表 */
  items: AssetItem[];
  /** 键盘选中的项索引 */
  selectedIndex: number;
  /** 确认选中某个资产 */
  onSelect: (asset: AssetItem) => void;
  /** 鼠标悬停同步选中项 */
  onHover: (index: number) => void;
  /** 面板 DOM 引用：供调用方判断点击是否落在面板内（全局 mousedown 关闭面板用） */
  panelRef: RefObject<HTMLDivElement | null>;
  /** 定位（viewport 坐标）：left 为 @ 光标的横向坐标，bottom 使面板底边在 @ 上方 gap px 处 */
  position: { left: number; bottom: number };
}

const KIND_LABEL: Record<AssetItem['kind'], string> = {
  markdown: '文档',
  artifact: '应用',
  image: '图片',
};

/**
 * PC 端 @ 引用「我的库」资产的上浮面板（仿 AI IDE 输入框）：
 * 输入 @ 触发，标题实时过滤（含拼音匹配），无匹配时由调用方自动关闭。
 * 通过 Portal 渲染到 body 并以 fixed 定位，向上 overlay 浮动在 @ 光标上方，
 * 不被输入框任何祖先容器的 overflow 裁剪，z-[200] 处于最上层；
 * 点击项用 onMouseDown preventDefault 保住 textarea 焦点，失焦自动关闭由调用方处理。
 */
export default function LibraryAtPanel({ items, selectedIndex, onSelect, onHover, panelRef, position }: LibraryAtPanelProps) {
  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[200] w-80 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden select-none"
      style={{ left: position.left, bottom: position.bottom }}
    >
      {/* 资产列表：max-h-72 限高，超出后内部滚动；overscroll-contain 阻止滚动透传
          （滚到边界不再链式滚动父级）；scrollbar 沿用全局样式（6px 宽、--color-scrollbar-thumb、
          透明 track、hover 变 --color-scrollbar-hover），与主会话消息列表滚动条一致 */}
      <ul className="max-h-72 overflow-y-auto overscroll-contain py-1.5">
        {items.map((item, idx) => (
          <li key={item.id}>
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => onHover(idx)}
              onClick={() => onSelect(item)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                idx === selectedIndex ? 'bg-[var(--color-bg-hover)]' : ''
              }`}
            >
              {/* 缩略图：markdown 无缩略图用图标占位 */}
              {item.kind === 'markdown' ? (
                <div className="w-9 h-9 rounded-lg bg-[var(--color-accent-soft)] flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-[var(--color-accent)]" />
                </div>
              ) : item.thumbnail ? (
                <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-[var(--color-bg-secondary)]">
                  <BlobImage
                    src={item.thumbnail}
                    alt=""
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-lg bg-[var(--color-bg-secondary)] flex items-center justify-center flex-shrink-0">
                  <ImageIcon className="w-4 h-4 text-gray-400" />
                </div>
              )}

              {/* 标题 */}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--color-text-primary)] truncate">{item.title}</div>
              </div>

              {/* 类型徽标 */}
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--color-bg-secondary)] text-gray-400">
                {KIND_LABEL[item.kind]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
