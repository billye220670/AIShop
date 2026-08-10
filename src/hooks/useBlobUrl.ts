/**
 * 把 `aishop-blob:<id>` 解析成可以直接喂给 <img src> 的 object URL。
 *
 * 为什么不在读会话时就把图片解出来：那样打开一个长会话会一次性建出几十个
 * object URL，且没有对应的释放时机。object URL 不 revoke 就一直占着内存，
 * 在 iOS 上长会话很快就吃不消。所以改成「谁渲染谁申请、卸载即释放」。
 *
 * 同一个 blobId 在多处渲染时共享一个 object URL，靠引用计数决定何时 revoke。
 */
import { useEffect, useState } from 'react';
import { getBlob, parseBlobRefUrl } from '../db';

interface CacheEntry {
  url: string;
  /** 有多少个挂载中的组件在用它 */
  refs: number;
}

const cache = new Map<string, CacheEntry>();
/** 同一 blobId 的并发请求合并成一次查库 */
const inflight = new Map<string, Promise<string | null>>();
/** 待撤销的 object URL：卸载后延迟 revoke，避免新 acquire 拿到已被撤销的 URL */
const revokeTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function acquire(blobId: string): Promise<string | null> {
  const cached = cache.get(blobId);
  if (cached) {
    cached.refs += 1;
    // 撤销已排上又来了新持有者：作废本次撤销
    const timer = revokeTimers.get(blobId);
    if (timer) {
      clearTimeout(timer);
      revokeTimers.delete(blobId);
    }
    return cached.url;
  }

  let pending = inflight.get(blobId);
  if (!pending) {
    pending = (async () => {
      const record = await getBlob(blobId);
      if (!record) return null;
      // 期间可能已被别的调用者建好
      const existing = cache.get(blobId);
      if (existing) return existing.url;
      const url = URL.createObjectURL(record.blob);
      cache.set(blobId, { url, refs: 0 });
      return url;
    })().finally(() => inflight.delete(blobId));
    inflight.set(blobId, pending);
  }

  const url = await pending;
  if (!url) return null;
  const entry = cache.get(blobId);
  if (entry) {
    entry.refs += 1;
    // 等待期间可能已有持有者释放归零并排上撤销，新持有者接棒后作废它
    const timer = revokeTimers.get(blobId);
    if (timer) {
      clearTimeout(timer);
      revokeTimers.delete(blobId);
    }
  }
  return url;
}

function release(blobId: string): void {
  const entry = cache.get(blobId);
  if (!entry) return;
  // 不变量：refs 是"挂载中的组件数 + 未决 acquire 数"，释放不能减到负数——
  // 已有 acquire 在等 pending 时先 release 再 +1，会互相抵消成 0，
  // 此时撤销会把新持有者正在加载的 URL 废掉。
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0) return;
  // 引用归零：延迟撤销 object URL。组件卸载与重新挂载（src 变化、会话
  // hydrate 替换）的间隙里，新 acquire 可能已拿到同一个 URL 正等 <img>
  // 加载，立刻 revoke 会让图片 onError 显示成"已不可用"。
  const url = entry.url;
  const timer = setTimeout(() => {
    revokeTimers.delete(blobId);
    const current = cache.get(blobId);
    // 期间出现新的持有者（重新 acquire 复用了同一个 URL）就作废本次撤销
    if (current && current.refs > 0) return;
    if (current?.url === url) cache.delete(blobId);
    URL.revokeObjectURL(url);
  }, 1000);
  revokeTimers.set(blobId, timer);
}

/**
 * 解析图片地址。
 *
 * 传入普通 URL（data URL、http 链接）时原样返回，方便调用方无脑套用：
 * 只有 `aishop-blob:` 前缀的才走库里取。
 *
 * 返回值三态，调用方需要区分：
 * - undefined：还在查库
 * - null：blob 不存在（被清理过，或导入的会话引用了本机没有的图片）
 * - string：可直接用的地址
 */
export function useBlobUrl(src: string | undefined): string | null | undefined {
  const blobId = src ? parseBlobRefUrl(src) : null;
  // 只存「从库里查出来的」结果。普通 URL 不进 state，直接在返回处短路，
  // 免得为一个已知值多跑一轮 effect + 重渲染。
  //
  // 连着 blobId 一起存：src 换成另一张图时，上一张的结果必须立刻失效，
  // 否则会先闪一下旧图再换成新图。
  const [fetched, setFetched] = useState<{ id: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!blobId) return;

    let active = true;
    // 是否真的持有了一份引用。acquire 是异步的，卸载可能发生在它返回之前，
    // 这时不能盲目 release，否则会把别人的引用计数减掉。
    let held = false;

    void acquire(blobId).then(url => {
      if (!url) {
        // 库里没有这个 blob，明确置 null 让调用方能区分「加载中」和「找不到」
        if (active) setFetched({ id: blobId, url: null });
        return;
      }
      held = true;
      if (active) {
        setFetched({ id: blobId, url });
      } else {
        // 已经卸载了，把刚申请到的引用还回去
        held = false;
        release(blobId);
      }
    });

    return () => {
      active = false;
      if (held) {
        held = false;
        release(blobId);
      }
    };
  }, [blobId]);

  if (!blobId) return src;
  // 结果属于另一个 blobId，说明这一张还在查库
  return fetched?.id === blobId ? fetched.url : undefined;
}
