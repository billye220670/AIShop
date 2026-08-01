import { useState } from 'react';
import BottomSheet from '../common/BottomSheet';
import type { ContextSegment, ContextSummary } from '../../types';
import { migrateSummary } from '../../utils/contextSummary';

interface ContextSummarySheetProps {
  open: boolean;
  segment: ContextSegment | null;
  onClose: () => void;
  onSave: (summary: ContextSummary) => void;
}

/**
 * 外层只负责按 segment 重新挂载内层，好让草稿状态自然重置，
 * 不必用 effect 去同步 props → state。
 */
export default function ContextSummarySheet(props: ContextSummarySheetProps) {
  if (!props.segment) return null;
  return <SummarySheetBody key={props.segment.id} {...props} segment={props.segment} />;
}

function SummarySheetBody({
  open,
  segment,
  onClose,
  onSave,
}: ContextSummarySheetProps & { segment: ContextSegment }) {
  const [draft, setDraft] = useState<ContextSummary>(() => migrateSummary(segment.summary));
  const [dirty, setDirty] = useState(false);

  const handleBlur = () => {
    if (dirty) {
      onSave(draft.trim());
      setDirty(false);
    }
  };

  const saved = Math.max(0, segment.tokensBefore - segment.tokensAfter);

  return (
    <BottomSheet isOpen={open} onClose={onClose}>
      {/* 头部 */}
      <div className="px-5 pb-3 shrink-0">
        <h3 className="text-white text-base font-semibold">上下文摘要</h3>
        <p className="text-xs text-gray-400 mt-1">
          {segment.messageCount} 条消息 · {segment.tokensBefore} → {segment.tokensAfter} tokens
          （省约 {saved}）· 由 {segment.model} 生成
        </p>
        <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
          这段内容代替原文发给模型。原文没有删除，下方对话里仍能看到。
        </p>
      </div>

      {/* 摘要正文，直接编辑，唯一输入框 */}
      <div className="flex-1 min-h-0 px-5 pb-6">
        <textarea
          value={draft}
          onChange={e => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          onBlur={handleBlur}
          placeholder="这段摘要会作为历史事实发给模型"
          aria-label="上下文摘要正文"
          className="w-full h-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none transition-colors resize-none leading-relaxed"
        />
      </div>
    </BottomSheet>
  );
}
