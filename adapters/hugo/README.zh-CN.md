# Hugo Adapter

此适配器把 Hugo 页面转换为标准 `Article[]`，生成搜索数据文件，并挂载插件提供的浏览器界面。搜索核心、浏览器加载器和 Vue 面板分别位于 `src/`、`adapters/browser/` 和 `frontend/`；主题只调用模板接口。

要求 Hugo **0.158.0 或以上**。模板使用 `_partials` 目录。随插件发布的 `assets/qingshuige-search/` 包含编译资源；只有修改前端源码时，才需要 Node.js 22.12 或以上，并在插件根目录执行 `npm ci`、`npm run build`。

## 接入宿主

以 Git Submodule 方式把[插件仓库](https://github.com/nanmuweyyyyyy/qingshuige-search)检出到 `plugins/qingshuige-search`：

```sh
git submodule add https://github.com/nanmuweyyyyyy/qingshuige-search.git plugins/qingshuige-search
```

已有子模块的项目可执行：

```sh
git submodule update --init --recursive
```

将本目录的 [`config.yaml`](./config.yaml) 合并到宿主 Hugo 配置。挂载插件的 layouts、adapter assets 和编译 assets；如果站点已有 `module.mounts`，保留原有条目，同时保留站点自己的 `layouts`、`assets` 挂载。无需复制插件源码或资源到主题，也无需注册首页 `SearchIndex` output format。

在页面 `<head>` 中调用：

```go-html-template
{{ if templates.Exists "_partials/qingshuige-search/head.html" }}
  {{ partial "qingshuige-search/head.html" . }}
{{ end }}
```

在导航内需要显示按钮的位置调用：

```go-html-template
{{ if and .Site.Params.qingshuigesearch.enabled (templates.Exists "_partials/qingshuige-search/trigger.html") }}
  {{ partial "qingshuige-search/trigger.html" (dict "page" .) }}
{{ end }}
```

如果导航模板的上下文是字典，将 `page` 设为其中的 Hugo Page，例如 `$page`。按钮 partial 还接受可选参数 `label`，用于无障碍名称；`floating: true` 会生成独立浮动按钮，适合没有导航扩展点的主题。

在每页 `</body>` 前调用一次：

```go-html-template
{{ if templates.Exists "_partials/qingshuige-search/scripts.html" }}
  {{ partial "qingshuige-search/scripts.html" . }}
{{ end }}
```

`templates.Exists` 让主题在没有挂载插件时仍可独立构建。启用插件但缺少编译资源时，构建会报出包含修复命令的错误。

## 配置

```yaml
params:
  qingshuigeSearch:
    enabled: true
    indexPath: data/search-index.json
    sections: [blog, almanac]
    engine:
      hanGramSize: 2
      minWordLength: 2
      maxDocumentFrequencyRatio: 0.6
      maxResults: 20
      snippetLength: 110
      matchMode: any
      weights:
        titleExact: 20
        titlePrefix: 15
        titleContains: 10
        authorExact: 8
        authorContains: 5
        coverage: 10
        titlePhrase: 10
        bodyPhrase: 5
    ui:
      debounceMs: 120
      # resultLimit: 20  # 可选：只覆盖面板的结果数量上限
```

| 字段 | 作用 |
| --- | --- |
| `enabled` | 默认为关闭。关闭时不生成搜索索引，也不输出面板、按钮和搜索资源引用。 |
| `indexPath` | 默认 `search-index.json`。同时决定生成文件和浏览器请求地址。必须是相对 `.json` 路径，不含 `.`、`..` 路径段、查询参数或片段。 |
| `sections` | 要索引的内容栏目，例如 `[blog, almanac]`。省略或 `[]` 表示所有普通页面。 |
| `engine` | 搜索核心配置，支持上例中的字段。`matchMode: any` 召回任一关键词组；`all` 要求满足全部关键词组。`weights` 控制默认排序中的字段权重。 |
| `ui.debounceMs` | 输入防抖时间，单位毫秒，允许 `0`。 |
| `ui.resultLimit` | 面板结果上限；省略时采用 `engine.maxResults`，核心未配置时为 `20`。 |

Hugo 会将参数键转为小写；`config.html` 使用明确字段表重新构造 `hanGramSize`、`maxResults`、`titleExact` 等 JavaScript 键。因此在 Hugo 配置中继续使用公开 API 的 camelCase 写法即可。自定义 Tokenizer、Ranker 或 Formatter 是 JavaScript 策略对象或函数，需通过 JavaScript API 注入，不能写入 YAML。

修改 `indexPath` 后不需要另改 URL 或 output format。适配器通过 `resources.FromString` 生成该文件，再把资源的 `.RelPermalink` 传给前端，因此 `baseURL: https://example.com/docs/` 配合 `indexPath: data/articles.json` 会请求 `/docs/data/articles.json`。

多语言站点会为索引增加语言代码前缀，例如 `/docs/zh/data/articles.json` 和 `/docs/en/data/articles.json`。每份索引只包含对应语言的页面；资源目标和 partial 缓存均按语言隔离。这也适用于默认语言首页不带语言前缀的站点：索引仍按语言代码分开。

## 文章模型与筛选

每条数据包含 `id`、`title`、`author`、`date`、`categories`、`tags`、`content`、`url`。`id` 与 `url` 均使用文章 `.RelPermalink`；`content` 使用 Hugo `.Plain` 并解码一层 HTML 实体，使摘要显示可读的引号和 `&` 等字符。日期采用带时区的 RFC 3339 格式。

- `categories`、`tags` 的标量值会转换为数组，缺省为空数组。
- 作者支持字符串、`{name: ...}` 对象，以及上述形式的数组；多作者用逗号连接。文章未设置作者时回退到站点 `params.author`。
- 文章 `searchHidden: true` 会从索引中排除。
- 草稿、未来文章等遵循 Hugo 当前构建的页面集合；例如显式使用 `-D` 预览时，草稿也可能出现在搜索中。
- `sections` 在上述基础上继续筛选 `.Section`，不会索引分类列表页和标签列表页。

关闭搜索后，Hugo 不再生成对应文件，但不会自动清理此前构建遗留的输出。发布时应使用干净的目标目录，或按部署流程清理旧产物。

## 模板与浏览器边界

公开模板接口为 `qingshuige-search/head.html`、`qingshuige-search/trigger.html`、`qingshuige-search/scripts.html`。`config.html`、`index.html`、`author.html` 是 adapter 内部实现。

scripts partial 输出的浏览器挂载契约为：

```html
<div data-qsg-search
     data-search-index-url="/search-index.json"
     data-search-options='{"maxResults":20}'
     data-search-ui='{"debounceMs":120}'></div>
```

前端加载器读取这三个 `data-*` 参数，通过浏览器 adapter 延迟获取索引。主题只负责调用模板，不必导入 Vue、理解 Article 索引或直接调用核心模块。CSS 类和默认变量限定在 `qsg-search-*` 插件元素上，不修改宿主的通用按钮、布局或导航样式。

## 清水阁的官方接入

`qingshuige-hugo/hugo.yaml` 集中保存 `params.qingshuigeSearch` 和模块挂载配置，默认索引 `blog`、`almanac`。PaperMod 通过 `extend_head.html`、`extend_footer.html` 挂载搜索，并使用浮动按钮；qingshuige-theme 通过 head、scripts、menu 三处模板 hook 挂载资源和导航按钮。`qingshuige-theme-preview.yaml` 继承同一份搜索配置。

这些调用没有引用旧 `qingshuige-vue` 构建资源，也没有让主题重新包含搜索核心源码。

## 验证

在插件根目录执行：

```sh
npm run test:hugo
```

如果 Hugo 没有加入 PATH，可在 PowerShell 指定：

```powershell
$env:HUGO_BIN = 'C:/tools/hugo/hugo.exe'
npm run test:hugo
```

该命令实际构建临时 Hugo 站点，验证索引字段与筛选、配置键大小写、关闭开关、自定义路径、子目录 baseURL、多语言隔离及缺失资源错误。`test:hugo` 找不到 Hugo 时会失败；普通 `npm test` 没有 Hugo 时会明确跳过 Hugo 部分，其他测试仍正常运行。
