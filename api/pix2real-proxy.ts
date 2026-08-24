/**
 * Vercel 同源代理：Web 版（https PWA）访问自建 Pix2Real 服务时被浏览器两道墙拦截——
 * 1) 混合内容：https 页面 fetch http 资源直接 block；
 * 2) 同源策略：服务端 CORS 未对部署 origin 放行。
 * 客户端把真实目标地址放 x-p2r-url 头，本函数原样转发方法/头/体并回传状态与响应体。
 * Electron（file:// 不受限）与 Android（原生 HTTP 桥）不走这里。
 */
export const maxDuration = 60;

export default async function handler(req: Request): Promise<Response> {
  const target = req.headers.get('x-p2r-url');
  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response(JSON.stringify({ error: 'missing x-p2r-url' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const headers = new Headers();
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) headers.set('x-api-key', apiKey);
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const init: RequestInit = { method: req.method === 'HEAD' ? 'GET' : req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // 缓冲转发（multipart 直传参考图几 MB 量级，函数内存足够）
    init.body = await req.arrayBuffer();
  }

  try {
    const upstream = await fetch(target, init);
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
