// Vercel Edge Function：访问码校验探针
// 前端用来判断当前 localStorage 里存的访问码是否仍然有效，
// 以及服务端是否启用了访问码校验（用于本地开发自动跳过登录界面）。
export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const expectedCode = process.env.ACCESS_CODE;

  // 服务端未配置访问码 → 直接放行（本地开发友好）
  if (!expectedCode) {
    return new Response(
      JSON.stringify({ ok: true, required: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const provided = req.headers.get('x-access-code') || '';
  if (provided !== expectedCode) {
    return new Response(
      JSON.stringify({ ok: false, required: true }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, required: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
