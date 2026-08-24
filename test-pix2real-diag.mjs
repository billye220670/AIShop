/**
 * Pix2Real 公网链路诊断：在 Node 里原样复现 App 纯文字生图时发出的请求。
 *
 * 用法（替换成 Electron 设置里填的地址和 API Key）：
 *   node test-pix2real-diag.mjs http://VPS_IP:3000/api/v1 YOUR_API_KEY
 *
 * 判定：
 *  - 这里也 503 → 问题在公网链路（frp/VPS 转发层），与 App 无关；
 *  - 这里能出图 → 链路没问题，问题在 Electron 客户端，需要抓 App 的实际请求对比。
 */

const baseUrl = (process.argv[2] || '').replace(/\/+$/, '');
const apiKey = process.argv[3] || '';

if (!baseUrl || !apiKey) {
  console.error('用法: node test-pix2real-diag.mjs <baseUrl> <apiKey>');
  console.error('示例: node test-pix2real-diag.mjs http://1.2.3.4:3000/api/v1 EC2D624DF25E');
  process.exit(1);
}

const HEADERS = { 'x-api-key': apiKey };

// 1) 连通性：GET /workflows
console.log('[1] GET', `${baseUrl}/workflows`);
try {
  const res = await fetch(`${baseUrl}/workflows`, { headers: HEADERS });
  const text = await res.text();
  console.log(`    状态: ${res.status}`);
  console.log(`    响应体(前200字符): ${text.slice(0, 200) || '(空)'}`);
  if (!res.ok) {
    console.error('    ✗ 连通性就不通，先解决这个');
    process.exit(1);
  }
} catch (e) {
  console.error('    ✗ 请求异常:', e.message);
  process.exit(1);
}

// 2) 提交纯文字 smart-task（与 App 完全一致：JSON + prompt + x-api-key）
const submitUrl = `${baseUrl}/smart-tasks`;
const body = JSON.stringify({ prompt: '画一张赛博朋克风格的女孩半身像，霓虹灯背景' });
console.log(`\n[2] POST ${submitUrl}`);
console.log(`    body: ${body}`);
const t0 = Date.now();
let submit;
try {
  const res = await fetch(submitUrl, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  console.log(`    状态: ${res.status}（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  console.log(`    响应头: ${JSON.stringify(Object.fromEntries(res.headers))}`);
  console.log(`    响应体: ${text.slice(0, 500) || '(空)'}`);
  if (!res.ok) {
    console.error('\n    ✗ 提交失败：Node 直连也复现，问题在公网链路/服务端，不在 App。');
    process.exit(1);
  }
  submit = JSON.parse(text);
} catch (e) {
  console.error('    ✗ 请求异常:', e.message);
  process.exit(1);
}

if (submit.status === 'needs_clarification') {
  console.log(`\n    服务端追问: ${submit.question}`);
  process.exit(0);
}
if (!submit.taskId) {
  console.error('\n    ✗ 未返回 taskId:', JSON.stringify(submit));
  process.exit(1);
}
console.log(`    ✓ taskId=${submit.taskId} 工作流=${submit.workflowName || '?'}`);
if (submit.routing?.reason) console.log(`    路由说明: ${submit.routing.reason}`);

// 3) 轮询直到完成（最多 5 分钟）
console.log('\n[3] 轮询任务状态...');
const deadline = Date.now() + 300_000;
for (;;) {
  if (Date.now() > deadline) {
    console.error('    ✗ 轮询超时');
    process.exit(1);
  }
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetch(`${baseUrl}/tasks/${submit.taskId}`, { headers: HEADERS });
  const text = await res.text();
  if (!res.ok) {
    console.error(`    ✗ 轮询失败: ${res.status}，响应体: ${text.slice(0, 300) || '(空)'}`);
    process.exit(1);
  }
  const task = JSON.parse(text);
  console.log(`    [${task.status}] ${task.progress ?? ''}%`);
  if (task.status === 'completed') {
    const outputs = task.results?.outputs || task.resultUrls || [];
    console.log(`\n    ✓ 完成，产物 ${outputs.length} 张:`);
    for (const o of outputs) {
      console.log(`      ${typeof o === 'string' ? o : o.url}`);
    }
    console.log('\n    结论：Node 直连全链路正常 → 问题在 Electron 客户端，请反馈本脚本输出。');
    process.exit(0);
  }
  if (['error', 'failed', 'canceled'].includes(task.status)) {
    console.error(`    ✗ 任务失败: ${task.error || JSON.stringify(task)}`);
    process.exit(1);
  }
}
