import { useState } from 'react';
import { Archive, Loader2, Trash2 } from 'lucide-react';
import type { UsageTotals } from '../../utils/tokenEstimate';
import type { ContextSegment } from '../../types';
import ConfirmModal from '../common/ConfirmModal';

interface ContextPanelProps {
  realUsage: UsageTotals;
  contextLimit: number;
  isCompacting: boolean;
  isAwaitingUsage: boolean;
  onCompact: () => void;
  segments?: ContextSegment[];
  onOpenSegment?: (segmentId: string) => void;
  onDeleteSegment?: (segmentId: string) => void;
  /** 面板定位类；默认移动端铺满顶栏下方，桌面布局可传入自定义定位（如靠右上浮） */
  positionClassName?: string;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/**
 * 上下文详情面板，从顶栏环按钮下方弹出。
 * 视觉上仿照长按会话项的上下文菜单：背景虚焦，只有环和本面板保持清晰。
 */
export default function ContextPanel({
  realUsage,
  contextLimit,
  isCompacting,
  isAwaitingUsage,
  onCompact,
  segments = [],
  onOpenSegment,
  onDeleteSegment,
  positionClassName,
}: ContextPanelProps) {
  // 最近的排在最上面，方便一眼看到最新一次压缩
  const sortedSegments = [...segments].sort((a, b) => b.createdAt - a.createdAt);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const hasData = realUsage.measuredTurns > 0;
  const used = realUsage.lastPromptTokens;
  const ratio = contextLimit > 0 ? used / contextLimit : 0;
  const pct = Math.round(ratio * 100);

  const numberTone =
    ratio >= 0.9
      ? 'text-red-400'
      : ratio >= 0.7
        ? 'text-amber-400'
        : 'text-[var(--color-accent)]';

  const barTone =
    ratio >= 0.9 ? 'bg-red-400' : ratio >= 0.7 ? 'bg-amber-400' : 'bg-[var(--color-accent)]';

  return (
    <div
      className={`${positionClassName ?? 'absolute left-3 right-3 top-14 sm:right-auto sm:w-80'} bg-[var(--color-bg-elevated)] rounded-2xl shadow-2xl z-[200] context-menu-pop`}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="p-4">
        {hasData ? (
          <>
            {/* 占用率 */}
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs text-gray-500">当前占用</span>
              <span className={`text-2xl font-bold tabular-nums ${numberTone}`}>{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${barTone}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-xs text-gray-600 tabular-nums">
              <span>{formatTokens(used)}</span>
              <span>{formatTokens(contextLimit)}</span>
            </div>

            {/* 立即压缩 */}
            {isCompacting ? (
              <div className="mt-4 flex items-center justify-center gap-2 py-2.5 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                压缩中…
              </div>
            ) : (
              // 测试阶段不按 compactable 禁用，任何水位都能手动触发，方便观察行为。
              // 上线前可恢复 disabled={!compactable}（冷区间不足 4 条时压缩没有收益）。
              <button
                type="button"
                onClick={onCompact}
                className="mt-4 w-full py-2.5 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-foreground)] text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80"
              >
                立即压缩
              </button>
            )}

            {/* 历史压缩记录 */}
            {sortedSegments.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/10">
                <div className="text-xs text-gray-500 mb-2">已压缩 {sortedSegments.length} 次</div>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {sortedSegments.map(seg => {
                    const saved = Math.max(0, seg.tokensBefore - seg.tokensAfter);
                    const savedLabel = saved >= 1000 ? `${(saved / 1000).toFixed(1)}k` : String(saved);
                    return (
                      <div
                        key={seg.id}
                        className="flex items-center gap-1 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenSegment?.(seg.id)}
                          className="flex-1 flex items-center gap-2 px-2.5 py-2 text-left text-xs text-gray-400 hover:text-white transition-colors min-w-0"
                        >
                          <Archive className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="flex-1 truncate">
                            {seg.messageCount} 条消息 · 省约 {savedLabel} tokens
                          </span>
                          {seg.userEdited && <span className="text-[var(--color-accent)] flex-shrink-0">已编辑</span>}
                        </button>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setPendingDeleteId(seg.id);
                          }}
                          aria-label="删除这次压缩"
                          className="p-2 text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-6 text-center text-sm text-gray-600">
            {isAwaitingUsage ? '等待用量数据…' : '暂无用量数据'}
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingDeleteId !== null}
        title="删除这次压缩"
        message="将永久删除这段摘要，恢复为逐字发送原文，且不可撤销。上下文占用会随之增加。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          if (pendingDeleteId) onDeleteSegment?.(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
