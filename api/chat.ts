// Vercel Edge Function：代理 highwayapi 的 OpenAI 兼容接口
// 既支持流式（SSE）也支持非流式响应，密钥放在服务端环境变量 HIGHWAY_API_KEY
import { checkAccessEdge } from './_lib/access';

export const config = {
  runtime: 'edge',
};

const API_BASE_URL = 'https://api.highwayapi.ai/openai/v1';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // 访问码校验（防滥用 + 限速）：仅在服务端配置 ACCESS_CODE 时启用
  const blocked = await checkAccessEdge(req);
  if (blocked) return blocked;

  const apiKey = process.env.HIGHWAY_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'HIGHWAY_API_KEY not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 透传请求体（已包含 model / messages / stream / temperature 等）
  const body = await req.text();

  const upstream = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  // 直接透传上游响应；流式时 body 为 SSE 流，前端按原逻辑解析即可
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
