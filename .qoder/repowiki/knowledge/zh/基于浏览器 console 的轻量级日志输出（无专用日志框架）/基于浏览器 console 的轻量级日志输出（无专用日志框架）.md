---
kind: logging_system
name: 基于浏览器 console 的轻量级日志输出（无专用日志框架）
category: logging_system
scope:
    - '**'
source_files:
    - src/hooks/useChat.ts
    - src/hooks/useImage.ts
    - src/hooks/useFavoriteArtifacts.ts
    - src/db/open.ts
    - src/services/webSearch.ts
    - src/components/chat/HistoryPanel.tsx
    - src/components/layout/Sidebar.tsx
    - src/components/image/ImagePanel.tsx
    - src/components/artifact/ArtifactPanel.tsx
    - package.json
---

## 1. 使用的系统/方法

本仓库是一个纯前端 React + TypeScript + Vite 应用，**未引入任何第三方日志框架**（如 winston、pino、bunyan、log4js、debug 等）。所有日志输出均直接调用浏览器原生 `console` API（`console.log` / `console.error` / `console.warn`），没有统一的 logger 模块、日志级别配置或结构化日志能力。

依赖清单 `package.json` 中没有任何日志相关依赖；Vite 构建产物中的日志行为完全由浏览器控制台决定。

## 2. 关键文件与位置

日志散落在各业务模块中，主要集中在以下位置：
- `src/hooks/useChat.ts`：会话恢复、消息加载、持久化失败等错误路径使用 `console.error('[useChat] ...')`
- `src/hooks/useImage.ts`：图片历史加载、保存、删除、清空等操作错误使用 `console.error('[useImage] ...')`
- `src/hooks/useFavoriteArtifacts.ts`：收藏/取消收藏/重命名失败使用 `console.error('[useFavoriteArtifacts] ...')`
- `src/db/open.ts`：IndexedDB 升级阻塞、连接重试使用 `console.warn('[db] ...')`
- `src/services/webSearch.ts`：搜索提供商切换使用 `console.log`，失败使用 `console.error`
- `src/components/chat/HistoryPanel.tsx`、`src/components/layout/Sidebar.tsx`、`src/components/image/ImagePanel.tsx`、`src/components/artifact/ArtifactPanel.tsx`：导出、下载、截图等用户操作失败时 `console.error` 并附带组件名前缀

## 3. 架构与约定

- **无中心化日志入口**：不存在 `src/utils/logger.ts` 或类似封装文件，每个模块自行调用 `console.*`。
- **错误信息格式约定**：所有 `console.error` 调用均采用 `[模块名] 中文描述, e` 的形式，例如 `[useChat] 恢复上次会话失败，回退到新对话`、`[db] 操作失败，重开连接重试`。这种带方括号前缀的方式便于在浏览器控制台中按来源快速筛选。
- **仅使用 error/warn/log 三个级别**：未发现 `console.debug` 的使用；调试信息通过 `console.log` 输出（如 `webSearch.ts` 中的搜索提供商打印），生产环境未做过滤。
- **无结构化字段**：日志为纯字符串拼接，不包含时间戳、请求 ID、用户标识、堆栈等结构化字段。
- **无日志开关/级别配置**：无法通过环境变量或配置文件关闭或调整日志输出。

## 4. 约定与约束

- **约束来源**：代码层面未强制约束——没有 ESLint 规则禁止直接使用 `console`，也没有统一 logger 可被复用。当前模式是“各模块自由使用 `console.*`”。
- **已观察到的约定**：
  - 错误日志统一以 `[模块名]` 作为前缀，便于控制台过滤。
  - 错误信息使用中文描述，异常对象 `e` 作为第二个参数传入以便查看堆栈。
  - 仅在错误/警告/关键调试路径输出日志，正常流程不输出冗余日志。
- **缺失的能力**：无日志级别管理、无结构化字段、无输出目标路由（如同时写入文件/远程服务）、无采样/节流策略。

综上，该仓库的“日志系统”本质上就是浏览器 `console` API 的直接使用，辅以统一的 `[模块名] 前缀` 约定来增强可读性，不具备企业级日志系统的特征。
