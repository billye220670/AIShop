---
kind: external_dependency
name: 备用联网搜索引擎 Tavily
slug: tavily-search
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
---

### 角色
可选的联网搜索备选引擎，当用户在设置中把搜索提供商切到 `tavily` 时启用。

### 集成方式
- 端点：`https://api.tavily.com/search`，POST JSON `{ api_key, query, search_depth: 'advanced' }`。
- 鉴权：key 放在请求体 `api_key` 字段（非 Header）。
- 返回体取 `results` 数组并映射为统一 `SearchResult`。

### 稳定约定
- 未配置 key 时打印警告并返回空结果，不影响主对话流程。
- 与 Bocha 共用同一套 `searchWeb` 入口和结果格式。