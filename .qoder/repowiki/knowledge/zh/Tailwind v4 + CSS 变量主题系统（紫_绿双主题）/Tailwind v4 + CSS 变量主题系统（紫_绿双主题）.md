---
kind: frontend_style
name: Tailwind v4 + CSS 变量主题系统（紫/绿双主题）
category: frontend_style
scope:
    - '**'
source_files:
    - src/index.css
    - src/config/themes.ts
    - src/App.tsx
    - vite.config.ts
    - package.json
---

## 1. 使用的系统与工具
- **CSS 框架**：Tailwind CSS v4（`tailwindcss@^4.3.0`），通过 `@tailwindcss/vite` 插件在 Vite 中启用，入口 `src/index.css` 使用 `@import "tailwindcss"` 引入。
- **排版扩展**：`@tailwindcss/typography` 用于 Markdown / 代码块排版。
- **图标库**：`lucide-react` 作为统一图标来源。
- **构建与开发**：Vite + `@vitejs/plugin-react`；无独立 SCSS/Less 预处理器，全部为原生 CSS + Tailwind utility class。
- **设计令牌载体**：CSS Custom Properties（CSS 变量），集中在 `src/index.css` 的 `[data-theme]` 选择器下。

## 2. 关键文件
- `src/index.css`：全局样式、主题变量、动画、滚动条、代码块、Toast/BottomSheet 等通用动画。
- `src/config/themes.ts`：主题元数据（id/name/previewColor）及默认主题常量。
- `src/App.tsx`：应用启动时从持久化存储加载主题并写入 `document.documentElement.dataset.theme`。
- `src/services/storage.ts`：`loadTheme()` / 保存主题的持久化逻辑（被 App 调用）。
- `vite.config.ts`：注册 `@tailwindcss/vite` 插件，使 Tailwind v4 生效。
- `package.json`：声明 `tailwindcss`、`@tailwindcss/vite`、`@tailwindcss/typography`、`lucide-react` 等依赖。

## 3. 架构与设计约定
### 3.1 主题机制（基于 `data-theme` + CSS 变量）
- 通过给 `<html>` 或根节点设置 `data-theme="purple"` / `data-theme="green"` 切换主题。
- 每个主题定义一套语义化 CSS 变量：
  - 背景：`--color-bg-base` / `--color-bg-primary` / `--color-bg-secondary` / `--color-bg-hover` / `--color-bg-elevated` / `--color-bg-button`
  - 强调色：`--color-accent` / `--color-accent-hover` / `--color-accent-soft` / `--color-accent-foreground`
  - 文字：`--color-text-primary` / `--color-text-secondary` / `--color-text-muted` / `--color-text-tertiary`
  - 边框：`--color-border` / `--color-border-subtle`
  - 滚动条：`--color-scrollbar-thumb` / `--color-scrollbar-hover`
  - 代码：`--color-code-bg`
- 当前内置两个主题：`purple`（暗夜紫，默认 root 值）和 `green`（终端绿，DEFAULT_THEME）。
- 主题列表由 `src/config/themes.ts` 集中维护，新增主题只需在该数组追加并在 `index.css` 添加对应 `[data-theme=...]` 块。

### 3.2 组件样式组织
- 组件内样式以 **Tailwind utility class** 为主，配合 `bg-[var(--color-bg-*)]`、`text-[var(--color-*)]` 等任意值引用主题变量，实现主题感知。
- 组件不持有独立 `.css` 文件，所有样式就近写在 JSX 的 `className` 中。
- 公共动画（折叠消息、上下文菜单、BottomSheet 滑入滑出、Toast 下滑、搜索高亮闪烁等）集中在 `src/index.css` 的 `@keyframes` 与 `.animate-*` 类中，组件通过复用这些类获得一致动效。
- 全局行为：禁止页面级滚动与橡皮筋效果（`overflow: hidden; overscroll-behavior: none; touch-action: manipulation`）、禁用文本选中（输入框除外）、自定义细滚动条、highlight.js 背景覆盖。

### 3.3 响应式策略
- 未引入媒体查询断点配置，布局与间距完全依赖 Tailwind 的响应式前缀（如 `md:`、`lg:`）与 flex/grid 布局。
- 移动端优先：全局禁用缩放、优化触摸交互（`touch-action: manipulation`），底部导航栏 `BottomNavBar` 提供移动端主入口。

### 3.4 图标与资源
- 图标统一来自 `lucide-react`，避免手写 SVG 带来的风格不一致。
- PWA 图标与 provider logo 放在 `public/icons/`、`public/providers/`，由 manifest 与 HTML 引用。

## 4. 约定与约束
- **主题切换入口**：必须通过设置 `document.documentElement.dataset.theme` 来切换，新增主题需同步更新 `src/config/themes.ts` 的 `THEMES` 列表。
- **颜色使用规范**：组件内不得硬编码具体颜色值（除调试/临时场景），应使用 `var(--color-*)` 并通过 Tailwind 任意值语法 `bg-[var(...)]` / `text-[var(...)]` 引用，以保证跟随主题。
- **动画归属**：跨组件复用的 UI 动效（折叠、滑入滑出、闪烁、Toast）应定义在 `src/index.css` 的 `@keyframes` 中并以 `.animate-*` 类暴露，组件侧只引用类名。
- **滚动与手势**：全局已锁定 `html/body/#root` 的滚动与缩放，新增需要滚动的区域应使用容器内滚动而非页面滚动。
- **代码块样式**：统一通过 `pre code` 与 `.hljs` 覆盖，确保不同主题下代码背景一致。
- **可访问性**：折叠态气泡保留 `:focus-visible` 轮廓；动画遵守 `prefers-reduced-motion` 媒体查询，将时长压缩至 `1ms`。

## 5. 总结
该项目采用 **Tailwind v4 + CSS 变量主题** 的前端样式方案：主题通过 `data-theme` 属性驱动一组语义化 CSS 变量，组件以 Tailwind utility class 组合布局与配色，公共动画集中在单一 CSS 文件中。该模式使得“暗夜紫”和“终端绿”两套主题可以无缝切换，且新增主题的成本极低——只需追加 CSS 变量块与主题元数据即可。