/**
 * PWA 安装状态与存储持久化。
 *
 * 这个文件存在的唯一目的是回答「数据会不会哪天自己没了」。
 *
 * iOS 的规则（与安卓差别很大，别混着理解）：
 * - 在 Safari 里当网页用：所有第三方存储（IndexedDB / localStorage / Cache
 *   一视同仁）有七天上限，连续七天没用 Safari 访问过本站就整体清除。
 * - 「添加到主屏幕」装成 PWA 后：有独立的存储容器，不走上面的七天清理。
 *   这是 iOS 上唯一能真正规避定期清除的办法。
 * - navigator.storage.persist() 在 Safari 上永远 resolve 成 false，
 *   拿不到安卓那样的「持久化」档位。所以 iOS 上别指望它。
 *
 * 结论：iOS 用户必须引导安装；安装与否都还需要导出备份兜底，因为
 * 「清除网站数据」和系统回收谁都防不住。
 */

export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  // iPadOS 13+ 默认发桌面 UA，靠触摸点数补判
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/** 是否以独立窗口运行（即已装到主屏幕） */
export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari 的私有属性，装机后为 true
  return (navigator as { standalone?: boolean }).standalone === true;
}

/**
 * 申请持久化存储。
 *
 * 返回是否拿到。安卓/桌面 Chrome 在站点有一定使用度后通常会直接给；
 * Safari 一律返回 false，这不是错误，是它不支持这个档位。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  /** 已用占配额比例，0~1 */
  ratio: number;
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * 数据是否面临定期清除风险。
 *
 * 只有「iOS 上未安装到主屏幕」这一种情况会命中——那正是七天规则的适用范围。
 * 目前没有 UI 用它；将来做安装引导时，这就是判断该不该提示的依据。
 */
export function isAtRiskOfEviction(): boolean {
  return detectPlatform() === 'ios' && !isStandalone();
}
