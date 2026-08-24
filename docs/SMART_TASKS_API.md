# 智能任务 API（POST /api/v1/smart-tasks）

> 面向**接入外部 AI 聊天软件**的场景：调用方只有一句用户的话和用户随手发的图，不知道
> Pix2Real 内部有哪些工作流、每个要什么参数。工作流选择与参数补全全部由服务端的 Grok 完成。
>
> 与之相对的是 [`EXTERNAL_API.md`](./EXTERNAL_API.md) 的 `POST /tasks` —— 那个要求调用方
> 自己指定 `workflowId` 和全部参数。两者并存，互不影响。

---

## 1. 心智模型

```
一句话 (+ 0~2 张图)  →  Grok 选工作流  →  提交 ComfyUI  →  返回 taskId
                                                              ↓
                                        照常轮询 GET /api/v1/tasks/:taskId
```

**关键点**：`smart-tasks` 只替代「提交」这一步。任务建好之后，状态轮询、产物下载、取消
全部复用现有端点，调用方不需要为它写第二套轮询逻辑。

---

## 2. 前提

与其余 `/api/v1` 端点一致：

- 对外 API 已开启（`config.json` 的 `externalApi.enabled = true`），详见
  [`EXTERNAL_API_AGENT_GUIDE.md` 第 2 节](./EXTERNAL_API_AGENT_GUIDE.md)。
- 请求头带 `x-api-key`。
- **额外要求**：`config.json` 的 `grok` 块必须配好 `apiKey`（或设环境变量 `GROK_API_KEY`），
  否则该端点返回 `502`。其余端点不受影响。

```json
{
  "grok": {
    "baseUrl": "https://api.highwayapi.ai/openai",
    "apiKey": "YOUR_GROK_KEY",
    "model": "grok-4.3"
  }
}
```

headless 启动方式不变：`npm run dev:headless` 或 `start-headless.bat`，对外走 `3100` 端口。

---

## 3. 请求

`POST /api/v1/smart-tasks`

支持 **JSON** 和 **multipart** 两种 Content-Type。

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 用户原话，不要预处理。中文原样传即可。 |
| `images` | array | 否 | 最多 2 项参考图。每项可以是 COS key 字符串，或 `{ "key": "..." }` / `{ "url": "..." }`。 |

**图片顺序有语义**：第一张是主图/目标图，第二张是脸图。换脸场景必须按这个顺序给。

### 3.1 推荐：参考图走 COS（不经隧道）

与 `/tasks` 完全相同的三条通道，优先级 multipart > `key` > `url`。远程接入一律推荐 COS：

```bash
# 1) 换预签名 PUT 地址
curl -X POST http://localhost:3100/api/v1/uploads/presign \
  -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{"fileName":"photo.png","kind":"image"}'
# → { "uploadUrl": "https://...", "key": "uploads/2026/08/xxx.png", ... }

# 2) 直传 COS（不带 x-api-key，这是 COS 的地址）
curl -X PUT --upload-file photo.png "<uploadUrl>"

# 3) 用返回的 key 提交
curl -X POST http://localhost:3100/api/v1/smart-tasks \
  -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"把这张照片变成二次元插画","images":["uploads/2026/08/xxx.png"]}'
```

COS 未启用时传 `key` 会得到 `503`，此时回退 multipart。

### 3.2 降级：multipart 直传

字段名用 `images`，可重复（也兼容 `image` / `targetImage` / `faceImage`）：

```bash
curl -X POST http://localhost:3100/api/v1/smart-tasks \
  -H "x-api-key: YOUR_API_KEY" \
  -F "prompt=把第二张的脸换到第一张上" \
  -F "images=@target.png" \
  -F "images=@face.png"
```

### 3.3 纯文生图（不给图）

```json
{ "prompt": "画一张赛博朋克风格的女孩半身像，霓虹灯背景" }
```

---

## 4. 响应

### 4.1 路由成功 → 已建任务（200）

```json
{
  "taskId": "a1b2c3d4-...",
  "workflowId": 6,
  "workflowName": "真人转二次元",
  "status": "queued",
  "routing": {
    "reason": "你想把真人照片转成插画风格，所以用了真人转二次元。",
    "usedImages": 1,
    "resolvedConfig": { "prompt": "anime style illustration", "imageName": "photo.png" }
  }
}
```

- `routing.reason`：一句中文说明，可直接展示给终端用户。
- `routing.resolvedConfig`：实际用上的参数，便于排查。字段随工作流不同。
- 拿到 `taskId` 后 → `GET /api/v1/tasks/:taskId` 轮询（约 1.5s 间隔），与 `/tasks` 完全一致。

### 4.2 意图无法映射 → 需要追问（200，**没有建任务**）

```json
{
  "status": "needs_clarification",
  "question": "换脸需要两张图：一张目标图和一张提供脸的图，能再发一张吗？",
  "missing": ["faceImage"]
}
```

**调用方必须判 `status`**：出现 `needs_clarification` 时没有 `taskId`，应把 `question`
回给用户，补齐素材后重新调用。

只在**物理上做不到**时才会出现（缺必需素材、请求与图像生成无关）。细节不全（没说尺寸、
没说风格）不会触发追问，服务端会用默认值补。

---

## 5. 可路由的工作流

| ID | 名称 | 需要的输入 | 典型用户说法 |
|---|---|---|---|
| 7 | 快速出图 | 无 | 「画一张…」二次元角色/插画，可自动挂 LoRA |
| 9 | ZIT快出 | 无 | 「快速来一张…」偏写实/风景，出图极快 |
| 0 | 二次元转真人 | 1 张图 | 「真人化」「照片化」 |
| 6 | 真人转二次元 | 1 张图 | 「动漫化」「画成插画」 |
| 1 | 真人精修 | 1 张图 | 「精修一下」「细节再好点」 |
| 2 | 精修放大 | 1 张图 | 「放大」「高清化」「太模糊」 |
| 3 | 图生视频 | 1 张图 | 「让它动起来」「做成短视频」 |
| 8 | 黑兽换脸 | **2 张图** | 「把脸换成…」需同时满足两张图 + 明确换脸意图 |
| 5 | 解除装备 | 1 张图 | 整体服装替换，**蒙版由服务端自动识别** |
| 10 | 区域编辑 | 1 张图 | 局部区域重绘，**蒙版由服务端自动识别** |

**不可路由**：工作流 4（视频补帧）需要视频输入，只有提示词+图片时永远缺素材。需要它请直接用
`POST /tasks` 指定 `workflowId: 4`。

### 5.1 参数是怎么定的

| 参数类别 | 决定方 | 说明 |
|---|---|---|
| 选哪个工作流 | Grok | 候选集先按图片数量做硬过滤，Grok 只在物理可行的集合里选 |
| 提示词 | Grok | 把口语描述扩写成完整画面描述 |
| 画面取向 | Grok | 只能选 portrait / landscape / square，具体像素由服务端换算 |
| LoRA（仅工作流 7） | 服务端 | Grok 提关键词，服务端在本地 LoRA 库里检索 |
| checkpoint（仅工作流 7） | 服务端 | **跟着命中的 LoRA 系列走**：本地角色 LoRA 绝大多数是光辉(IL) 系列，而默认 checkpoint 是 PONY 系列，若固定默认再过滤兼容性会把角色 LoRA 全丢掉。没命中 LoRA 时才用默认 checkpoint |
| 步数 / CFG / 采样器 / 调度器 | 服务端 | 固定用已验证的默认值，不交给 Grok（填错会直接变成 ComfyUI 的 `value_not_in_list` 报错） |
| 蒙版（工作流 5/10） | 服务端 | 自动跑 SAM 生成，用户无需提供 |

工作流 9（ZIT）不推 LoRA —— ZIT 与 SD 生态的 LoRA 不通用。

---

## 6. 错误码

| 状态码 | 含义 | 处理建议 |
|---|---|---|
| 200 + `status:"needs_clarification"` | 意图无法映射 | 把 `question` 回给用户，不要重试 |
| 400 | 缺 `prompt` / `images` 格式错 / 图片超 20MB / COS key 取不到 / URL 不在白名单 | 修请求，不要重试 |
| 401 | `x-api-key` 无效 | 检查 key |
| 403 | 对外 API 未开启 | 改 `config.json` 的 `externalApi.enabled` |
| 502 | Grok 不可用或返回无法解析 | 上游故障，可退避重试；确认 `grok.apiKey` 已配 |
| 503 | 传了 `key` 但 COS 未启用 | 回退 multipart |
| 504 | 自动蒙版识别超时（工作流 5/10） | 可重试；确认 ComfyUI 的 SAM 节点正常 |
| 500 | ComfyUI 侧错误 | 看 `error` 文案，多为模型文件缺失 |

---

## 7. 时延预期

工作流 5/10 会在提交前同步跑一次 SAM 生成蒙版，因此这两个工作流的**提交请求本身**要
数秒才返回（其余工作流的提交是立即返回的）。把 `smart-tasks` 的超时设到 **60s** 以上，
不要按普通 REST 的 5s 设。

Grok 路由本身通常在 1~3s。

---

## 8. 完整示例（JavaScript）

```js
const BASE = 'http://localhost:3100/api/v1';
const HEADERS = { 'x-api-key': 'YOUR_API_KEY', 'Content-Type': 'application/json' };

async function smartGenerate(userText, cosKeys = []) {
  // 1) 提交
  const submit = await fetch(`${BASE}/smart-tasks`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ prompt: userText, images: cosKeys }),
  }).then((r) => r.json());

  // 2) 可能需要追问
  if (submit.status === 'needs_clarification') {
    return { needsInput: true, question: submit.question };
  }
  console.log('路由结果:', submit.workflowName, '—', submit.routing.reason);

  // 3) 轮询（与 /tasks 完全一致）
  while (true) {
    await new Promise((r) => setTimeout(r, 1500));
    const task = await fetch(`${BASE}/tasks/${submit.taskId}`, {
      headers: { 'x-api-key': 'YOUR_API_KEY' },
    }).then((r) => r.json());

    if (task.status === 'completed') return { outputs: task.results.outputs };
    if (task.status === 'error') throw new Error(task.error);
  }
}
```

完成后 `results.outputs[i].url`：COS 启用时是预签名直链（**每次轮询现签，不要缓存**），
否则是本机下载路径（取用时需带 `x-api-key`）。

---

## 9. 给聊天软件接入方的建议

1. **只判 `status`，不要自己猜工作流**。想绕过路由直接指定工作流时，用 `POST /tasks`。
2. **把 `routing.reason` 展示给用户**。用户看到「我用了真人转二次元」比看到一个进度条更有掌控感。
3. **图片一律走 COS**。隧道带宽是共享的，20MB 的图 multipart 上去会拖慢所有并发任务。
4. **图片顺序要稳定**。换脸依赖「第一张是目标、第二张是脸」，别按用户发图的时间乱序重排。
5. **超时设宽**（≥60s），原因见第 7 节。
6. 用户连续追加要求（「再放大一点」）时，把上一轮的产物先传回 COS，再作为新一轮的 `images` 提交 —— 服务端不保留会话上下文，每次 `smart-tasks` 都是独立判断。
