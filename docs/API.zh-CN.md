# 公共 API（0.2）

## 文章模型

```js
{
  id: 'post-1',                       // 字符串或有限数字；省略则使用数组下标
  title: '静态站点搜索',
  content: '正文纯文本',
  author: '作者',                     // 核心也接受字符串数组并连接为文本
  date: '2026-09-08T00:00:00+08:00',  // 推荐 RFC 3339；无效/缺失归一化为 null
  categories: ['学'],                 // 标量转数组，移除空值与重复项
  tags: ['Hugo'],                     // 保留元数据；当前不参与默认检索
  url: '/blog/post-1/'
}
```

`title` 或 `content` 至少一个非空。缺省的文本为 `''`，列表为 `[]`。原始额外字段会保留，核心不会修改调用方输入数组或标准字段。核心允许没有 URL 的内存记录；浏览器 adapter 要求非空、同源的 HTTP(S) 结果 URL。

`normalizeArticle(article, index?)` 和 `normalizeArticles(articles)` 可独立调用。日期字符串仅接受有效的 `YYYY-MM-DD` 或带明确时区的 RFC 3339；也可传 Date 对象或毫秒时间戳。不猜测本地化日期，非法日期归一化为 null。Hugo adapter 负责将 Hugo 作者对象、分类和页面日期转换为该模型。

## 搜索实例

```js
import { createSearch, SearchEngine } from 'qingshuige-search'

const search = createSearch(options) // 等价于 new SearchEngine(options)
search.load(articles)                // 返回实例；重建索引；失败保留上次有效索引
const results = search.search('Hugo 搜索', {
  limit: 10,
  category: '学',
  matchMode: 'all'
})
```

`search` 同步返回结果数组；空关键词或 `limit: 0` 返回空数组。省略 category 搜索所有分类；指定未知分类返回空数组。每次查询的 limit/matchMode 覆盖实例默认值。

| 实例配置 | 默认值 | 约束与作用 |
| --- | --- | --- |
| maxResults | 20 | 正整数，默认返回上限 |
| snippetLength | 110 | 正整数，摘要的 UTF-16 长度目标，不切开代理对 |
| hanGramSize | 2 | 大于等于 2 的整数，连续汉字 n-gram 长度 |
| minWordLength | 2 | 正整数，英文/数字词最短字符数 |
| maxDocumentFrequencyRatio | 0.6 | 0–1，选择低频召回锚点；全部词高频时仍会召回 |
| matchMode | any | any 匹配任一查询组；all 匹配全部组，可跨字段 |
| weights | 见下文 | 有限非负数，控制默认评分 |
| tokenizer | defaultTokenizer | 同时实现 tokenize 与 tokenizeQuery |
| ranker | defaultRanker | 接收上下文，返回有限数字 |
| formatter | defaultFormatter | 接收带 score 的上下文，返回自定义结果 |

默认权重：titleExact=20、titlePrefix=15、titleContains=10、authorExact=8、authorContains=5、coverage=10、titlePhrase=10、bodyPhrase=5。仅覆盖需要修改的权重即可。

日期支持单独的年、年月、年月日，例如 `2026`、`2026-09`、`2026年9月8日`。文章日期优先使用发布者写入的日历日，时间戳用于同分排序。日期查询不是混合自然语言解析器。

## 结果

默认 Formatter 返回：

```js
{
  article,                 // 标准文章，保留自定义字段
  documentId,              // 本次 load 内部整数 ID，不跨重载持久化
  externalId,              // article.id
  score,
  coverage,                // 0–1，全部查询组在标题/作者/正文中的覆盖率
  matchedFields: {
    title: null,           // null | 'exact' | 'prefix' | 'contains'
    author: null,          // null | 'exact' | 'contains'
    date: false,
    body: false
  },
  matchedTokens: [],
  snippet                  // 纯文本；UI 必须按文本渲染
}
```

分数相同时按时间倒序；同时间或无日期的记录再按原输入顺序。结果先排序并截断，再调用 formatter。默认不会返回 HTML，高亮和交互由前端负责。

## 可替换策略

```js
import { createSearch, defaultTokenizer, defaultRanker, defaultFormatter } from 'qingshuige-search'

const search = createSearch({
  tokenizer: defaultTokenizer,
  ranker(context) {
    return defaultRanker(context) + (context.article.featured ? 3 : 0)
  },
  formatter(context) {
    return { ...defaultFormatter(context), source: context.article.source }
  }
})
```

Ranker 收到：

```js
{
  article,
  document, // {docId, externalId, article, normalized, date, categories}
  candidate, // 字段匹配、matchedGroups/bodyGroups Set、bodyPostings Map 等召回信息
  groups,
  rawQuery, // 用户输入
  query,    // 标准化后的输入
  coverage,
  options,
  statistics: {
    documentCount,
    getDocumentFrequency(token) // 返回正文词的文档频率
  }
}
```

Formatter 额外收到 `score`。自定义排序建议使用 article、coverage 和 statistics；如需复用现有相关度，调用 defaultRanker 后调整即可。

自定义 Tokenizer 需要成对实现：

```js
{
  tokenize(content, options) {
    // 返回原文 UTF-16 偏移；同词出现多次则返回多个 occurrence
    return [{ value: 'search', position: 0 }]
  },
  tokenizeQuery(query, options) {
    return [{
      raw: 'search',
      tokens: ['search'],
      bodySearchable: true,
      type: 'word',
      verifyPhrase: false
    }]
  }
}
```

两端的 token 必须在同一词汇空间。核心会再次标准化 token 值。组内 token 使用 AND，不同组按 matchMode 组合。默认 Han 组需要连续短语；自定义词干/同义词组可设 `verifyPhrase: false`。occurrence.position 必须是正文范围内的非负整数；自定义分词器应按原文位置返回 occurrence，以获得合理摘要。

## 浏览器 adapter

```js
import { createSearchClient } from 'qingshuige-search/browser'

const client = createSearchClient('data/search-index.json', {
  baseUrl: 'https://example.org/docs/', // 浏览器中省略即当前页面地址
  fetch,                               // 可选，默认 globalThis.fetch
  timeoutMs: 12000,
  engineOptions: { maxResults: 12, matchMode: 'all' }
})
await client.load()                    // 可预热；返回引擎
await client.categories()              // 排序并去重的分类列表副本
await client.search('Hugo 搜索')        // Promise<SearchResult[]>
```

客户端只接受同源索引和结果地址。相对 URL 以 baseUrl 解析。无配置调用按页面/索引 URL 及 fetch 身份复用客户端；显式配置创建独立实例，调用方应复用实例。每个实例只有一次进行中的加载，成功后缓存内存索引，失败或超时后可以重试。

根导出不导入浏览器或 Vue。原 `frontend/search/search-client.js` 保留兼容导出；新项目使用包的 `/browser` 子路径。Vue SFC 导出为 `qingshuige-search/vue`，需要宿主自己的 Vue 编译流程；Hugo 可直接使用附带的预构建浏览器资源。
