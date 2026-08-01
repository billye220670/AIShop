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

async function acquire(blobId: string): Promise<string | null> {
  const cached = cache.get(blobId);
  if (cached) {
    cached.refs += 1;
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
  if (entry) entry.refs += 1;
  return url;
}

function release(blobId: string): void {
  const entry = cache.get(blobId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  // 引用归零：撤销 object URL 并移出缓存。
  // 不做延迟回收——重新申请只是一次 IDB 读，比长期占着内存划算。
  URL.revokeObjectURL(entry.url);
  cache.delete(blobId);
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
