---
kind: error_handling
name: 前端错误处理：基于 Error 抛出、AbortSignal 取消与 Toast 提示的异步错误流
category: error_handling
scope:
    - '**'
source_files:
    - src/services/api.ts
    - src/services/imageApi.ts
    - src/db/open.ts
    - src/hooks/useChat.ts
    - src/components/common/Toast.tsx
    - src/services/settingsService.ts
---

## 1. 总体方案

该仓库是一个纯前端 React + TypeScript 应用，没有后端中间件或全局异常处理器。错误处理集中在三个层面：
- 服务层（services）：对上游 LLM/图片 API 的 fetch 调用统一抛出自定义语义的 Error，把网络错误、超时、4xx/5xx 响应体解析为可读消息。
- 数据层（db/open.ts）：通过 withDB 封装 IndexedDB 操作，遇到连接失效时自动重连重试；通过 enqueue 按会话 key 串行化写操作并吞掉队列内异常，避免一个失败阻塞后续写入。
- UI 层（hooks/components）：React hook 中用 try/catch 捕获错误，设置组件级 error 状态并通过 Toast 组件以 success/error 类型展示给用户；对可恢复场景（如联网搜索失败）采用静默降级而非中断主流程。

## 2. 关键文件与职责

- src/services/api.ts：streamChat 流式聊天请求。缺少 API Key 直接抛错；400–499 且含 stream_options/include_usage/unknown/unsupported/invalid 时去掉参数重试一次，否则抛错；非 ok 响应读取 body 后抛错；JSON.parse 失败跳过残缺 chunk。
- src/services/imageApi.ts：generateImage。校验必填字段抛错；AbortError 区分外部取消和内部 120s 超时；4xx/5xx 优先取上游 detail / error.message 拼接为用户可读消息。
- src/db/open.ts：withDB 捕获 IDB 操作异常，关闭连接并重试一次；enqueue 按 key 排队写任务，内部 .then(undefined, () => undefined) 吞掉异常，保证前序失败不阻断后续任务。
- src/hooks/useChat.ts：启动加载、压缩、发送消息、切换会话等异步流程统一 try/catch；AbortError 单独处理为“用户停止生成”；其他错误设置 setError 并在最后一条 assistant 消息内容前加 “⚠️ 请求失败:” 标记。
- src/components/common/Toast.tsx：统一的 toast 通知组件，支持 success / error 两种类型，带自动关闭计时器。
- src/services/settingsService.ts：localStorage.getItem/JSON.parse 包裹在 try/catch 中，解析失败回退到默认配置。

## 3. 架构与约定

### 3.1 错误传播路径

组件 (useChat) → 服务层 (api.ts / imageApi.ts) → fetch/IndexedDB
服务层抛 Error → 组件 catch → setError() + UI 反馈 (Toast / 消息内容前缀)

服务层不捕获业务错误，只负责把底层异常（网络、超时、非法参数、上游返回）包装成 Error 向上抛出；调用方（hook）决定是显示错误还是降级继续。

### 3.2 取消与超时

使用 AbortController + AbortSignal 实现请求取消。useChat 通过 abortControllerRef 持有信号，stopGeneration 调用 abort()。
imageApi.ts 内置 120s 超时 AbortController，并与外部 signal 合并（combineAbortSignals），超时抛 "上游服务响应超时，请稍后重试"。
useChat 捕获 e.name === 'AbortError' 时不设置 error，而是将最后一条 assistant 消息标记 stoppedByUser: true，作为“用户主动停止”的视觉状态。

### 3.3 数据库错误恢复

withDB 是 IndexedDB 操作的唯一入口：首次失败记录 console.warn('[db] 操作失败，重开连接重试')，关闭连接后重试一次。这专门应对 Safari 内存压力下偶发的 IDB UnknownError。
enqueue(key, task) 为每个 key（通常是 conversation id）维护一个 Promise 链，同一 key 的写操作串行执行；队列内部 .then(() => undefined, () => undefined) 吞掉异常，保证单个写入失败不影响后续写入。

### 3.4 用户可见的错误呈现

useChat 维护 error: string | null 状态，由父组件渲染 Toast 展示。
Toast 组件通过 type='error' 显示红色 X 图标，type='success' 显示绿色勾号，默认 2000ms 自动关闭。
对于“部分失败但主流程可继续”的场景（如联网搜索失败），不在 UI 上打断用户，仅通过消息字段 webSearchFailed 等状态标记，由 MessageBubble 等组件自行决定是否展示。

### 3.5 静默失败策略

多处代码显式忽略非关键错误：
- 标题生成失败：.catch(() => { /* 静默失败 */ })
- localStorage 解析失败：try { JSON.parse } catch { /* ignore */ }
- 启动时恢复上次会话失败：console.error 后回退到新对话
- 持久化 effect 中的写入失败：.catch(e => console.error(...)) 不阻断 state 更新

## 4. 约定与约束

1. 所有对外部服务的调用必须抛 Error：api.ts、imageApi.ts 在参数缺失、API Key 未配置、网络异常、响应非 ok 时均 throw new Error(...)，由上层统一捕获。
2. 区分 AbortError 与普通错误：useChat 中明确检查 e.name === 'AbortError'，走“用户停止”分支而不是报错。
3. 错误消息面向用户：服务层抛出的错误消息尽量包含上下文（如 "请先在设置中配置 API Key"、"不支持的图片模型: xxx"、"上游服务响应超时，请稍后重试"），以便 UI 直接展示。
4. IndexedDB 操作必须经 withDB 和 enqueue：open.ts 注释明确这是集中处理连接重试和写入串行的边界。
5. 非关键错误允许静默失败：标题生成、localStorage 解析、后台持久化等辅助流程失败时仅 console.error 或忽略，不中断主流程。
6. UI 层不直接 throw：React 组件通过 useState 管理 error 状态并配合 Toast 展示，不在 JSX 中直接 throw。
7. 无全局错误边界：未发现 ErrorBoundary 或 window.onerror 等全局捕获，错误处理分散在各 hook 的 try/catch 中。