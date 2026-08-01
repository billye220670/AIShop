import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UsageTotals } from '../../utils/tokenEstimate';

interface ContextRingProps {
  realUsage: UsageTotals;
  /** 当前选中模型的上下文上限（分母） */
  contextLimit: number;
  isCompacting: boolean;
  /** 正在等待响应：本轮真实用量还没回来 */
  isAwaitingUsage: boolean;
  onClick: () => void;
  /** 面板是否展开（用于高亮按钮） */
  isOpen: boolean;
}

const SIZE = 18;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

/**
 * 环状上下文占用指示器，放在顶栏。
 *
 * 数字来自 API 返回的真实用量，回答结束后延迟 800ms 再开始填充，
 * 让用户有机会注意到变化（此时页面滚动也已稳定）。
 */
export default function ContextRing({
  realUsage,
  contextLimit,
  isCompacting,
  isAwaitingUsage,
  onClick,
  isOpen,
}: ContextRingProps) {
  const hasData = realUsage.measuredTurns > 0;

  // 延迟填充：回答结束后等 800ms 再动，避开滚动收尾
  const [displayedTokens, setDisplayedTokens] = useState(0);
  const targetTokens = realUsage.lastPromptTokens;

  useEffect(() => {
    if (!hasData || isAwaitingUsage) return;
    const timer = setTimeout(() => setDisplayedTokens(targetTokens), 800);
    return () => clearTimeout(timer);
  }, [hasData, isAwaitingUsage, targetTokens]);

  const ratio = contextLimit > 0 ? Math.min(1, displayedTokens / contextLimit) : 0;
  const pct = Math.round(ratio * 100);

  // 高水位换色示警，其余用主题色
  const stroke =
    ratio >= 0.9
      ? 'var(--color-danger, #f87171)'
      : ratio >= 0.7
        ? '#fbbf24'
        : 'var(--color-accent)';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hasData ? `上下文占用 ${pct}%，点击查看详情` : '上下文用量，点击查看详情'}
      aria-expanded={isOpen}
      title={hasData ? `上下文 ${pct}%` : '暂无用量数据'}
      className={`relative p-1.5 rounded-lg transition-colors ${
        isOpen ? '' : 'hover:bg-white/5'
      }`}
    >
      {isCompacting ? (
        <Loader2
          className="animate-spin text-[var(--color-accent)]"
          style={{ width: SIZE, height: SIZE }}
        />
      ) : (
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className={isAwaitingUsage ? 'animate-pulse' : ''}
        >
          {/* 轨道 */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            className="text-white/15"
          />
          {/* 填充：从 12 点方向顺时针 */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={stroke}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - ratio)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: 'stroke-dashoffset 1200ms ease-out, stroke 400ms' }}
          />
        </svg>
      )}
    </button>
  );
}
