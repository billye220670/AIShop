// 简易访问码客户端工具：localStorage 管理 + 带鉴权头的 fetch 包装。
// 服务端通过环境变量 ACCESS_CODE 校验请求头 X-Access-Code，详见 api/*.ts。

const STORAGE_KEY = 'aishop_access_code';
const UNAUTHORIZED_EVENT = 'aishop:unauthorized';

export function getAccessCode(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAccessCode(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // ignore quota / privacy mode errors
  }
}

export function clearAccessCode(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * 带访问码头的 fetch 包装：
 * - 自动注入 X-Access-Code 请求头
 * - 收到 401 时清掉本地访问码并广播 aishop:unauthorized 事件，
 *   AccessGate 监听该事件后弹回登录界面。
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const code = getAccessCode();
  if (code && !headers.has('X-Access-Code')) {
    headers.set('X-Access-Code', code);
  }

  const response = await fetch(input, { ...init, headers });

  if (response.status === 401) {
    clearAccessCode();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
  }

  return response;
}

/**
 * 探测访问码状态：
 *  - { required: false }       服务端未启用，直接放行
 *  - { required: true, valid: true }  本地访问码有效
 *  - { required: true, valid: false } 需登录
 *  - 网络异常视为不需要登录，避免离线时卡死
 */
export async function probeAccessCode(): Promise<{ required: boolean; valid: boolean }> {
  const stored = getAccessCode();
  try {
    const headers: Record<string, string> = {};
    if (stored) headers['X-Access-Code'] = stored;
    const res = await fetch('/api/verify', { method: 'POST', headers });
    if (res.status === 401) return { required: true, valid: false };
    if (!res.ok) return { required: false, valid: true };
    const data = (await res.json().catch(() => ({}))) as { required?: boolean };
    return { required: !!data.required, valid: true };
  } catch {
    return { required: false, valid: true };
  }
}

/**
 * 校验某个候选访问码是否正确（不写入存储）。
 * 返回：
 *  - { ok: true }                       密码正确
 *  - { ok: false, lockSeconds: number } 已被限速锁定，需等待 N 秒
 *  - { ok: false }                      密码错误或网络异常
 */
export async function verifyAccessCode(
  code: string
): Promise<{ ok: boolean; lockSeconds?: number }> {
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'X-Access-Code': code },
    });
    if (res.ok) return { ok: true };
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 0;
      let lockSeconds = retryAfter;
      if (!lockSeconds) {
        const data = await res.json().catch(() => ({}));
        lockSeconds = Number((data as { retryAfter?: number }).retryAfter) || 60;
      }
      return { ok: false, lockSeconds };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export const ACCESS_CODE_UNAUTHORIZED_EVENT = UNAUTHORIZED_EVENT;
