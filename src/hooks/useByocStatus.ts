import { useEffect, useState } from 'react';
import { BYOC_STATUS_EVENT, getByocConfig, getSyncStatus, validateConfig } from '../services/byoc';

export interface ByocIndicator {
  /** off=未启用/未配置，pending=有变更待同步（含同步进行中），synced=已同步 */
  tone: 'off' | 'pending' | 'synced';
  title: string;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * BYOC 同步状态（侧边栏小圆点用）：同步事件触发或页面回到前台时重读
 * getSyncStatus()。失败态无独立信号源（自动同步失败只留日志、下轮重试），
 * 失败期间 pending 保持 >0，表现为 pending（琥珀）态。
 */
export function useByocStatus(): ByocIndicator {
  const [indicator, setIndicator] = useState<ByocIndicator>({ tone: 'off', title: 'BYOC 未启用' });

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      const cfg = getByocConfig();
      if (!cfg.enabled || validateConfig(cfg)) {
        if (alive) setIndicator({ tone: 'off', title: 'BYOC 未启用' });
        return;
      }
      void getSyncStatus().then(s => {
        if (!alive) return;
        const pendingTotal = s.pending.convs + s.pending.messages + s.pending.roles;
        if (pendingTotal > 0) {
          setIndicator({ tone: 'pending', title: '有变更待同步' });
        } else {
          setIndicator({
            tone: 'synced',
            title: s.lastSyncAt ? `已同步 · ${fmtTime(s.lastSyncAt)}` : '等待首次同步',
          });
        }
      });
    };
    refresh();
    window.addEventListener(BYOC_STATUS_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      window.removeEventListener(BYOC_STATUS_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return indicator;
}
