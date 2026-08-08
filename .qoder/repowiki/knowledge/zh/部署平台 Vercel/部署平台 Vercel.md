---
kind: external_dependency
name: 部署平台 Vercel
slug: vercel
category: external_dependency
category_hints:
    - client_constraint
scope:
    - '**'
---

### 角色
项目公开部署目标，`.env.example` 明确说明通过 Vercel 控制台 Environment Variables 注入密钥。

### 约束
- 公网部署强烈建议设置 `ACCESS_CODE` 作为访问码，首次访问要求输入密码，后续请求携带 `X-Access-Code` 头进行鉴权。
- 本地开发使用 `vercel dev` 时 `.env.local` 生效。