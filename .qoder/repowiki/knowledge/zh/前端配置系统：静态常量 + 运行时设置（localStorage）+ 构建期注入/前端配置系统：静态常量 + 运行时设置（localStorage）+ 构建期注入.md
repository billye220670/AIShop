---
kind: configuration_system
name: 前端配置系统：静态常量 + 运行时设置（localStorage）+ 构建期注入
category: configuration_system
scope:
    - '**'
source_files:
    - vite.config.ts
    - src/config/version.ts
    - src/config/providers.ts
    - src/config/models.ts
    - src/config/prompts.ts
    - src/config/themes.ts
    - src/services/settingsService.ts
    - src/services/storage.ts
    - .env.example
---

## 1. 整体方案
AIShop 的前端应用采用**三层配置**组合：
- **编译期/构建期常量**：通过 `vite.config.ts` 的 `define` 将 `package.json` 的版本号注入为全局常量 `__APP_VERSION__`，由 `src/config/version.ts` 暴露。
- **静态业务配置**：集中在 `src/config/` 目录，以纯 TypeScript 模块导出常量与查询函数，包括模型清单、提供商端点、主题列表、提示词模板等。
- **用户运行时设置**：通过 `src/services/settingsService.ts` 和 `src/services/storage.ts` 读写 `localStorage`，持久化用户选择的模型、API Key、压缩策略、主题、上次会话等。

该工程没有使用 `.env` 文件在浏览器侧加载（Vite 默认支持 `import.meta.env.*`，但代码中未引用），也没有 YAML/TOML/JSON 配置文件；所有“可配置项”要么写死在源码里，要么保存在本地存储。

## 2. 关键文件与职责
| 文件 | 职责 |
|---|---|
| `vite.config.ts` | 定义 Vite 插件、开发服务器 host，并通过 `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` 注入版本号 |
| `src/config/version.ts` | 暴露 `APP_VERSION` 与 `getVersionInfo()`，声明版本单一来源为 `package.json` |
| `src/config/providers.ts` | 定义 `ProviderEndpoints` 接口与 `PROVIDERS` 映射，提供 `getProviderConfig(providerId)` 获取端点（chatBaseUrl / imageBaseUrl） |
| `src/config/models.ts` | 集中声明 `CHAT_MODELS`、`IMAGE_MODELS`、`VIDEO_MODELS`、`MUSIC_MODELS` 及 `getModelsByType(type)` |
| `src/config/prompts.ts` | 管理系统提示词：`BASE_SYSTEM_PROMPT`、`ARTIFACT_PROMPT`、`SYSTEM_PROMPTS` 字典与 `getSystemPrompt(key)`、`buildContextInfo(modelName?)` |
| `src/config/themes.ts` | 声明可用主题 `THEMES[]` 与 `DEFAULT_THEME = 'green'` |
| `src/services/settingsService.ts` | 统一封装 `AppSettings`（providers、apiKeys、compact）的 `localStorage` 存取，键名 `aishop_settings`，并提供默认值合并 |
| `src/services/storage.ts` | 轻量同步存取：`aishop_last_model`、`aishop_web_search_enabled`、`aishop_last_active_conversation_id`、`aishop_theme` |
| `.env.example` | 仅作为示例文档，列出 `HIGHWAY_API_KEY`、`BOCHA_API_KEY`、`ACCESS_CODE` 三个环境变量名，说明部署到 Vercel 时需在控制台配置 |

## 3. 架构与设计约定
- **配置即代码**：所有业务相关配置（模型、提供商、提示词、主题）都以 TypeScript 常量形式维护在 `src/config/`，新增模型或提供商只需修改对应数组并重新构建。
- **单例式访问器**：每个配置模块都提供 getter 函数（如 `getProviderConfig`、`getModelsByType`、`getSystemPrompt`、`getVersionInfo`），调用方不直接依赖内部数据结构变化。
- **默认值回退**：`settingsService` 在读取 `localStorage` 失败或字段缺失时，始终返回预设默认值（如 `DEFAULT_PROVIDERS`、`DEFAULT_COMPACT_SETTINGS`），保证应用无配置也能运行。
- **分层存储**：首屏绘制所需的少量状态（最近模型、主题、是否开启联网搜索）用同步 `localStorage` API 存取，避免阻塞渲染；更重的对话数据已迁移到 IndexedDB（`db/` 目录），不在本配置体系内。
- **版本单一来源**：`version.ts` 明确注释“版本号由 Vite 在构建时从 package.json 注入”，禁止手动同步版本号。
- **环境变量仅用于后端密钥**：`.env.example` 中的 `HIGHWAY_API_KEY`、`BOCHA_API_KEY`、`ACCESS_CODE` 是供 Vercel 环境或本地 `vercel dev` 使用的后端密钥，当前前端代码未直接读取这些变量；它们应通过代理或服务端注入到请求头中。

## 4. 约束与规则
- 新增 AI 模型必须添加到 `src/config/models.ts` 对应数组，并通过 `getModelsByType` 暴露，不得在组件内硬编码模型 ID。
- 新增第三方提供商需先在 `src/config/providers.ts` 的 `PROVIDERS` 注册端点，再通过 `getProviderConfig` 获取，保持 chat/image 基础 URL 成对出现。
- 用户设置统一通过 `settingsService` 读写，禁止在组件中直接操作 `localStorage`（除 `storage.ts` 中已定义的轻量键）。
- 主题 ID 必须来自 `src/config/themes.ts` 的 `THEMES` 列表，默认主题为 `green`。
- 系统提示词修改集中在 `src/config/prompts.ts`，新增行为模式应在 `SYSTEM_PROMPTS` 字典中以 key-value 形式扩展，并通过 `getSystemPrompt` 调用。
- 构建期常量（如版本号）只能通过 `vite.config.ts` 的 `define` 注入，不得在源码中硬编码字符串。
- `.env*` 文件仅用于服务端/部署环境密钥，不应在前端逻辑中直接 `import.meta.env` 读取敏感信息。