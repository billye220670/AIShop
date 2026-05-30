// 访问码校验共享工具：恒定时间比较 + 内存级 IP 限速 + 失败延迟
// 设计目标：在不引入外部依赖的前提下，把"任意人无限尝试"的攻击成本拉高几个数量级。
// 注意：Vercel Edge / Serverless Function 实例之间内存不共享，限速仅在单实例内强一致；
// 跨实例攻击者最多能并行实例数量倍的速率，但配合 800ms 失败延迟与长密码已足够防御普通脚本。
// 若需跨实例严格限速请改用 Vercel KV / Upstash Redis。

const FAIL_WINDOW_MS = 60_000; // 失败计数窗口：1 分钟
const FAIL_THRESHOLD = 10; // 窗口内失败次数阈值
const LOCK_DURATION_MS = 60 * 60_000; // 触发阈值后锁定：1 小时
export const FAIL_DELAY_MS = 800; // 每次校验失败的固定延迟，拖慢爆破

interface RateState {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

// 单实例内存：IP → 状态。生命周期与实例一致，冷启动会清零。
const rateMap = new Map<string, RateState>();

/**
 * 恒定时间字符串比较：避免攻击者通过响应耗时差异逐位推断密码。
 * 长度不一致仍走完循环，防止长度信息泄漏。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0;
}

/**
 * 从 Edge Runtime 的 Headers 中提取客户端 IP。
 * Vercel 会注入 x-forwarded-for / x-real-ip。
 */
export function getEdgeClientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return headers.get('x-real-ip') || 'unknown';
}

/**
 * 从 Node Runtime 的 req.headers 中提取客户端 IP。
 */
export function getNodeClientIp(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers['x-forwarded-for'];
  const xff = Array.isArray(raw) ? raw[0] : raw;
  if (xff) return xff.split(',')[0].trim();
  const real = headers['x-real-ip'];
  if (typeof real === 'string') return real;
  if (Array.isArray(real) && real[0]) return real[0];
  return 'unknown';
}

/**
 * 检查 IP 是否被锁定。返回剩余锁定秒数（0 表示未锁定）。
 * 同时清理过期窗口。
 */
export function checkLocked(ip: string): number {
  const state = rateMap.get(ip);
  if (!state) return 0;
  const now = Date.now();
  if (state.lockedUntil > now) {
    return Math.ceil((state.lockedUntil - now) / 1000);
  }
  // 已过锁定期 → 清理状态
  if (state.lockedUntil > 0 && state.lockedUntil <= now) {
    rateMap.delete(ip);
  }
  return 0;
}

/**
 * 记录一次失败。超过阈值则锁定该 IP。
 */
export function recordFailure(ip: string): void {
  const now = Date.now();
  const state = rateMap.get(ip) || {
    failures: 0,
    windowStart: now,
    lockedUntil: 0,
  };
  // 窗口过期 → 重置计数
  if (now - state.windowStart > FAIL_WINDOW_MS) {
    state.failures = 0;
    state.windowStart = now;
  }
  state.failures += 1;
  if (state.failures >= FAIL_THRESHOLD) {
    state.lockedUntil = now + LOCK_DURATION_MS;
  }
  rateMap.set(ip, state);
}

/**
 * 校验成功 → 清空该 IP 的计数。
 */
export function recordSuccess(ip: string): void {
  rateMap.delete(ip);
}

/**
 * 异步等待。Edge 与 Node 运行时均支持 setTimeout。
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Edge Runtime 一站式校验：返回 null 表示通过，否则返回应直接给客户端的 Response。
 *  - 服务端未配置 ACCESS_CODE → 直接通过（本地开发友好）
 *  - IP 处于锁定期 → 429 + Retry-After
 *  - 访问码不匹配 → sleep 800ms + 401
 *  - 访问码匹配 → 清空该 IP 计数后通过
 */
export async function checkAccessEdge(req: Request): Promise<Response | null> {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return null;

  const ip = getEdgeClientIp(req.headers);

  const lockSeconds = checkLocked(ip);
  if (lockSeconds > 0) {
    return new Response(
      JSON.stringify({
        error: 'Too many failed attempts, try again later',
        retryAfter: lockSeconds,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(lockSeconds),
        },
      }
    );
  }

  const provided = req.headers.get('x-access-code') || '';
  if (!timingSafeEqual(provided, expected)) {
    recordFailure(ip);
    await delay(FAIL_DELAY_MS);
    return new Response(
      JSON.stringify({ error: 'Invalid access code' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  recordSuccess(ip);
  return null;
}
