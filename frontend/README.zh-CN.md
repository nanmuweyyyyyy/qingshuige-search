# 搜索前端

搜索弹层使用 Vue，算法来自本模块的 `src/`。`search/search-client.js` 通过包名 `qingshuige-search` 自引用根目录导出，无需安装旧站点中的本地路径依赖。

在 `qingshuige-search` 根目录执行：

```sh
npm ci
npm run build
npm test
```

产物为 `assets/qingshuige-vue/qingshuige-vue.js` 和 `qingshuige-vue.css`。复制资源到宿主站点后，在页面中加载 CSS、ES module 脚本，并添加：

```html
<button type="button" data-search-trigger aria-haspopup="dialog"
        aria-controls="qsg-search-dialog" aria-expanded="false">搜索</button>
<div data-vue-component="SearchPanel" data-search-index-url="/search-index.json"></div>
```

搜索索引须为同站点文章数组；结构见根目录 README。客户端验证结果 URL，缓存索引并支持失败后重试。支持 Ctrl/⌘+K、Esc、方向键、分类筛选和中文输入法。

组件样式使用 `--qsg-ink`、`--qsg-ink-soft`、`--qsg-border`、`--qsg-blue-100/500/800`。通用宿主可加载 `examples/hugo/theme-integration/assets/search-defaults.css` 提供默认值，或自行设置这些变量。

弹层打开时会临时对 `.site-header`、`.site-main`、`.site-footer`、`.skip-link` 设置 `inert`，关闭后恢复，并恢复焦点和滚动位置。接入其他页面时请核对这些宿主区域选择器。

`npm run dev` 启动 Vite 开发资源服务；本模块没有独立演示首页。宿主开发页面可加载 `http://127.0.0.1:5173/@vite/client` 和 `http://127.0.0.1:5173/frontend/main.js` 两个 module 脚本。默认允许宿主来源 `http://localhost:1313`，其他来源需调整 `vite.config.js`。

Hugo 完整接入方式见 [接入说明](../examples/hugo/theme-integration/README.zh-CN.md)。
