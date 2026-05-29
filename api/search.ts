// Vercel Edge Function：代理博查（Bocha）联网搜索接口
// 密钥放在服务端环境变量 BOCHA_API_KEY
export const config = {
  runtime: 'edge',
};

const BOCHA_API_URL = 'https://api.bochaai.com/v1/web-search';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = process.env.BOCHA_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'BOCHA_API_KEY not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let payload: { query?: string } = {};
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const query = (payload.query || '').trim();
  if (!query) {
    return new Response(JSON.stringify({ error: 'query is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upstream = await fetch(BOCHA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      freshness: 'noLimit',
      summary: true,
      count: 8,
    }),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
