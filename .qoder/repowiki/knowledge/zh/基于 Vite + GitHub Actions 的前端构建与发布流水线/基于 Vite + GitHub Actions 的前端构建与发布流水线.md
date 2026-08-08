---
kind: build_system
name: 基于 Vite + GitHub Actions 的前端构建与发布流水线
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - vite.config.ts
    - .github/workflows/release.yml
    - src/config/version.ts
    - tsconfig.app.json
    - tsconfig.node.json
    - tsconfig.json
    - .npmrc
---

## 1. 构建系统概览

该项目采用 **Vite 8** 作为前端构建工具，配合 **TypeScript 6** 进行类型检查与编译，使用 **ESLint** 做代码质量检查。整个构建流程由 `package.json` 中的 npm scripts 驱动，并通过 GitHub Actions 在打 tag 时自动触发 CI/CD。

## 2. 关键文件与脚本

- `package.json`：定义项目元信息（`name: aishop`, `version: 1.2.0`）、依赖及四个核心脚本：
  - `dev`: `vite` — 启动开发服务器
  - `build`: `tsc -b && vite build` — 先通过 TypeScript 的 Project References (`-b`) 执行多 tsconfig 联合类型检查，再调用 Vite 打包
  - `lint`: `eslint .` — 静态检查
  - `preview`: `vite preview` — 预览构建产物
- `vite.config.ts`：注册 `@vitejs/plugin-react` 和 `@tailwindcss/vite` 插件；将 `package.json` 中的版本号通过 `define.__APP_VERSION__` 注入到运行时常量；开发服务器监听 `0.0.0.0` 以支持容器访问。
- `tsconfig.app.json` / `tsconfig.node.json` / `tsconfig.json`：分别配置应用代码、Node 侧代码与根引用，供 `tsc -b` 按顺序编译。
- `src/config/version.ts`：导出 `APP_VERSION = __APP_VERSION__` 以及 `getVersionInfo()`（包含版本号和构建时间），是版本信息的唯一消费入口。
- `.github/workflows/release.yml`：CI 流水线，监听 `v*` 标签推送，使用 Node 20 环境，执行 `npm install` → `npm run build`，并将 `dist/` 目录作为 artifact 上传。
- `.npmrc`：存在但为空，未配置自定义 registry。

## 3. 架构与设计约定

- **单一版本源**：版本号仅维护在 `package.json` 中，Vite 构建时通过 `define` 注入为全局常量 `__APP_VERSION__`，业务代码通过 `src/config/version.ts` 暴露的 `getVersionInfo()` 获取，避免多处同步。
- **TypeScript 联合编译**：`build` 脚本先跑 `tsc -b`，利用 TypeScript 的 Project References 能力对多个 tsconfig 进行增量类型检查，确保跨模块类型一致性后再进入 Vite 打包阶段。
- **插件化构建**：Vite 通过插件体系集成 React JSX/TSX 转换与 Tailwind CSS v4（`@tailwindcss/vite`），无需额外 postcss 配置。
- **CI 触发条件**：仅在推送 `v*` 格式的 Git tag 时触发构建，日常 push 不触发，便于按版本发布管理。
- **产物输出**：构建产物统一输出到 `dist/` 目录，由 GitHub Actions 的 `upload-artifact` 动作归档。

## 4. 约束与规则

- 版本变更必须修改 `package.json` 的 `version` 字段，禁止直接修改 `src/config/version.ts` 中的值（该文件注释明确说明“单一来源，改 package.json 即可”）。
- 构建命令固定为 `npm run build`，不可省略前置的 `tsc -b` 类型检查步骤。
- CI 环境强制使用 Node.js 20（由 `setup-node@v4` 指定），并启用 npm 缓存加速安装。
- 发布流程目前仅产出静态资源 artifact，未配置自动部署到托管平台或生成 Release 附件，需人工处理后续分发。
- 开发服务器默认绑定 `0.0.0.0`，以便在 Docker 等容器环境中通过宿主网络访问。

## 5. 缺失或不完整之处

- 无 Makefile、Dockerfile 或独立构建脚本，所有构建逻辑集中在 npm scripts 与 Vite 配置中。
- `.npmrc` 为空，未配置私有 npm registry，依赖全部来自公共 npm。
- 未配置预提交钩子（如 husky）或分支保护规则来强制 lint/typecheck。
- 未配置源码映射（source map）或性能分析相关选项，构建配置较为精简。