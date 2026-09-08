# 架构说明

`qingshuige-search` 以标准文章数组为边界。宿主决定文章来自哪里、何时加载和如何渲染；搜索核心负责同步索引与检索。

```text
Hugo RegularPages ── adapters/hugo ── JSON Article[]
                                            │
其他静态生成器 / 内存 Article[]              │
                     │                      ▼
                     └───────── adapters/browser（可选 fetch）
                                            │
                                            ▼
                              createSearch(options).load(articles)
                                ├─ article：标准化文章模型
                                ├─ tokenizer：可替换的分词策略
                                ├─ index-builder：倒排表/字段索引
                                ├─ SearchEngine：召回、查询组合、过滤
                                ├─ ranking：可替换的评分策略
                                └─ result-formatter：摘要和结果
                                            │
                                            ▼
                                    SearchResult[]
                                            │
                                   Vue / 其他前端
```

## 边界与入口

- 核心 `src/index.js` 只导出平台无关 API，不导入 Vue、DOM、网络或 Hugo。
- 浏览器适配器 `adapters/browser/index.js` 负责同源 JSON 加载、超时、重试和缓存；支持注入 fetch/baseUrl。
- Vue 前端只消费浏览器客户端和结果模型，挂载点使用 `data-qsg-search`。
- Hugo 适配器生成标准文章数据，解析站点参数并输出客户端配置和资源引用。
- `qingshuige-hugo` 通过 Submodule 固定插件版本，通过 mounts 引入适配器；主题只保留小型模板调用，不再包含搜索算法或 Vue 构建工具链。

## 索引和检索

每篇文章有对外 ID 和内部连续整数 documentId。标题使用标准化短字段扫描，作者和分类使用 Map，正文使用按 documentId 排序的倒排表。每个 posting 保存词频与原文位置。

默认中文使用二元滑动分词。单字查询只匹配短字段，避免正文噪声；技术词保留连续英文/数字并为 Vue3 等版本词提供基本词别名。词组内部先求交，再验证连续短语，避免散落的中文 bigram 造成误报。高频词阈值用于减少候选求交工作量，所有词都高频时仍保留召回入口，防止小语料完全漏搜。

多组关键词可选任一匹配（any）或全部匹配（all），分类是前置过滤。匹配可以跨标题、作者和正文。日期查询读取文章记录自身的年月日，不把带时区的午夜文章移动到 UTC 前一天。

默认评分结合字段权重、查询覆盖率、平滑 TF-IDF 和短语奖励。日期不作为默认的新近度加权，只参与日期查询及同分排序。召回和评分分离；替换 ranker 不需要修改倒排表，替换 formatter 不影响候选排序。只对最终需要返回的结果做格式化。

## 扩展约定

`createSearch(options)` 和 `SearchEngine` 使用相同实现。调用 `load` 会重建索引，失败时保留旧索引。Tokenizer 的建索引与查询方法必须使用同一词汇空间；默认连续短语验证可按查询组策略关闭，以接入词干或同义词等非字面匹配。

当前版本不包含模糊搜索、Worker、远程索引服务或索引持久化。这些能力可在独立 adapter 或新策略中实现，当前无需为未来平台增加依赖。标准字段、策略上下文和示例见 [API 文档](API.zh-CN.md)。

## Hugo 发布路径

索引资源的输出路径与客户端加载地址来自同一个 `indexPath` 配置。Hugo 适配器创建 JSON 资源，并使用其实际 RelPermalink 传给浏览器；无须另设首页 SearchIndex 输出格式。相关 Hugo 行为参见 [resources.FromString](https://gohugo.io/functions/resources/fromstring/) 和 [module mounts](https://gohugo.io/configuration/module/#mounts)。

适配器按语言分离索引，仅枚举当前语言的普通页面；尊重栏目筛选和文章 `searchHidden` 标记。关闭插件后不生成索引引用、脚本、样式或挂载点。
