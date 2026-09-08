# qingshuige-search

从清水阁 Hugo 项目分离出的完整搜索模块，包含搜索引擎、Vue 搜索弹层、索引客户端、Hugo 接入示例、编译资源和测试。整个文件夹可以单独移动，不依赖原站点或主题的相对路径。

## 目录

- `src/`：无运行时依赖的搜索核心，包括中文二元分词、倒排索引、排序、日期查询和高亮信息。
- `frontend/`：Vue 搜索界面和索引客户端。
- `assets/qingshuige-vue/`：当前前端构建产物。
- `test/`：搜索算法、客户端和生产脚本的 DOM 交互测试。
- `examples/hugo/`：通用 JSON 索引示例；`theme-integration/` 保留实际主题使用的索引模板和搜索接入片段。
- `examples/data/search-index.json`：分离时复制的站点索引，可用于验证与性能基准。
- `archive/public-qingshuige-vue/`：原 `public` 搜索资源的副本，仅作旧版本存档。
- `benchmark/`、`docs/`：基准脚本及原有设计文档。

## 构建和测试

在本文件夹内使用 Node.js 22.12 或更高版本：

```sh
npm ci
npm run build
npm test
```

`npm test` 会先构建，再运行全部测试。只验证算法可运行 `npm run test:core`，不需要安装开发依赖。

```sh
npm run benchmark -- examples/data/search-index.json Hugo 计算机
```

Vue、Vite 和 jsdom 仅为开发依赖。直接使用 `src/index.js` 不需要 Hugo 或 Vue。

## 使用搜索核心

```js
import { SearchEngine } from './src/index.js'

const engine = new SearchEngine().load([
  {
    id: 'hello',
    title: 'Hugo 搜索',
    author: '清水阁',
    date: '2026-09-08T00:00:00+08:00',
    categories: ['学'],
    content: '中文全文检索示例',
    url: '/blog/hello/'
  }
])

console.log(engine.search('全文检索'))
```

## 使用搜索界面

见 [前端说明](frontend/README.zh-CN.md) 和 [Hugo 接入说明](examples/hugo/theme-integration/README.zh-CN.md)。示例需要主动接入，不会自动给原站点重新启用搜索。

## 本次分离范围

原 `packages/qingshuige-search` 搜索核心与主题的搜索前端、测试、构建配置已迁入本目录。原主题导航、资源加载模板和预览配置中的搜索部分已剔除，其他页面功能保留。

按要求，原站点的 `public/`、主题已有编译资源及其他生成内容保持原样。因此已有生成页面仍可能显示旧的搜索功能；本次分离针对源码与配置，没有重新生成站点。

核心代码沿用根目录 [MIT 许可证](LICENSE)，来自主题的前端代码另保留 [原主题许可证](frontend/LICENSE)。
