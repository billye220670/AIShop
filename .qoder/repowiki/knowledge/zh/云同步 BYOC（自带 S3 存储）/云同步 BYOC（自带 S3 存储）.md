---
kind: data_sync
name: 云同步 BYOC（自带 S3 存储）
category: data_sync
scope:
    - '**'
source_files:
    - src/services/byoc/types.ts
    - src/services/byoc/s3Client.ts
    - src/services/byoc/state.ts
    - src/services/byoc/backupSync.ts
    - src/services/byoc/incrementalSync.ts
    - src/services/byoc/index.ts
    - src/services/settingsService.ts
    - src/components/settings/ByocSettings.tsx
    - src/components/settings/DataSettings.tsx
    - src/App.tsx
    - src/db/messageRepo.ts
    - src/db/favoriteRepo.ts
    - src/db/imageHistoryRepo.ts
---

## 1. 总体方案
BYOC（Bring Your Own Cloud）参照 Obsidian 的 BYOC 模式：用户自带 S3 兼容云存储（腾讯云 COS、阿里云 OSS、Cloudflare R2、Backblaze B2、MinIO、AWS S3），对话数据直接同步到用户自己的桶，应用不经过任何云端中转。采用**直连模式**：AccessKey/SecretKey 只存于浏览器 localStorage，每次请求现场签名（AWS SigV4，crypto.subtle 纯前端实现、零依赖），密钥不出设备。

能力分两层：
- **M1 全量云备份**：把整个库打包为 BackupFile v2 推送到云端 / 从云端拉取恢复（复用 `src/services/backup.ts` 的格式，恢复以新 id 导入不覆盖）。
- **M2 增量双向同步**：manifest + 单对象粒度的双向增量同步，支持冲突处理与删除传播，自动触发（启动拉取 / 写后推送 / 回到前台拉取）。

## 2. 关键文件与职责
| 文件 | 职责 |
|---|---|
| `src/services/byoc/types.ts` | `ByocConfig`（provider/endpoint/region/bucket/prefix/pathStyle/accessKey/secretKey/enabled）与 `ByocStatus`；`BYOC_PROVIDER_PRESETS` 服务商预设（cos/oss/r2/minio/b2/custom） |
| `src/services/byoc/s3Client.ts` | SigV4 签名客户端：putObject/getObject/headObject/deleteObject/listObjects；virtual-hosted 与 path-style 两种寻址 |
| `src/services/byoc/state.ts` | 同步状态层（localStorage + IndexedDB kv 表），持久化 lastSyncAt 等元数据 |
| `src/services/byoc/backupSync.ts` | M1 云备份推/拉：manifest 版本比对 + 会话级打包上传/下载 |
| `src/services/byoc/incrementalSync.ts` | M2 同步引擎：pushLocal（脏记录上传）与 pullRemote（远端变更拉取） |
| `src/services/byoc/index.ts` | 统一出口：syncNow（Web Locks 串行）、testConnection、backupNow/restoreNow、scheduleAutoSync、BYOC_STATUS_EVENT |
| `src/components/settings/ByocSettings.tsx` | 设置 UI：开关、服务商预设、连接参数、凭证、测试/同步/备份/恢复按钮、状态行 |
| `src/db/*`（messageRepo/favoriteRepo/imageHistoryRepo） | 为同步新增只读快照 API：getStoredMessages / listStoredImageHistory / listStoredFavorites |

## 3. 桶布局（sync/v1/）
- `manifest.json`：全库版本信息（每会话 updatedAt + tombstones + 索引版本）
- `convs/{id}.json`、`msgs/{convId}/{msgId}.json`、`nodes/{convId}/{nodeId}.json`：会话 / 消息 / 上下文节点
- `blobs/{sha256}`：内容寻址附件（跨设备按哈希去重，HEAD 探测跳过已存在对象）
- `history/{id}.json`、`favs/{id}.json`：图片历史与收藏
- `index.json`：history / favs 的条目索引
- `backups/`：M1 全量备份文件存放区

## 4. 增量同步协议
- **脏判定**：`updatedAt > (syncedAt ?? 0)`（不只判 null——流式覆盖写会保留旧 syncedAt）。
- **顺序**：先 pull（远端变更优先落地）再 push（本地脏数据上传），全程由 navigator.locks 串行防多标签页并发。
- **冲突**：会话 / 节点类 last-write-wins；消息为追加式合并（远端消息先落地，本地新增随后上传）；删除走 tombstone 传播，且**数据优先于删除**（云端仍有时保留数据）。
- **本地 tombstone（防"删了又拉"）**：先拉后推的顺序下，pull 会把"云端有、本地无"一律当新会话拉取，本机刚删的会话会在同一轮同步里复活。因此 state.ts 持久化**本地 tombstone**（kv 键 `localTombstones`，与云端 tombstone 分离）：pullRemote 开头做删除检测——云端清单有、**本地缓存清单（上一轮）也有**、本地没有 → 记本地 tombstone；缓存清单里没有的是别处新建还没拉过的，绝不判删除（否则 pull 失败时会把其他设备的新会话误删）。拉取时：本机已删且云端 updatedAt 未超过缓存记录值 → 跳过拉取；云端 updatedAt 超过 → **删除回退**（其他设备恢复了会话，数据优先，撤销本机删除）。pushLocal 写云端 tombstone 时同步记本地 tombstone，应用云端 tombstone 时清理本地记录。history/favs 同机制（id 不复现，无回退判断）。
- **已知坑**：pull 会话时本地较新**不能**顺手 markSynced（否则本地新版永远推不上云端）；pushLocal 开头要清理 manifest 中已被本地恢复的 tombstone（否则"删了又拉"）。
- **同步后重载列表先 flush 写链**：useChat 的 persistConversation 是 fire-and-forget 异步（conversationStore 内用写链串行排队），若同步后立即 `loadConversationList` 读库，可能读到"消息还没写入"的中间态（新会话 messageCount=0），reloadConversations 会把内存中完整会话替换成空壳、侧栏按 hasAnyMessage 过滤后会话直接消失。因此：① flushPendingWrites 会等待写链排空（conversationStore 的 chainPersist/writeChain）；② reloadConversations 无条件 hydrate 当前会话并把内存中未落盘消息合并回来（同 id 保留内存版），不再依赖库里的 messageCount 冗余字段判断。

## 5. SigV4 签名要点（已与 aws4 交叉验证）
- canonical URI 中斜杠 `/` **不编码**：encodeURIComponent 会把 `/` 编成 `%2F`，必须 `.replace(/%2F/gi, '/')` 还原（AWS UriEncode 对 path 的例外项）。
- canonical query 中参数值的斜杠**必须编码为 `%2F`**（与 URI 相反）：腾讯云 COS 严格按标准 UriEncode 验签，query 值若保留斜杠（如 `prefix=aishop/`）会报 SignatureDoesNotMatch——已通过诊断脚本实测定位，修复为 path/query 分别用 awsUriEncode（斜杠不编码）与 awsQueryEncode（斜杠编码）。
- 签名头固定 `host;x-amz-content-sha256;x-amz-date`；PUT 传真实 payload hash，其余操作传空串 hash（`e3b0c442...`）。
- virtual-hosted 模式下 host 头 = `{bucket}.{endpoint}`，签名用 `url.host`；发送 URL 的 query 由 URLSearchParams 编码（%2F），与签名后的 canonical query 保持一致。
- 回归测试：`test-byoc-s3.mjs`（先用 esbuild 打包 s3Client.ts 再运行），含两条向量：无 query 官方向量 + 带斜杠 query（`prefix=aishop/`），期望值均经 npm 库 `aws4` 交叉验证一致。
- **非安全上下文降级**：浏览器在 http:// 局域网（非 HTTPS）下 `crypto.subtle` 为 undefined，签名会直接抛错——s3Client 检测到无 subtle 时降级为 `src/utils/sha256.ts` 的纯 JS SHA-256/HMAC 实现（签名输入仅几 KB，性能无关），正确性由测试用例 3（模拟禁用 subtle 后签名仍与官方向量一致）锁定。

## 6. 约束与规则
- 凭证只经 settingsService 存 localStorage，禁止出现在日志或请求 URL 中；桶必须设为私有。
- 纯前端直连的前提是桶控制台配置 CORS（允许本应用域名的 GET/PUT/HEAD/DELETE），失败提示文案需引导用户检查 CORS。
- MinIO 强制 path-style（UI 自动开启且不可关）；自定义 endpoint 允许 `http://` 前缀（本地 MinIO 场景）。
- 新增数据实体需要同步时：扩展 types 同步项 → incrementalSync 加对应 push/pull 段 → 状态行展示。
- 自动同步由 App.tsx 的 scheduleAutoSync 接入（启动 8s 后首次拉取 + 60s 周期检查 + visibilitychange 前台拉取）。
