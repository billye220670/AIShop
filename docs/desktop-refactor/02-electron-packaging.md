# AIShop 桌面改版执行文档 02：Electron 平台（外壳 + 打包）

> 阶段：3（Electron 外壳回归）
> 前置：`01-web-desktop-layout.md` 完成（DesktopLayout 已在 master 合并），本文档假设 `src/platform/`、`DesktopLayout` 已存在
> 背景：`docs/desktop-refactor-feature-diff.md` 第三节（决策 1~15）
> 环境：Windows（Win 打包）；Mac 打包需 macOS 环境（逻辑相同，命令标注）

---

## 0. 硬约束（违反即停止）

1. **功能层零改动**：`src/` 下功能代码（hooks/services/db/config）一行不改，外壳只新增、不修改功能；
2. **只恢复**决策 1/2/3/4/5/9/11/12；**绝不引入**决策 6/7/8/10（图片磁盘缓存、主进程代理生成、Markdown 磁盘保存、settingsStore）及 13/14/15（视频/音乐/历史面板）；
3. 主进程/预加载中所有被裁剪的 IPC 通道必须连同前端调用点一起删除，不留死代码；
4. Web 构建（`npm run build`）不受影响——electron 配置与 vite.config.ts 互相独立。

---

## 1. 取回外壳文件（git 命令，从 electron-desktop 分支）

```powershell
git checkout electron-desktop -- electron/ electron.vite.config.ts
git checkout electron-desktop -- src/components/common/UpdateNotification.tsx
git checkout electron-desktop -- src/types/electron.d.ts
```

取回后立即删除 settingsStore（决策 10）：

```powershell
Remove-Item electron/main/settingsStore.ts
```

注意：`electron/` 目录含 `main/index.ts`、`preload/index.ts`、`tsconfig.json`。**这些文件取回后必须按第 2/3 步裁剪，不得原样使用。**

---

## 2. 裁剪主进程 `electron/main/index.ts`

**删除**（对应决策 6/7/8/10，含 import 与 handler）：

| 删除项 | 对应 IPC | 决策 |
|---|---|---|
| `settingsStore` 相关全部（import、`registerSettingsHandlers`、`settings:*` 5 个 handler） | settings:getProvider / setProvider / getApiKey / setApiKey / getAll | 10 |
| `image:generate` handler（主进程 HTTP 代理） | image:generate | 7 |
| `image:save-local` / `image:get-local-path` handler（磁盘缓存） | image:save-local / image:get-local-path | 6 |
| `file:save-markdown` handler | file:save-markdown | 8 |

**保留**（对应决策 1/2/3/5/9/11/12）：

- `BrowserWindow` 配置：`titleBarStyle: 'hidden'` + `titleBarOverlay`（36px，颜色 `#0d0a1a`/白，注意亮色模式需动态改，见第 5.3 步）+ `backgroundColor`；
- 关闭拦截最小化到托盘（`isQuitting` 标志 + `Tray`）；
- `image:native-drag` handler（`startDrag`，**必须保持 `ipcMain.on` + `event.sender.startDrag()` 同步语义**，electron 分支注释明确：异步会导致拖拽失效）；
- `open-external` handler；
- `update-titlebar-color` handler（`mainWindow.setTitleBarOverlay({ color, symbolColor })`）；
- 自动更新：`app:check-update` / `app:install-update` handler + `update-available` / `update-downloaded` 事件广播 + `autoUpdater` 初始化（含 `autoUpdater.on('error')` 日志，避免静默失败）；
- `before-input-event` 的 F12 / Ctrl+Shift+I DevTools；
- 加载逻辑：dev 模式 `ELECTRON_RENDERER_URL` / 生产 `loadFile`。

---

## 3. 裁剪 preload `electron/preload/index.ts` 与类型 `src/types/electron.d.ts`

两者删除项一一对应（删掉即不会暴露）：

- `settings` 对象（5 个方法）；
- `imageGenerate`、`saveImageLocal`、`getLocalImagePath`、`saveMarkdown`。

保留：`startDrag`（**必须是 `ipcRenderer.sendSync`**）、`openExternal`、`updateTitleBarColor`、`checkForUpdate`、`installUpdate`、`onUpdateAvailable`、`onUpdateDownloaded`。

`electron.d.ts` 同步裁剪为：只含保留 API 的类型 + `declare global { interface Window { electronAPI?: ElectronAPI } }`。

**验收**：`npx tsc -p electron/tsconfig.json --noEmit` 通过；全仓 grep 无 `saveImageLocal`/`imageGenerate`/`saveMarkdown`/`settingsStore` 残留。

---

## 4. package.json 与构建配置

### 4.1 依赖与脚本（版本参考 electron-desktop 分支，以 npm 实际解析为准）

```jsonc
"main": "dist-electron/main/index.js",
"scripts": {
  "dev:electron": "electron-vite dev",
  "build:electron": "electron-vite build",
  "preview:electron": "electron-vite preview"
},
"dependencies": {
  "electron-updater": "^6.8.3"
},
"devDependencies": {
  "electron": "^42.3.0",
  "electron-builder": "^26.8.1",
  "electron-vite": "^6.0.0-beta.1"
}
```

- `build`（electron-builder 配置）从 electron 分支 `package.json` 取回：`appId`/`productName`/`win.nsis`/`publish.github`（owner billye220670 / repo AIShop）/`extraResources`（Icon 目录，托盘与窗口图标用）；
- **兼容性风险点**：master 用 Vite 8 + React 19，electron-vite 6 可能要求特定 Vite 大版本——安装后立即 `npm run build:electron` 验证，若 electron-vite 与 Vite 8 冲突，以 electron-vite 官方支持的 Vite 版本为准给 `dev:electron`/`build:electron` 单独锁定版本（可接受 electron 构建链与 Web 构建链使用不同 Vite 大版本，互不干扰）；
- `electron.vite.config.ts` 保持 electron 分支原样（renderer 已含 `react()` + `tailwindcss()` 插件，root `.`，outDir `dist-electron/renderer`）——**不要与根 `vite.config.ts` 合并**，两套构建互不干扰。

**验收**：`npm run build:electron` 成功产出 `dist-electron/{main,preload,renderer}`。

### 4.2 首次运行验证

```powershell
npm run dev:electron
```

窗口应正常打开、无 DevTools 报错、聊天等核心功能可用（此时仍是移动布局属正常——断点判定：Electron 窗口默认 1280x800 ≥1280 → 桌面布局；若 dev 窗口是 900 宽最小尺寸则可能显示移动布局，属预期，正式包默认 1280 宽）。

---

## 5. 桌面 UI 的 Electron 专属适配（src/ 内小改动）

### 5.1 拖拽顶栏

`DesktopLayout` 的 52px 顶栏加（仅 `isElectron()` 时）：

```tsx
style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
```

顶栏内可交互元素（按钮/下拉）必须加 `WebkitAppRegion: 'no-drag'`。Web 下该属性无效果，不需要条件渲染。

### 5.2 自动更新提示（决策 3/4）

`App.tsx` 挂载 `UpdateNotification`（已取回）：

```tsx
const [updateReady, setUpdateReady] = useState(false);
useEffect(() => {
  if (!window.electronAPI?.onUpdateDownloaded) return;
  window.electronAPI.onUpdateDownloaded(() => setUpdateReady(true));
}, []);
// 渲染：<UpdateNotification open={updateReady} onClose={() => setUpdateReady(false)} />
```

启动时可调 `electronAPI.checkForUpdate()`（开发环境会失败，需 try/catch 静默）。electron 分支 App.tsx 有完整写法可参考（`git show electron-desktop:src/App.tsx`）。

### 5.3 标题栏颜色联动（决策 12）

`App.tsx` 主题/模式切换处（现有 `useEffect` 已设置 `meta theme-color`）追加：

```tsx
const TITLEBAR_COLORS = {
  purple: { dark: { bg: '#0d0a1a', symbol: '#ffffff' }, light: { bg: '#f5f5f7', symbol: '#1a1a1a' } },
  green:  { dark: { bg: '#121211', symbol: '#e0e0e0' }, light: { bg: '#f5f5f7', symbol: '#1a1a1a' } },
} as const;
```

亮色模式必须同步改 overlay 颜色（electron 分支只有深色映射，本次补上亮色），保证与 `meta-theme-color` 逻辑一致。

### 5.4 外链系统浏览器（决策 9）

全局兜底（`DesktopLayout` 或 `App.tsx` 的 effect）：

```ts
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
  if (a && a.target === '_blank' && window.electronAPI?.openExternal) {
    e.preventDefault();
    void window.electronAPI.openExternal(a.href);
  }
}, true);
```

### 5.5 图片拖拽到桌面（决策 5）

`PhotoCard.tsx`（照片墙卡片）接入：

```tsx
onDragStart={(e) => {
  const api = window.electronAPI;
  if (api?.startDrag) {
    api.startDrag(card.url);   // sendSync，勿改异步
    return;                    // Electron 下不要 preventDefault
  }
  // Web 下维持现有行为
}}
```

参考 electron 分支 `ImagePanel.tsx` 中 startDrag 的完整实现。

---

## 6. 打包与发布

### 6.1 Windows 安装包

```powershell
npm run build:electron
npx electron-builder --win nsis
```

产物在 `release/`（`PortAI Setup x.x.x.exe`）。

### 6.2 macOS 包（需 macOS 环境）

```powershell
npm run build:electron
npx electron-builder --mac dmg
```

Windows 上无法交叉打 mac 包（dmg 签名需要 macOS）；本步骤可延后到有 mac 机器时执行，不影响 Win 交付。

### 6.3 自动更新（决策 3）

- 首次发布：`electron-builder` 带 `--publish always`（或 CI 的 GitHub Release），产物上传 GitHub Releases（electron 分支的 release.yml 已有流程，参考 `.github/workflows/release.yml` 与 electron 分支对比补回 electron 构建 job）；
- 后续版本更新 `package.json` 的 `version` 字段触发检测（`electron-updater` 按版本号判定）。

---

## 7. 人工检查点（执行到必须暂停）

| # | 检查点 | 说明 |
|---|---|---|
| ⑥ | **dev:electron 首启布局** | Electron 窗口默认 1280×800 应显示桌面布局；若显示移动布局，检查 `detectDeviceMode` 中 `isElectron()` 是否生效（`window.electronAPI` 是否注入成功） |
| ⑦ | **拖拽区交互** | 顶栏空白处可拖动窗口、按钮区域不可拖动；确认与原生窗口按钮 overlay 不重叠 |
| ⑧ | **被裁剪功能确认** | 设置页确认 API 密钥仍走 localStorage（settingsService），无主进程读取痕迹；图片仍从 IndexedDB 读取 |

---

## 8. 全量验收清单（Electron，逐项人工勾选）

- [ ] `npm run dev:electron` 启动：窗口 1280×800、桌面布局、无控制台报错
- [ ] 顶栏空白可拖窗；窗口按钮（最小化/最大化/关闭）正常且颜色随主题（紫/绿 × 亮/暗）变化
- [ ] 关闭窗口 → 最小化到托盘；托盘图标右键菜单可"显示/退出"
- [ ] F12 / Ctrl+Shift+I 打开 DevTools
- [ ] 聊天全流程：发送/流式/停止/重试/重新生成/对比模型
- [ ] 模型选择与角色定义（Web 阶段确认的呈现方案）
- [ ] 上下文压缩、联网搜索、Artifact、收藏
- [ ] BYOC：配置 S3 → 自动同步 → 会话/角色从云端刷新
- [ ] 图片：生成/照片墙/下载（浏览器下载通道在 Electron 中正常）
- [ ] 图片拖拽：照片墙图片拖到桌面 → 生成 PNG 文件
- [ ] 外链：消息内 `target=_blank` 链接 → 系统默认浏览器打开
- [ ] 设置：密钥保存于 localStorage、主题切换即时生效
- [ ] 打包：`npx electron-builder --win nsis` 产出安装包；安装后运行冒烟（以上抽查 5 项）
- [ ] `npm run build`（Web）不受影响；`npm run lint` 通过
- [ ] 提交：记录"Electron 外壳回归完成"

---

## 9. 完成标准

Win 安装包可安装运行、功能全量可用后，本文档关闭。Mac 打包留待 macOS 环境（步骤 6.2），Capacitor 阶段见 `03-android-capacitor.md`。
