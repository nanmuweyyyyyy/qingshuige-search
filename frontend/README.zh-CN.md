# 搜索前端

搜索核心位于 `src/`，不依赖 DOM、Hugo 或 Vue。浏览器适配器位于 `adapters/browser/`，负责获取索引、检查同源 URL、缓存和重试；Vue 弹层只负责界面与交互。旧 `frontend/search/search-client.js` 保留为适配器的兼容导出。

在 `qingshuige-search` 根目录执行：

```sh
npm ci
npm run build
npm test
```

产物为 `assets/qingshuige-search/qingshuige-search.js` 和 `qingshuige-search.css`。Hugo 项目通过模块挂载加载资源，见 [Hugo 适配说明](../adapters/hugo/README.zh-CN.md)。其他平台可托管这两个文件，加载 CSS 和 ES module 脚本后添加一个搜索挂载节点：

```html
<button type="button" data-search-trigger aria-haspopup="dialog"
        aria-controls="qsg-search-dialog" aria-expanded="false">搜索</button>
<div data-qsg-search
     data-search-index-url="/search-index.json"
     data-search-options='{"maxResults":12,"snippetLength":110,"matchMode":"all"}'
     data-search-ui='{"debounceMs":180}'></div>
```

`data-search-options` 是传给核心的 JSON 对象；`data-search-ui` 支持 `resultLimit`（正整数）和 `debounceMs`（非负数，默认 180）。未设置 `resultLimit` 时使用核心配置的 `maxResults`，再回退至 20。由 HTML 模板输出 JSON 时需转义属性值。旧 `data-vue-component="SearchPanel"` 仍可使用，其他 Vue 组件标记会被忽略；重复加载脚本不会重复挂载同一节点。

搜索索引须为同站点文章数组；结构见根目录 README。客户端验证索引地址和结果 URL，懒加载并缓存索引，网络错误、无效索引或超时后可重试。弹层支持 Ctrl/⌘+K、Esc、方向键、分类筛选和中文输入法。

组件样式支持 `--qsg-ink`、`--qsg-ink-soft`、`--qsg-border`、`--qsg-blue-100/500/800` 主题变量，并提供默认颜色。弹层通过 Vue Teleport 放入 `body`，打开时将弹层之外的页面子树设为 `inert`，关闭时恢复原有状态、滚动位置和焦点，无需特定主题类名。

## 在其他前端中调用

```js
import { createSearchClient } from "qingshuige-search/browser"

const client = createSearchClient("/search-index.json", {
  engineOptions: { maxResults: 12, matchMode: "all" },
  timeoutMs: 12000
})
const results = await client.search("Hugo 搜索", { category: "技术" })
const categories = await client.categories()
```

浏览器适配器没有 Vue 依赖。非浏览器环境需传入绝对 `baseUrl` 和 `fetch`（若没有全局 `fetch`）；索引与文章链接以 `baseUrl` 解析并校验同源。每个客户端的并发请求共用一次加载。无选项调用在相同页面地址、索引地址及 `fetch` 下复用客户端；显式传入选项时创建独立实例，避免不同搜索策略共用缓存。请长期复用客户端而非为每次输入重新创建。

使用 Vue 的项目可导入 `qingshuige-search/vue`，传入 `indexUrl`、`engineOptions`、`resultLimit` 和 `debounceMs`。这是原始 `.vue` 组件，需要宿主自己的 Vue SFC 构建流程。组件源码和浏览器适配器均不依赖 Node.js 全局变量。

`npm run dev` 启动 Vite 开发资源服务；本模块没有独立演示首页。宿主开发页面可加载 `http://127.0.0.1:5173/@vite/client` 和 `http://127.0.0.1:5173/frontend/main.js` 两个 module 脚本。默认允许宿主来源 `http://localhost:1313`，其他来源需调整 `vite.config.js`。

Hugo 完整接入方式见 [适配说明](../adapters/hugo/README.zh-CN.md)。
