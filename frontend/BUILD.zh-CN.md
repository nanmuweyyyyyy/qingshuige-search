# 前端构建说明

使用 Node.js 22.12 或更高版本，在 `qingshuige-search` 根目录执行：

```bash
npm ci
npm run build
```

Vite 配置会将构建结果写入：

```text
assets/qingshuige-search/
├─ qingshuige-search.js
└─ qingshuige-search.css
```

构建入口为本模块的 `frontend/main.js`，配置为 `vite.config.js`。入口调用 `frontend/mount.js`，识别 `data-qsg-search` 节点并读取 JSON 搜索/UI 配置。构建仅更新本模块的上述目录，不更新 Hugo 项目的 `public/`。Hugo 通过模块挂载引用插件产物，不需要向主题目录手动复制，具体配置见 [Hugo 适配说明](../adapters/hugo/README.zh-CN.md)。

`npm test` 会先构建再执行核心、客户端及生产脚本交互测试；`npm run test:core` 只执行算法测试。构建不需要原站点的 `packages/` 或主题目录。框架无关的 `qingshuige-search/browser` 导出直接指向 `adapters/browser/index.js`；`qingshuige-search/vue` 导出原始 Vue 组件，供宿主自行构建。
