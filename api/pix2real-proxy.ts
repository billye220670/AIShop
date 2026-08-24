/**
 * Vercel 同源代理：Web 版（https PWA）访问自建 Pix2Real 服务时被浏览器两道墙拦截——
 * 1) 混合内容：https 页面 fetch http 资源直接 block；
 * 2) 同源策略：服务端 CORS 未对部署 origin 放行。
 * 客户端把真实目标地址放 x-p2r-url 头，本函数原样转发方法/头/体并回传状态与响应体。
 * Electron（file:// 不受限）与 Android（原生 HTTP 桥）不走这里。
 *
 * 采用经典 Node (req, res) 流式写法，不依赖全局 fetch/Request/Response，
 * 兼容 Vercel 项目可能锁定的旧版 Node 运行时；双向 pipe，无 body 大小与内存顾虑。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import https from 'node:https';

export const maxDuration = 60;

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const target = req.headers['x-p2r-url'];
  if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'missing x-p2r-url' }));
    return;
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'bad x-p2r-url' }));
    return;
  }

  const headers: Record<string, string> = {};
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string') headers['x-api-key'] = apiKey;
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers['content-type'] = contentType;

  const mod = url.protocol === 'https:' ? https : http;
  const upstream = mod.request(
    url,
    { method: req.method === 'HEAD' ? 'GET' : req.method, headers },
    (up) => {
      res.statusCode = up.statusCode || 502;
      res.setHeader('content-type', up.headers['content-type'] || 'application/octet-stream');
      up.pipe(res);
    },
  );
  upstream.on('error', (e) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
    }
    res.end(JSON.stringify({ error: String(e) }));
  });
  req.pipe(upstream);
}
