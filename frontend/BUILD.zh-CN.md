# 前端构建说明

使用 Node.js 22.12 或更高版本，在 `qingshuige-search` 根目录执行：

```bash
npm ci
npm run build
```

Vite 配置会将构建结果写入：

```text
assets/qingshuige-vue/
├─ qingshuige-vue.js
└─ qingshuige-vue.css
```

构建入口为本模块的 `frontend/main.js`，配置为 `vite.config.js`。构建仅更新本模块的上述目录，不更新原 Hugo 项目的 `public/` 或主题编译资源。

`npm test` 会先构建再执行核心、客户端及生产脚本交互测试；`npm run test:core` 只执行算法测试。构建不需要原站点的 `packages/` 或主题目录，旧资源存档不参与构建。
