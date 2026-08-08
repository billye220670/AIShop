---
kind: external_dependency
name: 大模型聚合网关 HighwayAPI（接口AI）
slug: highwayapi
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
scope:
    - '**'
---

### 角色
作为本项目唯一的 LLM、图片生成与用量账单后端，提供 OpenAI 兼容的 chat/completions 流式接口以及自定义的图片生成端点。

### 集成方式
- 聊天：`chatBaseUrl` + `/openai/v1/chat/completions`，Bearer Token 鉴权；请求体走 OpenAI 协议，通过 `stream_options.include_usage` 索取 token 用量，若网关不支持会回退重试。
- 图片：`imageBaseUrl` + 各模型专属 `/v3/gpt-image-2-*`、`/v3/gemini-3.*-image-*` 端点，按模型区分 text-to-image / edit 路径。
- 账单：从 `chatBaseUrl` 提取根域名后调用 `/openapi/v1/billing/bill/list?cycleType=llm&startTime=&endTime=`。
- 密钥：通过 `settingsService` 读取本地存储的 provider key，部署时由 `.env.local` 注入 `HIGHWAY_API_KEY`。

### 稳定约定
- 提供商标识固定为 `fastapi`（见 `PROVIDERS.fastapi`），新增上游只需在 `providers.ts` 追加条目。
- 图片响应结构需兼容 Gemini/jiekou 自定义 `{ image_urls }` 与 GPT Image 2 的 `{ images | data }` 两种格式。
- 验证具体 API 字段以官方文档为准。