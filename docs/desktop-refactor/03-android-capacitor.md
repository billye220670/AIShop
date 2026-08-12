# AIShop 桌面改版执行文档 03：Android 平台（Capacitor 打包）

> 阶段：4（Capacitor Android 壳）
> 前置：`01-web-desktop-layout.md` 完成（Web 桌面布局已在 master）
> 背景：`docs/desktop-refactor-feature-diff.md`（决策同前：视频/音乐/历史不恢复，功能 100% 复用 master）
> 环境：Windows + Android SDK（Android Studio 或命令行 gradle）；真机/模拟器验收
> iOS：**本阶段不做**（PWA 方案，见第 6 节）

---

## 0. 硬约束（违反即停止）

1. **零原生 UI 重写**：Android 包是 WebView 壳，UI 100% 复用现有 React 代码；Kotlin 只写壳配置，不写业务；
2. 功能层零改动（同 01 文档约束 1）；
3. 不引入视频/音乐/历史面板（决策 13/14/15）；
4. 移动布局（<1024px）在 Android 上就是默认形态，桌面布局在 Android 上**不应出现**（平板横屏 ≥1280 触摸屏会命中 desktop 判定——见第 3.2 步处理）。

---

## 1. 初始化

```powershell
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/app
npx cap init "PortAI" "com.portai.app" --web-dir dist
```

生成 `capacitor.config.ts` 后确认：

```ts
const config: CapacitorConfig = {
  appId: 'com.portai.app',
  appName: 'PortAI',
  webDir: 'dist',
  // Android 返回键等行为由 @capacitor/app 处理
};
```

> `appId` 与 electron 分支的 electron-builder `appId` 保持一致（com.portai.app）。

## 2. 构建与同步

```powershell
npm run build          # 产出 dist/
npx cap sync android   # 复制 web 产物 + 生成 android/ 工程
```

**验收**：`android/` 目录生成；`npx cap open android` 能打开 Android Studio 工程。

---

## 3. Android 适配（WebView 壳的 4 个坑）

### 3.1 返回键（必做，否则返回键直接退应用）

`@capacitor/app` 的 `backButton` 拦截，优先级：关闭当前打开的 UI → 最小化：

```ts
// src/platform/android.ts（或 App.tsx 内 effect，仅 Capacitor 环境执行）
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export function isAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// 挂载点（App.tsx）：
// 1. 监听全局：若当前有打开的抽屉/弹窗（通过自定义事件或状态），先关闭，不退出；
// 2. 否则 App.minimizeApp()（而非 exitApp，符合 Android 习惯）。
```

实现要点：
- 侧边栏/弹窗的打开状态由 `MainLayout` 管理，需要在 backButton 回调里能拿到——用 `window.dispatchEvent(new CustomEvent('back-requested'))` 让布局层自行决定关闭还是转发给 `App.minimizeApp()`；
- 若布局层未消费（无打开的 UI），默认 `minimizeApp()`。

### 3.2 设备形态判定修正

Android 手机/平板触摸屏命中 `hasTouch()`，按 01 文档规则：<1024 → mobile；1024~1279 → mobile；**≥1280 会误判 desktop**（Android 大屏平板/折叠屏横屏）。修正 `detectDeviceMode()`：

```ts
// capabilities.ts 追加
import { Capacitor } from '@capacitor/core';
export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false; // Web 下 @capacitor/core 可用但 isNativePlatform() 为 false
  }
}
// detectDeviceMode 中：if (isNativeAndroid()) return 'mobile';
```

即：**原生 Android 永远移动布局**（业务上先保持手机优先，大屏适配后续单独评估）。

### 3.3 状态栏与安全区

- 状态栏颜色：现有 `meta theme-color` 在 WebView 中由 Android 主题控制，需要同步（`android/app/src/main/res/values/styles.xml` 的 `windowLightStatusBar`/`statusBarColor` 或 `@capacitor/status-bar` 插件）；
- 安全区：`viewport-fit=cover` + `env(safe-area-inset-*)` 已在 index.html/CSS 处理，Android WebView 兼容，无需改动；
- 键盘弹起：`visualViewport` 逻辑（MessageBubble/Sidebar 已用）在 WebView 中正常；Android 原生需确认 `android:windowSoftInputMode="adjustResize"`（Capacitor 模板默认值，保持即可）。

### 3.4 文件导出（备份/会话导出）

master 的 `backup.ts` 用 `Blob + a.download` 浏览器下载——Android WebView 行为不稳定（可能静默失败或进系统下载目录）。处理：

1. **先实测**：真机上验证备份导出、会话 JSON 导出是否正常；
2. 若异常，接入 `@capacitor/filesystem` 写共享下载目录（`Directory.Download`）＋`@capacitor/share` 系统分享；仅改 `backup.ts` 的落盘函数，不动 UI 结构。

---

## 4. 构建 APK

```powershell
npx cap sync android
# 方式 A：Android Studio 打开 android/ 后 Build > Build APK
# 方式 B：命令行
cd android
.\gradlew.bat assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`（debug 签名可直接安装测试）。

发布版需：`keytool` 生成 keystore → `android/app/build.gradle` 配置 signingConfig → `assembleRelease`（本阶段可延后，先 debug 验收）。

**验收**：APK 安装到真机/模拟器，应用图标/名称正确。

---

## 5. 人工检查点与全量验收清单

### 人工检查点

| # | 检查点 | 说明 |
|---|---|---|
| ⑨ | **返回键行为** | 打开侧边栏/弹窗时返回键先关闭 UI；无 UI 打开时最小化（不退出）；连按两次返回不退出的实现可选 |
| ⑩ | **设备形态** | 手机（含大屏/折叠屏横屏）必须显示移动布局，不得出现桌面布局 |
| ⑪ | **备份导出实测** | 真机导出 JSON，确认文件落盘位置与可读性；异常则按 3.4 处理 |

### 全量验收清单（Android，逐项人工勾选）

- [ ] APK 安装成功，应用正常启动，无白屏
- [ ] 移动布局完整：底部导航、抽屉侧边栏、滑动手势
- [ ] 聊天全流程：发送/流式/停止/重试/重新生成/对比模型
- [ ] 模型选择、角色定义、联网搜索、Artifact、收藏
- [ ] 上下文压缩：触发/查看/删除压缩段
- [ ] BYOC：S3 配置、自动同步、会话/角色云端刷新
- [ ] 图片：生成/照片墙/下载/上传压缩
- [ ] 返回键：先关 UI 后最小化（检查点⑨）
- [ ] 横竖屏旋转不白屏、布局不破
- [ ] 键盘弹起输入框不被遮挡（visualViewport 生效）
- [ ] 备份导出/会话导出可用（检查点⑪）
- [ ] 提交：记录"Android Capacitor 壳完成"

---

## 6. iOS 说明（本阶段不做，预留）

- iOS 维持 **PWA 添加到主屏幕**方案（现状，`isStandalone()`/持久化/七天清理规避已实现）；
- Capacitor 壳已预留 iOS：将来在 macOS 上 `npx cap add ios`，UI 零改动即可出 IPA；需 Apple 开发者账号（99$/年）与审核——按用户决策暂缓。

---

## 7. 完成标准

真机验收通过后本文档关闭。全平台交付链闭环：**Web（01）→ Electron Win/Mac（02）→ Android（03），iOS 用 PWA**。
