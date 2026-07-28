import { useEffect, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { X, Loader2, AlertCircle, BarChart3 } from 'lucide-react';
import { fetchUsageBills } from '../../services/usageApi';
import type { UsageCycleType, BillItem, ModelUsageSummary } from '../../types';

interface UsagePanelProps {
  open: boolean;
  onClose: () => void;
}

type CycleOption = {
  key: UsageCycleType;
  label: string;
};

const CYCLE_OPTIONS: CycleOption[] = [
  { key: 'Day', label: '今天' },
  { key: 'Week', label: '本周' },
  { key: 'Month', label: '本月' },
];

/** 千分位格式化 */
function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

/** 金额格式化，保留 4 位小数 */
function formatAmount(amount: number): string {
  return amount.toFixed(4);
}

/** 汇总各模型用量 */
function aggregateByModel(bills: BillItem[]): ModelUsageSummary[] {
  const map = new Map<string, ModelUsageSummary>();

  for (const bill of bills) {
    const name = bill.productName || '未知模型';
    const existing = map.get(name);
    const inputTokens = parseFloat(bill.billNum0) || 0;
    const outputTokens = parseFloat(bill.billNum1) || 0;
    const amount = parseFloat(bill.amount) || 0;
    const payAmount = parseFloat(bill.payAmount) || 0;

    if (existing) {
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.totalAmount += amount;
      existing.payAmount += payAmount;
    } else {
      map.set(name, { modelName: name, inputTokens, outputTokens, totalAmount: amount, payAmount });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.payAmount - a.payAmount);
}

export default function UsagePanel({ open, onClose }: UsagePanelProps) {
  const [visible, setVisible] = useState(false);
  const mounted = open || visible;

  const [cycleType, setCycleType] = useState<UsageCycleType>('Day');
  const [bills, setBills] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 动画控制
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => setVisible(false), 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 数据请求
  const loadData = useCallback(async (cycle: UsageCycleType) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUsageBills(cycle);
      setBills(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '查询失败，请稍后重试');
      setBills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 打开或切换周期时加载
  useEffect(() => {
    if (open) {
      loadData(cycleType);
    }
  }, [open, cycleType, loadData]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const shown = open && visible;

  const overlayStyle: CSSProperties = {
    transition: 'opacity 200ms ease-out',
    opacity: shown ? 1 : 0,
  };
  const panelStyle: CSSProperties = {
    transition: 'opacity 200ms ease-out, transform 200ms ease-out',
    opacity: shown ? 1 : 0,
    transform: shown ? 'scale(1)' : 'scale(0.95)',
  };

  const summaries = aggregateByModel(bills);
  const totalInputTokens = summaries.reduce((s, m) => s + m.inputTokens, 0);
  const totalOutputTokens = summaries.reduce((s, m) => s + m.outputTokens, 0);
  const totalPayAmount = summaries.reduce((s, m) => s + m.payAmount, 0);

  const handleCycleChange = (cycle: UsageCycleType) => {
    setCycleType(cycle);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={overlayStyle}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[520px] max-w-[calc(100vw-2rem)] h-[70vh] bg-[var(--color-bg-primary)] rounded-2xl shadow-2xl border border-[var(--color-border)] flex flex-col"
        style={panelStyle}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-panel-title"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--color-border)] shrink-0">
          <h2 id="usage-panel-title" className="text-white text-lg font-semibold">
            用量统计
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 中间可滚动内容区 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {/* 加载中 */}
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
              <span className="text-gray-400 text-sm">加载用量数据中...</span>
            </div>
          )}

          {/* 错误状态 */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <span className="text-gray-400 text-sm text-center">{error}</span>
              <button
                onClick={() => loadData(cycleType)}
                className="mt-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors"
              >
                重试
              </button>
            </div>
          )}

          {/* 空状态 */}
          {!loading && !error && bills.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <BarChart3 className="w-10 h-10 text-gray-600" />
              <span className="text-gray-400 text-sm">暂无用量数据</span>
            </div>
          )}

          {/* 有数据 */}
          {!loading && !error && bills.length > 0 && (
            <div className="space-y-4">
              {/* 总览卡片 */}
              <div className="rounded-xl bg-white/5 p-5 border border-white/5">
                <div className="text-gray-400 text-xs mb-2">总花费</div>
                <div className="text-2xl font-bold text-[var(--color-accent)]">
                  ¥{formatAmount(totalPayAmount)}
                </div>
                <div className="flex gap-6 mt-3">
                  <div>
                    <div className="text-gray-500 text-xs">输入 Tokens</div>
                    <div className="text-white text-sm font-medium mt-0.5">
                      {formatNumber(totalInputTokens)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">输出 Tokens</div>
                    <div className="text-white text-sm font-medium mt-0.5">
                      {formatNumber(totalOutputTokens)}
                    </div>
                  </div>
                </div>
              </div>

              {/* 按模型分组列表 */}
              <div className="space-y-2">
                <div className="text-gray-400 text-xs font-medium uppercase tracking-wider">
                  模型明细
                </div>
                {summaries.map((model) => (
                  <div
                    key={model.modelName}
                    className="rounded-xl bg-white/5 p-4 border border-white/5 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-sm font-medium truncate">
                        {model.modelName}
                      </div>
                      <div className="flex gap-4 mt-1.5">
                        <span className="text-gray-500 text-xs">
                          输入 {formatNumber(model.inputTokens)}
                        </span>
                        <span className="text-gray-500 text-xs">
                          输出 {formatNumber(model.outputTokens)}
                        </span>
                      </div>
                    </div>
                    <div className="text-[var(--color-accent)] text-sm font-semibold whitespace-nowrap">
                      ¥{formatAmount(model.payAmount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部时间筛选器 */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-[var(--color-border)] shrink-0">
          {CYCLE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleCycleChange(opt.key)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                cycleType === opt.key
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
