// 本地测试脚本：直接请求 GPT Image 2 文生图接口，测量响应时间（无超时限制）
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 简易 .env 解析
function loadEnv() {
  try {
    const envPath = resolve(__dirname, '.env');
    const content = readFileSync(envPath, 'utf-8');
    const vars = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // 去除引号
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

// 获取 API Key：优先命令行参数，其次 .env 文件
const env = loadEnv();
const apiKey = process.argv[2] || env.HIGHWAY_API_KEY;

if (!apiKey) {
  console.error('❌ 未找到 API Key。请通过以下方式之一提供：');
  console.error('   1. 在 .env 文件中设置 HIGHWAY_API_KEY=your_key');
  console.error('   2. 命令行参数: node test-image-local.mjs YOUR_API_KEY');
  process.exit(1);
}

const UPSTREAM_URL = 'https://api.highwayapi.ai/v3/gpt-image-2-text-to-image';
const TEST_PROMPT = 'a cute cat sitting on a rainbow';

const requestBody = {
  prompt: TEST_PROMPT,
  n: 1,
  size: '1024x1024',
  quality: 'medium',
  output_format: 'png',
};

console.log('正在请求 GPT Image 2 文生图（无超时限制）...');
console.log(`Prompt: "${TEST_PROMPT}"`);
console.log(`URL: ${UPSTREAM_URL}`);
console.log('');

const startTime = Date.now();

try {
  const response = await fetch(UPSTREAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rawText = await response.text();

  console.log(`耗时: ${elapsed} 秒`);
  console.log(`状态: ${response.status}`);

  if (response.ok) {
    try {
      const data = JSON.parse(rawText);
      // 兼容多种响应结构
      const urls = data.image_urls || data.images || data.data || [];
      const count = Array.isArray(urls) ? urls.length : 0;
      console.log(`结果: ${count} 张图片 URL`);
    } catch {
      console.log(`结果: 响应非 JSON，长度 ${rawText.length} 字节`);
    }
  } else {
    try {
      const err = JSON.parse(rawText);
      console.log(`错误: ${JSON.stringify(err, null, 2)}`);
    } catch {
      console.log(`错误: ${rawText.slice(0, 500)}`);
    }
  }
} catch (err) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`耗时: ${elapsed} 秒`);
  console.log(`请求失败: ${err.message}`);
}
