# AIShop 桌面改版执行文档 01：Web 平台（平台检测层 + 桌面布局）

> 阶段：1（平台能力层）+ 2（桌面布局）
> 前置文档：`docs/desktop-refactor-feature-diff.md`（功能对比与决策，必读，本文档的"决策 N"均指其中第三节编号）
> 开发环境：master 分支最新代码 + 浏览器（Chrome/Edge 开发者工具模拟）
> 产出：桌面布局在 Web 桌面浏览器中可见、移动端布局零回归

---

## 0. 硬约束（违反即停止）

1. **功能逻辑 100% 用 master 现有实现**，只改布局壳（`MainLayout` 及布局组件），不得改动 `hooks/`、`services/`、`db/`、`config/` 的功能代码；
2. **不恢复**：视频 tab、音乐 tab、历史面板（决策 13/14/15）；**不引入**：图片磁盘缓存、主进程代理生成、Markdown 磁盘保存、settingsStore（决策 6/7/8/10）；
3. **桌面端出现 Web 版没有的 UI 交互时，执行到对应的"人工检查点"必须暂停**，由用户选方案，不得自行决定；
4. **移动端（视口 <1024px）行为不得回归**——每步改完必须用窄视口验证。

---

## 1. 阶段 1：平台能力层

### 1.1 新建 `src/platform/capabilities.ts`

内容（全部为纯函数，无 React 依赖）：

```ts
import { detectPlatform, isStandalone } from '../utils/pwa';

/** 是否运行在 Electron 外壳内（window.electronAPI 由 preload 暴露） */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI === 'object';
}

/** 是否有触摸主输入（触摸屏手机/平板/触摸笔记本） */
export function hasTouch(): boolean {
  return navigator.maxTouchPoints > 1 ||
    window.matchMedia('(pointer: coarse)').matches;
}

/** 设备形态（Web/Electron 共用） */
export type DeviceMode = 'mobile' | 'desktop';

/** 设备形态判定规则：
 *  桌面 = 视口 ≥1024 且（Electron 环境 或 无触摸优先 或 视口 ≥1280）
 *  即：触摸屏平板（1024~1279）判为 mobile，触摸笔记本（≥1280）判为 desktop */
export function detectDeviceMode(): DeviceMode {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 1024) return 'mobile';
  if (isElectron() || !hasTouch() || w >= 1280) return 'desktop';
  return 'mobile';
}
```

- `detectPlatform`/`isStandalone` 直接复用 `src/utils/pwa.ts`，**不要重复实现**；
- `window.electronAPI` 的类型声明（`src/types/electron.d.ts`）在阶段 3 才引入，此处用 `typeof window.electronAPI === 'object'` 检测即可，不需要类型（TS 对未声明属性访问会报错，如报错用 `(window as unknown as { electronAPI?: unknown }).electronAPI` 断言）。

**验收**：`npx tsc -b --noEmit` 通过；浏览器 console 中 `isElectron()` 返回 `false`、`hasTouch()` 按设备返回正确值。

### 1.2 新建 `src/platform/useDeviceMode.ts`

```ts
import { useSyncExternalStore } from 'react';
import { detectDeviceMode, type DeviceMode } from './capabilities';

function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  window.addEventListener('orientationchange', cb);
  return () => {
    window.removeEventListener('resize', cb);
    window.removeEventListener('orientationchange', cb);
  };
}

function getSnapshot(): DeviceMode {
  return detectDeviceMode();
}

/** 实时设备形态；窗口跨越断点时自动切换 */
export function useDeviceMode(): DeviceMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'desktop');
}
```

- 用 `useSyncExternalStore`（React 19 推荐），不要用 `useState + useEffect`（首帧可能闪烁错误布局）。

**验收**：浏览器把窗口拖到 <1024 与 >1280 之间往返，hook 返回值实时变化（可在组件里临时 console.log 验证后移除）。

---

## 2. 阶段 2：桌面布局

### 2.1 取 electron 分支的桌面骨架作参考（只参考，不直接复制）

```powershell
git show electron-desktop:src/components/layout/MainLayout.tsx   # 桌面布局骨架
git show electron-desktop:src/components/layout/Sidebar.tsx      # 桌面侧边栏（tab/折叠/会话列表）
```

参考要点（复用这些设计，代码按 master 风格重写）：
- 侧边栏宽度：展开 `SIDEBAR_WIDTH = 224`、折叠 `COLLAPSED_WIDTH = 60`，折叠状态存 `localStorage`（key `sidebar-collapsed`）；
- 顶栏高度 52px，左侧与侧边栏等宽放 logo/首页区；`-webkit-app-region: drag` 拖拽属性**仅 Electron 生效，Web 下无副作用**（阶段 3 再加，本阶段顶栏先做普通样式）；
- 主内容区：`flex-1` + 圆角卡片（`rounded-2xl m-2`）效果。

### 2.2 新建 `src/components/layout/DesktopLayout.tsx`

- **Props 与现 `MainLayout` 完全一致**（从 `MainLayout.tsx` 导出 `MainLayoutProps` 并复用，避免 App.tsx 改动）；
- 结构：
  - 顶部 52px 栏：左侧 logo/首页按钮；右侧放模型选择入口等（见检查点①）；
  - 左侧 `DesktopSidebar`（新建 `src/components/layout/DesktopSidebar.tsx`）：tab 图标（**仅 chat/image/favorites/me**）+ 折叠按钮 + 会话列表；
  - 会话列表直接**复用现有 `Sidebar.tsx` 的会话列表部分**（搜索/批量删除/收藏筛选全部保留），不要用 electron 分支的旧会话列表；
  - 主内容区：`{children}` 原样渲染各 Panel；
  - 底部：设置入口按钮（见检查点④）。
- 移动端专属逻辑（`useDrawerSwipe`、`haptics`、`BottomNavBar`）**不进入** DesktopLayout。

### 2.3 MainLayout 薄壳化

- `MainLayout` 顶部改为：

```tsx
const mode = useDeviceMode();
if (mode === 'desktop') {
  return <DesktopLayout {...props} />;
}
// 现有移动布局代码原样保留
```

- 现有移动布局内容（抽屉侧边栏/TopNavBar/BottomNavBar/手势）全部保留，代码尽量少动；
- 两个布局共用同一份 `MainLayoutProps`。

**验收**：窗口 >1280 显示桌面布局、<1024 显示移动布局、1024~1279 触摸屏模拟（DevTools 设备模式）显示移动布局；两套布局下会话/模型/角色/压缩/搜索/BYOC 全功能可用。

---

## 3. 人工检查点（执行到必须暂停，等用户选择）

> 以下 5 项是 Web 版没有的桌面交互，按约定必须先确认。每项给出推荐方案（源自 electron 分支形态），用户选"推荐"即可继续，选其他则按选择实现。

| # | 检查点 | 选项 | 推荐 |
|---|---|---|---|
| ① | 模型选择/角色入口 | A. 顶栏下拉面板（复用 `ModelBottomSheet` 的数据与页面结构，改为下拉弹层）／B. 居中弹窗（原样套 `BottomSheet` 容器）／C. 侧边栏内嵌区域 | A |
| ② | 联网搜索/Artifact 开关 | A. 顶栏右侧图标按钮＋tooltip／B. 顶栏下拉面板内／C. 仅设置页 | A |
| ③ | 上下文压缩段入口 | A. 顶栏下拉面板（复用 `ContextSummarySheet` 内容）／B. 侧边栏底部独立区域／C. 顶栏进度环点击展开 | A |
| ④ | 设置入口 | A. 侧边栏底部齿轮按钮→现有 `SettingsPanel` 全屏渲染／B. 顶栏右侧头像按钮→弹窗式设置／C. 两者都要 | A |
| ⑤ | BYOC 同步状态 | A. 设置页内（现状）＋侧边栏底部小圆点（同步中/成功/失败）／B. 仅设置页（现状不变） | A |

---

## 4. 全量验收清单（Web，逐项人工勾选）

- [ ] `npx tsc -b --noEmit` 与 `npm run lint` 通过
- [ ] 窗口 >1280px：桌面布局（常驻侧边栏 224px、顶栏、主内容卡片区）
- [ ] 窗口拖到 <1024px：切回移动布局（底部导航/抽屉/手势）无闪烁
- [ ] 侧边栏折叠/展开（224↔60px），刷新后状态保持
- [ ] 会话列表：新建/切换/删除/批量删除/重命名/搜索/收藏筛选（桌面布局内全部可用）
- [ ] 聊天：发送/停止/重试/流式输出/重新生成/对比模型/版本切换
- [ ] 模型选择与角色定义（按检查点①确认的方案呈现）
- [ ] 联网搜索开关、Artifact 开关（按检查点②）
- [ ] 上下文压缩：触发压缩、查看/删除压缩段（按检查点③）
- [ ] BYOC：设置页配置、自动同步、会话/角色刷新（按检查点⑤）
- [ ] 图片：生成/照片墙/下载/上传压缩
- [ ] 收藏：列表/重命名/删除/导出
- [ ] 设置：API 密钥、主题切换（紫/绿 × 亮/暗）
- [ ] 移动端回归：<1024px 下上述功能抽查 5 项以上，与改版前一致
- [ ] 提交：`git commit`（或用户要求的提交方式），记录"Web 桌面布局完成"

---

## 5. 完成标准

桌面布局在 Web 端全功能可用且移动端零回归后，本文档关闭，进入 `02-electron-packaging.md`。
