# BYOC云同步系统

<cite>
**本文引用的文件**
- [src/services/byoc/index.ts](file://src/services/byoc/index.ts)
- [src/services/byoc/incrementalSync.ts](file://src/services/byoc/incrementalSync.ts)
- [src/services/byoc/backupSync.ts](file://src/services/byoc/backupSync.ts)
- [src/services/byoc/state.ts](file://src/services/byoc/state.ts)
- [src/services/byoc/types.ts](file://src/services/byoc/types.ts)
- [src/components/settings/ByocSettings.tsx](file://src/components/settings/ByocSettings.tsx)
- [src/components/settings/SettingsPanel.tsx](file://src/components/settings/SettingsPanel.tsx)
- [src/services/settingsService.ts](file://src/services/settingsService.ts)
- [src/db/index.ts](file://src/db/index.ts)
- [test-byoc-s3.mjs](file://test-byoc-s3.mjs)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本系统为“自带云存储（BYOC）”的浏览器端数据同步方案，支持将对话、消息、图片历史、收藏等数据增量同步到用户自己的 S3 兼容对象存储（如腾讯云 COS、阿里云 OSS、Cloudflare R2、MinIO、Backblaze B2 或自定义 S3）。系统提供：
- 全量备份与恢复（独立于增量同步）
- 增量双向同步（先拉后推，收敛本地与云端状态）
- 自动调度（启动延迟拉取、周期轮询、回到前台拉取）
- 连接性测试与配置校验
- 多设备并发安全（Web Locks 串行化）

## 项目结构
BYOC 能力集中在 services/byoc 目录，对外暴露统一入口；设置面板在 components/settings 中；持久化状态通过 state.ts 写入 IndexedDB；数据库访问通过 db/index.ts 统一导出。

```mermaid
graph TB
UI["设置面板<br/>ByocSettings.tsx / SettingsPanel.tsx"] --> API["BYOC 统一出口<br/>services/byoc/index.ts"]
API --> INC["增量同步引擎<br/>incrementalSync.ts"]
API --> BAK["全量备份层<br/>backupSync.ts"]
API --> ST["同步状态持久化<br/>state.ts"]
API --> CFG["设置服务<br/>settingsService.ts"]
INC --> DB["数据层<br/>db/index.ts"]
INC --> S3["S3 客户端外部实现"]
BAK --> S3
ST --> DB
```

图表来源
- [src/services/byoc/index.ts:1-211](file://src/services/byoc/index.ts#L1-L211)
- [src/services/byoc/incrementalSync.ts:1-656](file://src/services/byoc/incrementalSync.ts#L1-L656)
- [src/services/byoc/backupSync.ts:1-69](file://src/services/byoc/backupSync.ts#L1-L69)
- [src/services/byoc/state.ts:1-97](file://src/services/byoc/state.ts#L1-L97)
- [src/services/settingsService.ts:1-115](file://src/services/settingsService.ts#L1-L115)
- [src/db/index.ts:1-101](file://src/db/index.ts#L1-L101)

章节来源
- [src/services/byoc/index.ts:1-211](file://src/services/byoc/index.ts#L1-L211)
- [src/services/byoc/types.ts:1-99](file://src/services/byoc/types.ts#L1-L99)

## 核心组件
- 统一入口与自动调度：负责配置校验、连通性测试、手动/自动同步触发、事件广播。
- 增量同步引擎：维护云端清单 manifest，处理会话/消息/节点/blobs/历史/收藏的双向同步与删除传播。
- 全量备份层：将应用内备份格式直接上传至用户桶，或从最新备份恢复。
- 状态持久化：设备 ID、云端清单缓存、本地 tombstone、最近同步时间等。
- 设置服务：读写 BYOC 配置（localStorage），提供默认值与合并策略。
- 设置界面：可视化配置、预设填充、连通性检测反馈。

章节来源
- [src/services/byoc/index.ts:1-211](file://src/services/byoc/index.ts#L1-L211)
- [src/services/byoc/incrementalSync.ts:1-656](file://src/services/byoc/incrementalSync.ts#L1-L656)
- [src/services/byoc/backupSync.ts:1-69](file://src/services/byoc/backupSync.ts#L1-L69)
- [src/services/byoc/state.ts:1-97](file://src/services/byoc/state.ts#L1-L97)
- [src/services/settingsService.ts:1-115](file://src/services/settingsService.ts#L1-L115)
- [src/components/settings/ByocSettings.tsx:1-180](file://src/components/settings/ByocSettings.tsx#L1-L180)

## 架构总览
BYOC 采用“分层 + 清单驱动”的设计：
- 全量备份层：独立于增量同步，用于灾难恢复。
- 增量同步层：以 manifest.json 作为“目录”，按 updatedAt/syncedAt 判断变更，使用 tombstones 传播删除。
- 状态层：持久化设备标识、清单缓存、本地 tombstone、最近同步时间。
- 设置层：管理用户配置（endpoint、bucket、密钥等）。
- 数据层：IndexedDB 中的会话、消息、节点、blob、历史、收藏等。

```mermaid
sequenceDiagram
participant U as "用户"
participant UI as "设置面板"
participant API as "BYOC 入口"
participant INC as "增量同步"
participant ST as "状态持久化"
participant DB as "IndexedDB"
participant S3 as "S3 兼容存储"
U->>UI : 填写配置并保存
UI->>API : updateByocConfig()
API->>ST : 读取/更新配置
U->>API : 触发 syncNow()
API->>INC : pullRemote()
INC->>S3 : 读取 manifest.json
INC->>DB : 拉取/落库会话、消息、节点、blob
INC->>S3 : 推送变更与会话元数据
INC->>ST : 更新本地 tombstone/清单缓存
API->>ST : 记录 lastSyncAt
API-->>U : 返回统计结果
```

图表来源
- [src/services/byoc/index.ts:56-123](file://src/services/byoc/index.ts#L56-L123)
- [src/services/byoc/incrementalSync.ts:139-323](file://src/services/byoc/incrementalSync.ts#L139-L323)
- [src/services/byoc/incrementalSync.ts:364-509](file://src/services/byoc/incrementalSync.ts#L364-L509)
- [src/services/byoc/state.ts:22-73](file://src/services/byoc/state.ts#L22-L73)

## 详细组件分析

### 统一入口与自动调度（index.ts）
- 配置校验与连通性测试：validateConfig 检查 endpoint、bucket、accessKey/secretKey；testConnection 调用 listObjects 验证签名、网络与 CORS。
- 手动同步：syncNow 使用 Web Locks 串行化，避免多标签页并发写冲突；先拉后推，合并统计结果。
- 自动调度：scheduleAutoSync 在启动后延迟拉取一次、每 60 秒检查待同步量并触发 safeSync、页面回到前台时立即拉取。
- 事件机制：通过自定义事件通知 UI 刷新（状态变化、同步完成）。

```mermaid
flowchart TD
Start(["开始"]) --> CheckCfg["校验配置"]
CheckCfg --> |失败| ExitErr["抛出错误"]
CheckCfg --> |成功| Lock{"是否已有同步进行中?"}
Lock --> |是| ExitBusy["抛出忙碌错误"]
Lock --> |否| Pull["pullRemote()"]
Pull --> Push["pushLocal()"]
Push --> Merge["合并统计结果"]
Merge --> SaveTime["记录 lastSyncAt"]
SaveTime --> Dispatch["派发状态事件"]
Dispatch --> End(["结束"])
```

图表来源
- [src/services/byoc/index.ts:40-123](file://src/services/byoc/index.ts#L40-L123)

章节来源
- [src/services/byoc/index.ts:1-211](file://src/services/byoc/index.ts#L1-L211)

### 增量同步引擎（incrementalSync.ts）
- 桶布局约定：manifest.json、convs/{id}.json、msgs/{convId}/{msgId}.json、nodes/{convId}/{nodeId}.json、blobs/{sha256}、history/favs 及其 index.json。
- 推送流程（pushLocal）：
  - 清理回退：若本地仍存在某会话，则移除云端 tombstone。
  - 删除检测：云端有而本地无且已知（缓存清单或本地 tombstone）→ 写 tombstone 并尝试删除云端对象。
  - 变更会话：仅当本地 updatedAt > 云端 updatedAt 才覆盖元数据；消息按 diff 推送；引用 blob 用 HEAD 探测去重；节点覆盖式同步并清理云端多余节点。
  - 历史/收藏：以本地为准推全量索引；云端多余项记 tombstone。
  - 重写清单：更新 manifest.updatedAt 与 deviceId，并落盘本地清单缓存。
  - 标记 syncedAt：全部成功后批量标记，保证下次不重复推送。
- 拉取流程（pullRemote）：
  - 本机删除检测：云端有、缓存清单也有、本地没有 → 记本地 tombstone，防止“拉缺失”把刚删的拉回。
  - 应用 tombstone：删除本地对应记录，并清理本地 tombstone。
  - 会话拉取：按清单遍历，按 updatedAt/syncedAt 判断是否需要拉取；消息按 msgId 去重并以 updatedAt 大者胜；节点根据云端较新与否决定覆盖或补全；元数据 LWW。
  - 历史/收藏：以云端 index 为准拉缺失；本地多余不删（防丢数据）。
  - 更新本地清单缓存。

```mermaid
flowchart TD
A["开始 pushLocal"] --> D0["清理回退：本地存在则清云端tombstone"]
D0 --> D1["删除检测：云端有/本地无 → 写tombstone并删云端对象"]
D1 --> C1["变更会话：元数据LWW、消息diff、blob去重、节点覆盖"]
C1 --> H1["历史/收藏：推全量索引，云端多余记tombstone"]
H1 --> M1["重写manifest并更新本地清单缓存"]
M1 --> S1["标记syncedAt仅updatedAt<=now的记录"]
S1 --> Z["结束"]
```

图表来源
- [src/services/byoc/incrementalSync.ts:139-323](file://src/services/byoc/incrementalSync.ts#L139-L323)

章节来源
- [src/services/byoc/incrementalSync.ts:1-656](file://src/services/byoc/incrementalSync.ts#L1-L656)

### 全量备份层（backupSync.ts）
- 备份：构建应用内备份文件（自包含 JSON），以时间戳命名上传至 backups 目录。
- 恢复：列出备份，取字典序最后一个（最新），下载并调用 restoreBackup 导入（以新 id 导入，不覆盖现有数据）。
- 可用性检测：listObjects 判断是否存在至少一份备份。

章节来源
- [src/services/byoc/backupSync.ts:1-69](file://src/services/byoc/backupSync.ts#L1-L69)

### 状态持久化（state.ts）
- 设备 ID：首次生成并持久化，用于清单中标记最后推送方。
- 云端清单缓存：本地副本，用于判断“新增/删除”语义。
- 本地 tombstone：区分“本机已删”和“从未拉过”，避免误拉回或删除。
- 最近同步时间：供 UI 展示。
- 待同步计数：综合 updatedAt/syncedAt 与 tombstone 计算，支撑 60 秒轮询。

章节来源
- [src/services/byoc/state.ts:1-97](file://src/services/byoc/state.ts#L1-L97)

### 类型定义（types.ts）
- ByocConfig：enabled、provider、endpoint、region、bucket、prefix、pathStyle、accessKey、secretKey、lastSyncAt。
- 服务商预设：cos/oss/r2/minio/b2 的默认 region/pathStyle。
- SyncManifestV1：schema、deviceId、updatedAt、convs、tombstones、historyIds、favIds。
- 结果与进度回调：SyncResult、CloudBackupResult、ProgressFn。

章节来源
- [src/services/byoc/types.ts:1-99](file://src/services/byoc/types.ts#L1-L99)

### 设置界面（ByocSettings.tsx / SettingsPanel.tsx）
- 由 ByocSettings 提供表单与预设选择，并在配置变更后防抖执行 testConnection，通过自定义事件上报连接状态。
- SettingsPanel 集成 BYOC 标签，显示连接状态图标（可用/不可用）。

章节来源
- [src/components/settings/ByocSettings.tsx:1-180](file://src/components/settings/ByocSettings.tsx#L1-L180)
- [src/components/settings/SettingsPanel.tsx:138-148](file://src/components/settings/SettingsPanel.tsx#L138-L148)

### 设置服务（settingsService.ts）
- 提供 getByocSettings/setByocSettings，合并默认值与用户配置，持久化到 localStorage。

章节来源
- [src/services/settingsService.ts:105-113](file://src/services/settingsService.ts#L105-L113)

## 依赖关系分析
- 入口模块依赖：
  - settingsService 获取/更新 BYOC 配置
  - incrementalSync 提供 pushLocal/pullRemote
  - backupSync 提供备份/恢复
  - state 提供设备ID、清单缓存、本地 tombstone、最近同步时间
  - s3Client（外部实现）提供 S3 操作
- 增量同步依赖：
  - db/index.ts 提供的会话、消息、节点、blob、历史、收藏等读写接口
  - messageCodec 提取消息中的 blob 引用
  - conversationRepo 删除会话
- 状态持久化依赖：
  - db/open 打开 IndexedDB 并执行事务
- 设置界面依赖：
  - byoc 入口的 validateConfig/testConnection/BYOC_STATUS_EVENT
  - types 中的预设与类型

```mermaid
graph LR
IDX["byoc/index.ts"] --> INC["incrementalSync.ts"]
IDX --> BAK["backupSync.ts"]
IDX --> ST["state.ts"]
IDX --> CFG["settingsService.ts"]
INC --> DB["db/index.ts"]
INC --> MSGC["messageCodec"]
INC --> CONV["conversationRepo"]
ST --> DB
```

图表来源
- [src/services/byoc/index.ts:13-24](file://src/services/byoc/index.ts#L13-L24)
- [src/services/byoc/incrementalSync.ts:21-59](file://src/services/byoc/incrementalSync.ts#L21-L59)
- [src/services/byoc/state.ts:7-9](file://src/services/byoc/state.ts#L7-L9)

章节来源
- [src/services/byoc/index.ts:13-24](file://src/services/byoc/index.ts#L13-L24)
- [src/services/byoc/incrementalSync.ts:21-59](file://src/services/byoc/incrementalSync.ts#L21-L59)
- [src/services/byoc/state.ts:7-9](file://src/services/byoc/state.ts#L7-L9)

## 性能考量
- 并发控制：
  - 列表处理 mapLimit 限制并发度，避免对 S3 的请求风暴（会话、消息、节点、历史/收藏均有限流保护）。
  - 多标签页通过 navigator.locks.request 串行化同步，避免并发写冲突。
- 去重与最小化传输：
  - 推送 blob 前使用 headObject 探测，已存在则跳过上传。
  - 消息按 diff（updatedAt > syncedAt）推送，减少冗余。
- 资源回收：
  - 节点与历史/收藏的索引与 tombstone 配合，确保多余对象被清理或不再拉取。
- 数据库事务：
  - markSynced 使用事务批量更新 syncedAt，降低 IO 次数。

[本节为通用指导，无需特定文件来源]

## 故障排查指南
- 配置不完整：
  - 现象：testConnection 抛错或连接状态不可用。
  - 排查：确认 endpoint、bucket、accessKey、secretKey 已填写；检查 CORS 与签名是否正确。
- 自动同步未触发：
  - 现象：待同步数量不为零但未同步。
  - 排查：确认 enabled 为 true；检查 scheduleAutoSync 是否已注册；查看 countPending 逻辑是否识别到 tombstone 或 updatedAt 变更。
- 删除未跨设备生效：
  - 现象：一端删除后另一端仍可见。
  - 排查：确认 pushLocal 已将 tombstone 写入 manifest；确认 pullRemote 正确应用 tombstone 并清理本地 tombstone。
- 多标签页冲突：
  - 现象：并发同步导致数据不一致。
  - 排查：确认使用了 Web Locks；检查 runSync 是否在锁内执行。
- 签名异常（非 HTTPS/局域网）：
  - 现象：签名失败或行为不一致。
  - 排查：参考测试脚本验证 SigV4 签名路径与降级实现一致性。

章节来源
- [src/services/byoc/index.ts:40-54](file://src/services/byoc/index.ts#L40-L54)
- [src/services/byoc/index.ts:192-210](file://src/services/byoc/index.ts#L192-L210)
- [src/services/byoc/incrementalSync.ts:162-194](file://src/services/byoc/incrementalSync.ts#L162-L194)
- [src/services/byoc/incrementalSync.ts:416-441](file://src/services/byoc/incrementalSync.ts#L416-L441)
- [test-byoc-s3.mjs:1-86](file://test-byoc-s3.mjs#L1-L86)

## 结论
本 BYOC 系统以“清单驱动 + 增量同步 + 全量备份”的组合，实现了在浏览器端对任意 S3 兼容存储的安全、可靠、低侵入的数据同步。通过 tombstone 与本地 tombstone 的配合，删除可跨设备传播；通过 Web Locks 与 mapLimit，保障并发与限流；通过自动调度，提升用户体验。建议在生产环境结合服务端日志与监控，持续优化并发度与重试策略。

[本节为总结性内容，无需特定文件来源]

## 附录
- 桶内对象布局示例（prefix 为用户配置的前缀，默认 aishop）：
  - sync/v1/manifest.json
  - sync/v1/convs/{convId}.json
  - sync/v1/msgs/{convId}/{msgId}.json
  - sync/v1/nodes/{convId}/{nodeId}.json
  - sync/v1/blobs/{sha256}
  - sync/v1/history/{id}.json + index.json
  - sync/v1/favs/{id}.json + index.json

章节来源
- [src/services/byoc/incrementalSync.ts:9-19](file://src/services/byoc/incrementalSync.ts#L9-L19)