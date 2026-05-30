// Vercel Edge Function：访问码校验探针
// 前端用来判断当前 localStorage 里存的访问码是否仍然有效，
// 以及服务端是否启用了访问码校验（用于本地开发自动跳过登录界面）。
// 校验失败会走共享限速逻辑（800ms 延迟 + IP 锁定）。
import { checkAccessEdge } from './_lib/access';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // 服务端未配置访问码 → 直接放行（本地开发友好）
  if (!process.env.ACCESS_CODE) {
    return new Response(
      JSON.stringify({ ok: true, required: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 走统一校验：锁定/失败 → 该函数返回 429/401；通过 → 返回 null
  const blocked = await checkAccessEdge(req);
  if (blocked) return blocked;

  return new Response(
    JSON.stringify({ ok: true, required: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
