# qingshuige-search

面向静态网站的轻量本地搜索插件。搜索核心没有运行时依赖，也不访问 DOM、网络或 Hugo；浏览器数据加载、Vue 界面和 Hugo 索引生成分别由适配层提供。

## 快速使用核心

```js
import { createSearch } from 'qingshuige-search'

const search = createSearch({ maxResults: 20, matchMode: 'any' }).load([
  {
    id: 'hello',
    title: 'Hugo 搜索',
    author: '清水阁',
    date: '2026-09-08T00:00:00+08:00',
    categories: ['学'],
    tags: ['Hugo'],
    content: '中文全文检索示例',
    url: '/blog/hello/'
  }
])

const results = search.search('全文检索', { category: '学', limit: 10 })
console.log(results[0]?.article, results[0]?.snippet)
```

源码直接使用时，将包名替换为 `./src/index.js`。旧的 `new SearchEngine(options).load(articles)` 入口继续有效。

默认支持中文二元分词、英文及技术词、标题/作者/正文检索、分类过滤和日期查询。多个关键词默认任一匹配；`matchMode: 'all'` 要求所有查询组匹配。正文连续中文短语会进一步验证，避免仅因零散 bigram 同时出现而误报。排序、分词和结果格式化均可替换，见 [API 文档](docs/API.zh-CN.md)。

## 浏览器与 Hugo

```js
import { createSearchClient } from 'qingshuige-search/browser'

const client = createSearchClient('/search-index.json', {
  engineOptions: { matchMode: 'all', maxResults: 10 }
})
console.log(await client.search('Hugo 搜索'))
```

浏览器客户端按需加载 JSON、复用同一实例的并发请求和内存索引，失败后允许重试。它不依赖 Vue；其他前端框架可以直接消费结果。

第一个官方适配案例为 `qingshuige-hugo`，支持 PaperMod 和清水阁主题。插件通过 Git Submodule 引入，Hugo mounts 直接读取适配模板与构建资源，无需复制源码或构建产物。开关、索引路径、内容栏目和搜索策略集中在 `params.qingshuigeSearch`。见 [Hugo 接入说明](adapters/hugo/README.zh-CN.md)。

## 开发与验证

Node.js 22.12+：

```sh
npm ci
npm test
npm run test:core
npm run test:hugo
npm run benchmark -- examples/data/search-index.json Hugo 计算机
```

`npm test` 先构建 Vue 浏览器资源，再运行核心、客户端与 DOM 测试。Hugo 集成测试需要 Hugo 0.158.0+；可使用 `HUGO_BIN` 环境变量指定可执行文件。只使用核心不需要安装 Vue、Vite、jsdom 或 Hugo。

```text
src/                        文章模型、索引、检索、可替换策略、统一 API
adapters/browser/           JSON 加载与浏览器 URL 约束
adapters/hugo/              Hugo 模板、配置、默认样式
frontend/                   Vue 搜索弹层及挂载入口
assets/qingshuige-search/   可直接被 Hugo 读取的构建产物
test/                       核心、客户端、生产脚本和 Hugo 回归测试
benchmark/                  使用真实文章索引的基准脚本
```

`archive/` 与旧 `examples/hugo/theme-integration/` 保留历史提取资料，不属于当前接入入口，也不包含在发布包内。当前模板和配置以 `adapters/hugo/` 为准。架构边界见 [架构说明](docs/ARCHITECTURE.zh-CN.md)。

核心使用 [MIT](LICENSE)，前端保留 [原作者 MIT 声明](frontend/LICENSE)，预构建浏览器资源包含 Vue，许可证见 [第三方声明](THIRD_PARTY_NOTICES.md)。
