---
kind: dependency_management
name: 基于 npm + Vite 的前端依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - .npmrc
    - vite.config.ts
    - .gitignore
---

## 1. 使用的系统与工具

本项目采用 **npm** 作为包管理器，配合 **Vite** 作为构建与开发服务器。依赖声明集中在根目录的 `package.json` 中，分为运行时依赖（`dependencies`）与开发时依赖（`devDependencies`），并通过 `package-lock.json` 锁定具体版本以保障可重复构建。

- 包管理器：npm（由 `package-lock.json` 存在且 `.gitignore` 忽略 `node_modules` 推断）
- 构建/打包：Vite (`vite.config.ts`)，通过 `@vitejs/plugin-react` 启用 React 支持
- 类型检查：TypeScript (`typescript ~6.0.2`)，配合 `tsc -b` 在 `build` 脚本中执行
- 代码质量：ESLint (`eslint ^10.3.0`，使用 flat config `eslint.config.js`)

## 2. 关键文件

- `package.json`：唯一依赖清单，定义项目元信息、脚本命令及所有依赖项
- `package-lock.json`：npm 生成的锁文件，锁定依赖树精确版本（被 git 跟踪）
- `vite.config.ts`：构建配置，引入 `@vitejs/plugin-react` 和 `@tailwindcss/vite` 插件
- `.npmrc`：当前为空，未配置私有 registry、镜像源或安装参数
- `.gitignore`：忽略 `node_modules`、`dist`、`.env` 等生成产物

## 3. 架构与约定

### 依赖分类
- **运行时依赖**：React 19、Tailwind CSS v4、idb（IndexedDB 封装）、highlight.js、katex、react-markdown、rehype-katex、remark-gfm、remark-math、pdfjs-dist、xlsx、officeparser、html2canvas、lucide-react、pinyin-match 等
- **开发依赖**：Vite、TypeScript、@types/*、eslint 及其插件、globals

### 版本策略
- 运行时依赖普遍使用 `^` 前缀（如 `"react": "^19.2.6"`），允许小版本升级
- 开发依赖中 TypeScript 使用 `~` 前缀（`"typescript": "~6.0.2"`），仅允许补丁级更新，保证编译器行为一致
- 版本号通过 `vite.config.ts` 中的 `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` 注入到应用代码中

### 构建流程
`npm run build` 执行 `tsc -b && vite build`，先进行 TypeScript 编译再构建产物。`npm run dev` 启动 Vite 开发服务器，监听 `0.0.0.0` 以便局域网访问。

## 4. 约定与约束

- **无私有仓库**：`.npmrc` 为空，未配置任何私有 registry、镜像源或 `registry-auth-token`，所有依赖均从公共 npm registry 获取
- **无 vendoring**：未使用 `vendor/` 目录或类似机制，第三方库通过 `node_modules` 安装
- **锁文件受控**：`package-lock.json` 提交至版本控制，确保团队成员与 CI 环境获得一致的依赖树
- **环境变量隔离**：`.env` 文件被忽略，仅保留 `.env.example` 作为模板，避免敏感配置泄露
- **脚本约定**：标准 npm scripts 提供 `dev`、`build`、`lint`、`preview` 四个入口命令
- **TypeScript 严格性**：通过 `tsconfig.app.json`、`tsconfig.node.json`、`tsconfig.json` 分离应用与 Node 环境的类型配置

该项目是一个单前端工程，依赖管理方式简洁直接，没有多包 monorepo、子模块或复杂的私有源配置。