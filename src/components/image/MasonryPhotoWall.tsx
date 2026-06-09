/**
 * MasonryPhotoWall - 列式瀑布流照片墙布局组件
 *
 * 职责：
 * - 列式瀑布流排版（CSS columns 自动排列）
 * - 响应式列数（视口宽度自适应）
 * - 防布局抖动（使用占位高度 / aspect-ratio）
 * - 滚动接近底部触发无限加载
 *
 * 设计原则：
 * - 布局层（排版）与卡片层（内容渲染 + 交互）严格分离
 * - 卡片是可替换、可扩展的单元，通过 renderCard 回调渲染
 * - 不在布局层做任何与"图片"强绑定的假设
 * - 卡片的事件处理通过 props/回调向上暴露
 *
 * 实现方式：
 * - 最短列优先算法分配到 N 列，确保每列高度尽可能均匀
 * - 响应式列数根据视口宽度切换
 * - 每列使用 flexbox 纵向排列，卡片间紧密贴合无空白
 * - 图片加载前通过占位高度防布局抖动
 * - 后续可集成 IntersectionObserver 实现虚拟滚动
 */
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';

/* ============ 配置 ============ */

/** 响应式列数断点配置 */
const COLUMN_BREAKPOINTS: { minWidth: number; columns: number }[] = [
  { minWidth: 0, columns: 2 },
  { minWidth: 640, columns: 3 },
  { minWidth: 1024, columns: 4 },
  { minWidth: 1440, columns: 5 },
];

/** 默认间距（px） */
const DEFAULT_GUTTER = 3;

/* ============ 类型 ============ */

/** 照片墙数据项 - 布局层只关心宽高，不关心内容 */
export interface PhotoItem {
  id: string;
  width?: number;     // 原始宽度（用于计算宽高比，推荐提供）
  height?: number;    // 原始高度（推荐提供）
  [key: string]: unknown; // 允许扩展字段（如 type、thumbnailUrl 等）
}

/** 卡片渲染回调 - 由消费方决定卡片内容 */
export type RenderCard = (item: PhotoItem, index: number) => React.ReactNode;

/** 组件 Props */
export interface MasonryPhotoWallProps {
  items: PhotoItem[];
  renderCard: RenderCard;
  gutter?: number;
  overscan?: number;         // 预留：虚拟滚动缓冲像素数
  onNearEnd?: () => void;    // 滚动接近底部时的回调（用于无限加载）
  emptyContent?: React.ReactNode;
  scrollPaddingBottom?: number; // 滚动区域底部留白（给 overlay 内容腾空间）
}

/* ============ 工具函数 ============ */

/** 计算单张卡片高度（不含间距），基于列宽和原始宽高比 */
export function computeCardHeight(item: PhotoItem, columnWidth: number): number {
  if (item.width && item.height && item.width > 0) {
    return Math.round((columnWidth / item.width) * item.height);
  }
  // 没有宽高信息时使用正方形占位
  return columnWidth;
}

/* ============ 主组件 ============ */

export default function MasonryPhotoWall({
  items,
  renderCard,
  gutter = DEFAULT_GUTTER,
  onNearEnd,
  emptyContent,
  scrollPaddingBottom = 0,
}: MasonryPhotoWallProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // 响应式列数
  const columnCount = useMemo(() => {
    for (let i = COLUMN_BREAKPOINTS.length - 1; i >= 0; i--) {
      if (containerWidth >= COLUMN_BREAKPOINTS[i].minWidth) {
        return COLUMN_BREAKPOINTS[i].columns;
      }
    }
    return 2;
  }, [containerWidth]);

  // 列宽（用于计算占位高度）
  const columnWidth = useMemo(() => {
    if (containerWidth <= 0 || columnCount <= 0) return 200;
    return Math.floor((containerWidth - gutter * (columnCount - 1)) / columnCount);
  }, [containerWidth, columnCount, gutter]);

  // 监听容器宽度变化
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerWidth(Math.floor(el.clientWidth));

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 滚动接近底部触发加载
  const handleScroll = useCallback(() => {
    if (!onNearEnd || !scrollRef.current) return;
    const el = scrollRef.current;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 400) {
      onNearEnd();
    }
  }, [onNearEnd]);

  // 空状态
  if (items.length === 0 && emptyContent) {
    return (
      <div ref={containerRef} className="w-full h-full">
        {emptyContent}
      </div>
    );
  }

  // 将 items 分配到各列（最短列优先算法，实现真正瀑布流）
  const columns = useMemo(() => {
    const cols: { items: PhotoItem[]; originalIndices: number[] }[] =
      Array.from({ length: columnCount }, () => ({ items: [], originalIndices: [] }));
    const colHeights: number[] = Array(columnCount).fill(0);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const cardH = computeCardHeight(item, columnWidth) + gutter;
      // 找到当前最矮的列
      let minIdx = 0;
      for (let j = 1; j < columnCount; j++) {
        if (colHeights[j] < colHeights[minIdx]) minIdx = j;
      }
      cols[minIdx].items.push(item);
      cols[minIdx].originalIndices.push(i);
      colHeights[minIdx] += cardH;
    }

    return cols;
  }, [items, columnCount, columnWidth, gutter]);

  return (
    <div ref={containerRef} className="w-full h-full">
      {containerWidth > 0 && items.length > 0 && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="w-full h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          style={{ paddingBottom: scrollPaddingBottom || undefined }}
        >
          <div
            style={{
              display: 'flex',
              gap: gutter,
              alignItems: 'flex-start',
            }}
          >
            {columns.map((col, colIdx) => (
              <div
                key={colIdx}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: gutter,
                }}
              >
                {col.items.map((item, i) => {
                  const cardH = computeCardHeight(item, columnWidth);
                  return (
                    <div key={item.id} style={{ height: cardH, flexShrink: 0 }}>
                      {renderCard(item, col.originalIndices[i])}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
