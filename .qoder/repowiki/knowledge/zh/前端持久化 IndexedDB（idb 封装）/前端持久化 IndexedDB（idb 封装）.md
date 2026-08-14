---
kind: external_dependency
name: 前端持久化 IndexedDB（idb 封装）
slug: indexeddb-idb
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### 角色
项目所有会话、消息、附件、检索索引、收藏、「我的库」资产等数据的本地持久化存储，运行于浏览器 IndexedDB。

### 集成方式
- 使用 `idb` 库的 `openDB` 创建名为 `AiShopDB` 的数据库（当前版本 v3），版本升级时在 `upgrade` 回调中创建 conversations/messages/blobs/contextNodes/contextPlans/retrieval/imageHistory/favoriteArtifacts/assets/roles/kv 等对象仓库及索引。
- v2→v3 升级：新增 `assets` 统一资产仓库（artifact/markdown/image 三种 kind），并一次性把 favoriteArtifacts 迁移为 kind=artifact 的资产（旧 store 保留不删，兼容回退）。upgrade 回调内迁移写入必须用 `tx.objectStore()` 而非 `db.put`（后者会新建事务，在 upgrade 中抛 InvalidStateError）。
- 所有写操作经 `withDB` 包装，遇到 Safari 内存压力导致的 UnknownError 自动重连重试一次。

### 稳定约定
- 多标签页共享同一 DB 实例，升级被阻塞时会关闭当前连接等待。
- 所有仓库统一通过 `withDB` 访问，禁止直接持有 IDB 连接。