# 桌面改版功能对比：electron-desktop 分支 vs master（Web 最新版）

> 生成日期：2026-08-10
> 对比对象：`electron-desktop` 分支（旧桌面路线） vs `master`（当前 Web/PWA 最新版）
> 用途：确定本次桌面改版（同一套 Web 开发 + 两套 UI 模式）的功能对齐范围与缺失功能清单

---

## 一、对比结论摘要

| 类别 | 数量 | 说明 |
|---|---|---|
| **交集功能**（两边都有） | 核心模块 5 类 | 本次桌面改版的对齐范围，功能以 master 为准，UI 借鉴 electron 布局 |
| **electron 独有**（web 缺失） | 15 项 | 已全部决策：外壳 8 项恢复、4 项丢弃、UI 3 项砍掉/不恢复，详见第三节 |
| **master 独有**（web 新增） | 40+ 项 | Electron 打包后自动保留，无需移植，桌面呈现方式待确认（见第四节） |

> **决策记录（2026-08-10 用户确认）**：视频 tab、音乐 tab 砍掉不恢复；其余按建议执行——外壳能力（1、2、3、4、5、9、11、12）恢复，图片磁盘缓存（6）、主进程代理生成（7）、Markdown 磁盘保存（8）、主进程 settingsStore（10）丢弃，历史面板（15）不恢复。

关键事实：

- electron-desktop 分支的功能代码是**旧快照**，落后 master 大量功能（BYOC、角色、压缩、搜索等都没有）；
- master 的数据层已整体迁移到 **IndexedDB**（`src/db/` 全部为 master 独有），electron 分支仍是旧 localStorage 方案；
- master 中 `VideoPanel`、`MusicPanel`、`HistoryPanel` 三个组件文件**残留但未挂载**（App 未引用），electron 分支里它们是激活功能；
- electron 独有能力全部通过 `window.electronAPI`（preload 暴露）调用，master 无此类型声明。

---

## 二、交集功能清单（本次桌面改版的对齐范围）

以下功能两个分支都存在。**规则：功能逻辑 100% 用 master 的实现，仅 UI 布局借鉴 electron 桌面形态**（常驻可折叠侧边栏 + 52px 拖拽标题栏 + 主内容卡片区）。

### 2.1 聊天模块

| 功能 | master 实现位置 | 移动端呈现 | 桌面端对齐方案 |
|---|---|---|---|
| 会话创建/切换/删除/重命名 | `Sidebar.tsx`、`ConversationList.tsx` | 抽屉侧边栏 | 常驻侧边栏（electron 版骨架），保留 master 的搜索/批量删除/收藏筛选 |
| 消息发送/停止/重试 | `ChatPanel.tsx`、`ChatInput.tsx` | 底部输入框 | 底部输入框，桌面加宽自适应 |
| 消息渲染（Markdown/代码高亮/公式/图片） | `MessageBubble.tsx`、`MessageImage.tsx` | 气泡 | 气泡，宽屏下限制消息最大宽度居中（参考 electron 版） |
| 流式输出/加载态 | `LoadingDots.tsx` | 圆点动画 | 不变 |
| 模型选择 | `ModelBottomSheet.tsx`（底部抽屉） | 顶栏 → 底部抽屉 | **待确认①**：桌面用下拉面板 or 居中弹窗 |
| 联网搜索开关 | `TopNavBar.tsx` | 顶栏开关 | **待确认②**：顶栏 or 设置页 |
| Artifact 网页生成/收藏 | `ArtifactPanel.tsx`、`useArtifact.ts` | 会话内嵌 | 不变（与布局无关） |
| 对比模型/版本切换 | `CompareButton.tsx`、`VersionNavigator.tsx` | 气泡旁按钮 | 不变 |
| 上下文压缩（分段/摘要） | `contextCompactor.ts`、`ContextPanel.tsx`、`ContextSummarySheet.tsx`、`CompactionMarker.tsx` | 顶栏面板 | **待确认③**：压缩段列表放桌面顶栏下拉 or 侧边栏区域 |

### 2.2 图片模块

| 功能 | master 实现位置 | 移动端呈现 | 桌面端对齐方案 |
|---|---|---|---|
| 图片生成（多模型） | `ImagePanel.tsx`、`useImage.ts`、`imageApi.ts` | 输入区 + 结果网格 | 宽屏网格列数自适应（MasonryPhotoWall 已响应式） |
| 图片历史记录 | `imageHistoryRepo.ts`、`MasonryPhotoWall.tsx`、`PhotoCard.tsx` | 照片墙 | 不变 |
| 图片下载 | `PhotoCard.tsx` | 点击下载 | 不变（Electron 下可增强为原生拖拽，见 3.1 第 5 项） |
| 上传/拖拽输入 | `ImagePanel.tsx` | 拖拽 + 选择文件 | 保留（electron 版已有拖拽区实现可参考） |
| 发送前图片压缩 | `imageCompress.ts` | 自动压缩 | 不变 |

### 2.3 收藏模块

| 功能 | master 实现位置 | 移动端呈现 | 桌面端对齐方案 |
|---|---|---|---|
| Artifact 收藏列表 | `FavoritesPanel.tsx`、`useFavoriteArtifacts.ts` | 收藏 tab | 桌面侧边栏 tab 入口（electron 版有 Star tab） |
| 收藏重命名/删除 | `FavoritesPanel.tsx` | 内联操作 | 不变 |
| 收藏导出 | `backup.ts`、`PromptModal.tsx` | 弹窗 | 不变（Electron 可增强为磁盘保存，见 3.7） |

### 2.4 设置模块

| 功能 | master 实现位置 | 移动端呈现 | 桌面端对齐方案 |
|---|---|---|---|
| API 提供商配置（LLM/图片/搜索密钥） | `SettingsPanel.tsx`、`settingsService.ts` | 「我的」tab 页 | **待确认④**：桌面端设置入口位置（electron 是侧边栏按钮 + 弹窗） |
| BYOC 云存储配置 | `ByocSettings.tsx`、`byoc/` | 设置页内 | **待确认⑤**：桌面端位置与呈现 |
| 数据管理（备份/导出/清理） | `DataSettings.tsx`、`backup.ts` | 设置页内 | 随设置面板 |
| 用量统计 | `UsagePanel.tsx`、`usageApi.ts` | 设置页内 | 随设置面板 |
| 主题/亮暗模式 | `themes.ts`、`storage.ts` | 设置页内 | 不变（electron 版有标题栏颜色联动，见 3.8） |

### 2.5 基础能力

| 功能 | master 实现位置 | 说明 |
|---|---|---|
| 主题系统（紫/绿 + 亮暗） | `themes.ts`、`index.css` | 两边都有，master 为最新（CSS 变量方案） |
| 文件解析（Office/PDF） | `fileParser.ts` | 两边文件完全相同 |
| 会话标题生成 | `titleGenerator.ts` | 两边文件完全相同 |
| 会话导出 JSON | `HistoryPanel.tsx`（`exportSingleConversation`） | master 中函数保留，入口在 Sidebar 菜单 |
| PWA 能力（安装/持久化） | `pwa.ts` | master 独有实现，Web 与 Electron 并存无冲突 |

---

## 三、缺失功能清单（electron 有、Web 版没有）

> 这些是 electron-desktop 分支独有、master 缺失的功能。分两类：**平台外壳能力**（依赖 Electron 主进程，Web 天然不存在，桌面版打包后应恢复）和 **UI 功能**（master 有文件但未挂载）。

### 3.1 平台外壳能力（依赖 `electron/main` + preload，桌面版需恢复）

| # | 功能 | electron 实现 | master 现状 | 桌面改版建议 |
|---|---|---|---|---|
| 1 | **隐藏标题栏 + 窗口拖拽区** | `BrowserWindow.titleBarStyle: 'hidden'` + `titleBarOverlay`（36px 原生按钮）+ 页面顶部 52px `-webkit-app-region: drag` 拖拽条 | 无 | ✅ 恢复。桌面布局的 52px 顶栏即为此设计，窗口按钮 overlay 由主进程配置 |
| 2 | **托盘 + 关闭最小化到托盘** | `Tray` + `close` 事件拦截 `preventDefault()` → `hide()` | 无 | ✅ 恢复（`isQuitting` 标志区分真正退出） |
| 3 | **自动更新（electron-updater + GitHub Releases）** | `autoUpdater` + `publish.github` 配置 + F5 前检查 | 无 | ✅ 恢复。electron 分支已有完整配置（`electron-builder.yml` 内联在 package.json） |
| 4 | **自动更新提示 UI** | `UpdateNotification.tsx`（监听 `onUpdateAvailable/onUpdateDownloaded`，展示"更新已就绪"） | 无 | ✅ 恢复。组件从 electron 分支取回，挂载于桌面 App |
| 5 | **图片拖拽到桌面/文件夹（OS 级）** | `startDrag` IPC：`webContents.startDrag()` 把图片变系统拖拽源 | 无 | ✅ 恢复。master 的 `PhotoCard` 已有 `draggable` 结构，接入 `electronAPI.startDrag` 即可（electron 分支有完整实现可抄） |
| 6 | **图片本地磁盘缓存** | `saveImageLocal` / `getLocalImagePath`：生成图落盘到 `imagesDir`，照片墙直接读磁盘路径 | 无（master 用 IndexedDB blobRepo 存图） | ❌ **决策：丢弃**。master 已用 IndexedDB 存图且支持 BYOC 同步，磁盘缓存与云同步存在数据源冲突 |
| 7 | **主进程代理图片生成（CORS 绕行）** | `imageGenerate` IPC：主进程发 HTTP 请求，规避浏览器 CORS | master 用 `imageApi.ts` 直连（带密钥配置） | ❌ **决策：不引入**。master 直连已正常工作，Electron 下无 CORS 限制差异，保持单一路径 |
| 8 | **保存 Markdown 到磁盘** | `saveMarkdown` IPC：对话框 + 写文件 | master 用 `PromptModal` + 浏览器下载 | ❌ **决策：不引入**。保留浏览器下载，行为一致且少一条 IPC |
| 9 | **打开外部链接（系统浏览器）** | `openExternal` IPC | 无（链接在窗口内打开） | ✅ 恢复（桌面习惯：外链走系统浏览器，`target=_blank` 在 Electron 中默认新窗口） |
| 10 | **主进程本地设置存储** | `settingsStore.ts`：JSON 文件存 provider/apiKey | master 全部用 localStorage（`settingsService.ts`） | ❌ **决策：丢弃**。master 设置已统一 localStorage + BYOC 云同步，双写会造成配置分叉 |
| 11 | **F12 / Ctrl+Shift+I 打开 DevTools** | `before-input-event` 注册 | 无 | ✅ 恢复（开发调试用，几行代码） |
| 12 | **标题栏颜色联动主题** | `updateTitleBarColor` + App 内 `titleBarColors` 映射 | master 只同步 `meta theme-color` | ✅ 恢复。桌面布局下窗口按钮颜色跟随紫/绿主题（electron 分支有映射表） |

### 3.2 UI 功能（master 文件残留但未挂载）

| # | 功能 | electron 实现 | master 现状 | 桌面改版建议 |
|---|---|---|---|---|
| 13 | **视频面板 tab** | `VideoPanel.tsx` 挂载为独立 tab（侧边栏 Film 图标） | 文件存在（内容与 electron 相同）但 **App 未引用、TabMode 无 'video'** | ❌ **决策：砍掉，不恢复**。master 有意移除入口，保留残留文件但不挂载（后续可清理删除） |
| 14 | **音乐面板 tab** | `MusicPanel.tsx` 挂载为独立 tab（侧边栏 Music 图标） | 文件存在（内容与 electron 相同）但 **App 未引用、TabMode 无 'music'** | ❌ **决策：砍掉，不恢复**。同上 |
| 15 | **历史面板（侧滑历史）** | `HistoryPanel.tsx`：ChatPanel 内 `onToggleHistory` 打开独立历史抽屉 | 文件存在但 **App/ChatPanel 均未引用**（master 会话历史已由 Sidebar 会话列表完全覆盖） | ❌ **决策：不恢复**。功能已被 Sidebar 会话列表覆盖，`exportSingleConversation` 函数保留（入口在 Sidebar 菜单） |

> 注：13/14/15 决策均为不恢复，`TabMode` 维持 master 现状（chat/image/favorites/me），桌面侧边栏 tab 同样不包含视频/音乐。

---

## 四、master 独有功能（Web 新增，Electron 打包自动保留）

> 以下功能在 master 中新增、electron 分支没有。**Electron/Capacitor 只是外壳，打包后这些功能原样可用，无需移植。** 但其中部分功能的**桌面端呈现方式**需要逐项确认（对应此前沟通的确认清单）：

| 模块 | 功能 | 桌面端呈现待确认点 |
|---|---|---|
| BYOC | S3 云同步（增量/备份/自动调度） | 状态显示位置（侧边栏 or 设置） |
| 角色系统 | 角色定义/创建/删除（`roleRepo` + `ModelBottomSheet` 角色页） | 桌面端弹窗形态（清单②） |
| 联网搜索 | 智能搜索判断（`searchJudge`）、博查/Tavily | 开关位置（清单⑤） |
| 上下文压缩 | 分段摘要、上下文占用环、压缩段列表 | 桌面端入口（清单③） |
| 图片 | 照片墙（瀑布流）、Blob 存储、发送前压缩 | 网格自适应即可 |
| 数据 | IndexedDB 全量迁移、导出备份、用量统计 | 随设置面板（清单④） |
| UI | 底部导航、顶部导航、抽屉手势、触感反馈 | 桌面布局整体替代移动布局（本次改版核心） |

---

## 五、本次桌面改版工作范围（对齐交集功能）

按用户约定：**本次只对齐交集功能**（第二节），缺失功能决策已全部确认（见第三节标注）。

1. **阶段 1 — 平台检测层**：`src/platform/capabilities.ts`（isElectron/isStandalone/hasTouch）+ `useDeviceMode.ts`（视口 ≥1024px + 平台检测，自动切换 mobile/desktop）
2. **阶段 2 — 桌面布局**：`DesktopLayout` 组件（electron 版骨架：常驻可折叠侧边栏 224px/60px + 52px 拖拽顶栏 + 主内容卡片区），`MainLayout` 变薄壳按设备模式分发；交集功能全部在此布局内呈现（含清单 ①-⑤ 的逐项确认）；桌面侧边栏 tab 仅 chat/image/favorites/me（不含视频/音乐）
3. **阶段 3 — Electron 外壳**：`electron/` 目录 + electron-builder 配置取回，**恢复**：隐藏标题栏+拖拽区（1）、托盘（2）、自动更新（3）+ 提示 UI（4）、图片拖拽到桌面（5）、外链系统浏览器（9）、F12（11）、标题栏颜色联动（12）；**不引入**：图片磁盘缓存（6）、主进程代理生成（7）、Markdown 磁盘保存（8）、settingsStore（10）、视频/音乐/历史面板（13/14/15）
4. **阶段 4 — Capacitor**：Android 壳（另行规划）

---

## 附：对比依据

- 文件清单对比：`git ls-tree -r --name-only master src` vs `git ls-tree -r --name-only electron-desktop src`
  - 共有文件 40 个，master 独有 60 个，electron 独有 2 个（`UpdateNotification.tsx`、`electron.d.ts`）+ `electron/` 目录
- 共有文件内容差异：核心差异在 `useChat.ts`（1478 行 diff）、`MessageBubble.tsx`（1085）、`Sidebar.tsx`（663）、`SettingsPanel.tsx`（640）、`ChatPanel.tsx`（604）——均为 master 功能增强所致
- 完全相同文件（0 diff）：`MusicPanel.tsx`、`VideoPanel.tsx`、`HistoryPanel.tsx`、`fileParser.ts`、`titleGenerator.ts`、`useArtifact.ts`、`providers.ts`、`VersionNavigator.tsx`、`LoadingDots.tsx`、`main.tsx`

---

## 执行文档导航（新会话按序执行）

| 顺序 | 文档 | 平台 | 内容 | 完成标准 |
|---|---|---|---|---|
| 1 | `docs/desktop-refactor/01-web-desktop-layout.md` | Web | 平台检测层 + 桌面布局（阶段 1+2） | 桌面布局浏览器可见、移动端零回归 |
| 2 | `docs/desktop-refactor/02-electron-packaging.md` | Electron Win/Mac | 外壳回归 + 打包（阶段 3） | Win 安装包可运行、功能全量可用 |
| 3 | `docs/desktop-refactor/03-android-capacitor.md` | Android | Capacitor 壳（阶段 4） | 真机验收通过 |
| — | （iOS 用 PWA，无需执行文档） | iOS | 现状方案 | — |

执行规则（每份文档通用）：
1. 按序执行，每步完成后运行该文档的验收命令并**人工检查**；
2. 各文档中的"人工检查点"（①~⑪）执行到必须暂停，与用户确认方案后再继续；
3. 功能层零改动：只改布局壳/外壳，`hooks/`、`services/`、`db/`、`config/` 功能代码不动；
4. 每次阶段性完成后提交 git（提交信息标注对应阶段）。
