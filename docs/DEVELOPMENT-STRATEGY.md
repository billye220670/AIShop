# AIShop 多平台开发总策略

> 版本：1.0（2026-08-11）
> 地位：**平台开发的总纲与导航首页**。任何涉及平台选型、平台差异适配、多平台发布的工作，先读本文档。
> 仓库：`AIShop`（Vite + React 19 + TypeScript 单代码库）

---

## 0. 新会话导航（30 秒定位平台文档）

新会话开始后，用户声明平台 → 按下表定位对应文档：

| 用户声明的平台关键词 | 定位文档 | 内容 |
|---|---|---|
| Web / 浏览器 / PWA（通用） | 本文档 | 总策略与导航 |
| Web 桌面布局 / 双栏 | `docs/desktop-refactor/01-web-desktop-layout.md` | 平台检测层 + 桌面布局 |
| iOS / iPhone / Safari | `docs/ios-pwa.md` | iOS PWA 适配清单与踩坑记录 |
| Android / APK / 手机 | `docs/desktop-refactor/03-android-capacitor.md` | Capacitor 壳构建与平台适配 |
| Windows / Electron / 桌面端 | `docs/desktop-refactor/02-electron-packaging.md` | Electron 外壳与打包 |
| macOS | 远期规划（见 §5.5），暂不实施 | — |
| 功能对比 / 平台决策账本 | `docs/desktop-refactor-feature-diff.md` | 缺失功能处置记录与执行文档导航 |

> 本表已登记长期记忆：新会话声明平台后应自动返回对应文档路径，无需用户再解释。

---

## 1. 平台选型（2026-08-11 用户确认）

| 平台 | 选型 | 状态 | 理由摘要 |
|---|---|---|---|
| **Web** | 开发主力 | ✅ 已上线（Vercel，国内备选腾讯云/阿里云） | 单代码库迭代最快；应用本质是本地优先 AI 聊天工具，无强原生需求 |
| **iOS** | PWA 过渡 | ✅ 现状方案 | App Store 审核严格 + 需 Mac/证书/99$ 年费；PWA 长板（主屏安装/IndexedDB/BYOC 同步）恰好覆盖需求，短板（推送/支付）恰好不需要 |
| **Android** | Capacitor 壳 | ✅ APK 1.2.0 已出包 | 已验证完整链路（JDK 21 + 腾讯云 gradle 镜像 + 触感/状态栏/返回键适配）；免 Mac 免审核分发 |
| **Windows** | Electron 壳 | 🚧 桌面布局已落地，外壳待实施 | 桌面体验（托盘/自动更新/拖拽）；体积 ~100MB 可接受；Tauri 更轻但迁移成本高，暂不换 |
| **macOS** | 远期规划 | ⏸ 不阻塞 | Electron 外壳天然跨平台，打包配置预留，待有 Mac 环境验收 |

---

## 2. 核心开发原则（违反即停止）

1. **Web 主开发，master 单代码库**：功能唯一权威是 master 的 `src/`；新功能一律先在 Web 实现并验收，再流向其他平台；electron-desktop 旧分支仅作 UI 参考，不再维护。
2. **平台 = 外壳 + 能力适配层**：
   - 外壳只承载原生能力：`electron/`（主进程/preload）、`android/`（Capacitor 配置与 Kotlin 壳），不得在壳内实现业务功能；
   - 平台差异收敛在三个点：`src/platform/capabilities.ts`（能力检测）、`src/platform/useDeviceMode.ts`（布局分发）、极少数 service 平台分支（如 `backup.ts`）；
   - 功能代码（`hooks/`、`services/`、`db/`、`config/`）永远平台无关。
3. **能力检测优先于平台判断**：能用 capability detection（指针类型、触屏、Capacitor.isNativePlatform、window.electronAPI）就不要写死平台名；例外：Android 壳强制移动布局等已验证特例需在 `capabilities.ts` 集中注释说明。
4. **平台 UI 差异必须先确认**：Web 版不存在的 UI 呈现（桌面端/移动端新交互），开发前向用户提出 2-3 个可选方案并获明确确认，不得自行决定。
5. **回归红线**：移动端（视口 <1024px）行为零回归；功能层零改动；每平台改动后跑该平台执行文档的验收清单。
6. **决策进账本**：任何"平台独有功能保留/丢弃/新增"的决策，登记到 `docs/desktop-refactor-feature-diff.md`，不靠口头记忆。

---

## 3. 新功能开发流程（SOP）

```
1. 需求 → 先在 Web（master）实现并验收（功能层，平台无关）
2. 评估平台差异：
   ├─ 无差异 → 直接构建发布全平台（Web 部署 / Android assembleDebug / Electron 打包）
   └─ 有差异 → 判断差异类型：
        a. 布局呈现差异 → 按原则 4 先确认方案 → 改布局壳（MainLayout/DesktopLayout）
        b. 原生能力差异 → 在能力检测层（capabilities.ts）声明 → 外壳（electron/、android/）实现
        c. 存储/网络差异 → 在 service 层做平台分支（参照 backup.ts 的 Capacitor 分支）
3. 回归验证：移动端零回归 + 功能层零改动 + 目标平台验收清单
4. 提交 git（信息标注涉及平台，如 feat(android): ...）
```

---

## 4. 各平台构建与发布速览

| 平台 | 构建命令 | 发布/安装 | 详情 |
|---|---|---|---|
| Web | `npm run build` | Vercel / GitHub Actions；国内部署考虑腾讯云或阿里云 | 流水线见 `.github/workflows/release.yml` |
| iOS PWA | 同 Web 构建 | 托管静态资源，用户 Safari 访问后"添加到主屏幕" | 见 `docs/ios-pwa.md` |
| Android | `install-apk-auto.ps1`（build → cap sync → assembleDebug → adb install） | 真机 USB 调试安装 | 见 `docs/desktop-refactor/03-android-capacitor.md` |
| Windows | Electron 打包（阶段 3 实施后） | 安装包 + electron-updater 自动更新 | 见 `docs/desktop-refactor/02-electron-packaging.md` |

> 注意：每次修改安卓端相关代码（含影响 APK 的前端代码）后，自动运行项目根目录 `install-apk-auto.ps1` 完成打包安装，无需确认。

---

## 5. 决策记录

### 5.1 本次（2026-08-11）确认的决策

- 四平台选型如上表：Web 主力 / iOS PWA 过渡 / Android Capacitor / Windows Electron；
- iOS 采用 PWA 过渡（用户再三考虑后的决定）：审核严格 + 开发需 Mac；**退出路径**：将来上架 App Store 时套 Capacitor iOS 壳（代码已兼容，`isNativePlatform()` 已抽象），仅需 Mac + 证书；
- macOS 桌面版列入远期规划，不阻塞当前工作；
- 文档体系定型：总策略（本文档）+ 平台执行文档（01/02/03 + `ios-pwa.md`）+ 决策账本（feature-diff.md）。

### 5.2 既有决策（2026-08-10，详见 feature-diff.md）

- 功能层 100% 复用 master，仅 UI 布局借鉴 electron-desktop 分支；
- 不恢复：视频 tab、音乐 tab、历史面板；不引入：图片磁盘缓存、主进程代理生成、Markdown 磁盘保存、settingsStore；
- 设备形态判定：指针能力优先（Electron 或 `pointer: fine` 一律 desktop），触摸设备按 ≥1024 断点，<480 兜底 mobile，Android 壳强制 mobile。

---

## 6. 平台专属经验索引（长期记忆同步）

| 平台 | 已沉淀经验 |
|---|---|
| iOS PWA | 安全区（status-bar-style 变更影响 inset 计算，必须真机验证）；亮色模式首帧闪白；Vercel 国内移动网络白屏 |
| Android | VIBRATE 权限缺失导致 haptics 静默失败；安全区需原生注入 insets 替代 env()；JDK 21 + gradle 镜像 |
| Windows/Electron | 外壳能力边界（恢复 7 项/丢弃 4 项）；托盘退出标志 isQuitting |
