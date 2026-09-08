# Hugo 搜索接入示例

此目录保存原清水阁主题实际使用的搜索索引模板、资源加载片段和按钮样式。它是可选接入示例；源码分离后，原站点不会自动引用本目录。

## 接入步骤

1. 在独立 `qingshuige-search` 根目录执行 `npm ci`、`npm run build`。
2. 将生成的 `assets/qingshuige-vue/` 复制到宿主站点的 `assets/qingshuige-vue/`。
3. 将本目录的 `layouts/` 合并到宿主站点的 `layouts/`。模板使用 Hugo 0.158 或更高版本的 `_partials` 目录结构。
4. 将 `config.yaml` 中的搜索配置合并到宿主配置，保留宿主原有的其他首页输出格式，按实际文章目录调整 `sections`。
5. 将本目录 `assets/search-defaults.css` 和 `assets/search-trigger.css` 复制到宿主 `static/qingshuige-search/`，并在页面 `<head>` 添加下列内容。

```go-html-template
{{ if site.Params.qingshuige.search.enabled }}
  <link rel="stylesheet" href="{{ "qingshuige-search/search-defaults.css" | relURL }}">
  <link rel="stylesheet" href="{{ "qingshuige-search/search-trigger.css" | relURL }}">
{{ end }}
{{ partial "search/css.html" . }}
```

在导航需要显示搜索按钮的位置调用：

```go-html-template
{{ if site.Params.qingshuige.search.enabled }}
  <li class="site-nav__item">{{ partial "search/trigger.html" . }}</li>
{{ end }}
```

在 `</body>` 前调用一次：

```go-html-template
{{ partial "search/scripts.html" . }}
```

运行宿主 Hugo 后，首页额外生成 `search-index.json`。索引模板支持文章 `searchHidden: true`、`params.qingshuige.search.sections` 筛选，并在文章未指定作者时使用 `site.Params.author.name`。

## 宿主约定

弹层对 `.site-header`、`.site-main`、`.site-footer`、`.skip-link` 临时设置 `inert`。其他主题应为相应页面区域提供这些类名，或调整 `SearchPanel.vue` 中的背景区域选择器后重新构建。

默认样式只设置搜索弹层和按钮使用的变量。宿主可在默认样式之后覆盖变量。资源缺失时，Hugo 片段会提示构建搜索模块；构建后仍需复制资源到宿主，本模块不会写入宿主生成目录。

上一级 `home.searchindex.json` 是原有的通用引擎示例；本目录中的模板额外保留了栏目过滤及站点默认作者逻辑。`../legacy/head-vue.html` 仅保存旧模板，不应接入当前构建流程。
