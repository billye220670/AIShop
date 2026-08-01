import { Archive, ChevronRight } from 'lucide-react';
import type { ContextSegment } from '../../types';

interface CompactionMarkerProps {
  segment: ContextSegment;
  onOpen: () => void;
}

/**
 * 插在消息流中的压缩标记。
 *
 * 刻意做得轻——它不是警告，只是一条说明。下方的原文仍然完整可见，
 * 这条标记只表示「这一段发给模型时用的是摘要」。
 */
export default function CompactionMarker({ segment, onOpen }: CompactionMarkerProps) {
  const saved = Math.max(0, segment.tokensBefore - segment.tokensAfter);
  const savedLabel = saved >= 1000 ? `${(saved / 1000).toFixed(1)}k` : String(saved);

  return (
    <div className="flex items-center gap-2 my-3 px-1">
      <div className="h-px flex-1 bg-white/10" />
      <button
        type="button"
        onClick={onOpen}
        aria-label={`查看已压缩的 ${segment.messageCount} 条消息的摘要`}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-400 hover:text-white hover:bg-white/10 active:bg-white/15 transition-colors"
      >
        <Archive className="w-3 h-3 flex-shrink-0" />
        <span>
          以上 {segment.messageCount} 条已压缩 · 省约 {savedLabel} tokens
        </span>
        {segment.userEdited && (
          <span className="text-[var(--color-accent)]">· 已编辑</span>
        )}
        <ChevronRight className="w-3 h-3 flex-shrink-0" />
      </button>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}
