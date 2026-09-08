# 搜索模块分离记录

完成日期：2026-09-08。

独立模块位于原工作目录下的 `qingshuige-search/`，可整体复制到其他位置使用。

## 迁移内容

- 原 `packages/qingshuige-search/` 的核心源码、算法测试、设计文档、基准脚本和通用 Hugo 示例。
- 原清水阁主题的 `frontend/`、搜索客户端与弹层测试、Vite 配置及构建依赖。
- 原主题实际使用的索引模板、搜索按钮、资源加载片段和按钮样式，保存为 `examples/hugo/theme-integration/`。
- 原编译资源与生成索引在新模块内保留副本；原位置的生成内容按要求保留。

合并后的 `package.json` 通过包名自引用本目录 `src/index.js`，去除了原先指向 `../../packages/qingshuige-search` 的本地依赖。核心算法、搜索客户端、Vue 组件及全部原有测试均保持原代码。

## 原站点的共享文件改动

以下文件只剔除了搜索部分及其分隔空行：

- `qingshuige-theme-preview.yaml`：搜索参数、菜单项及搜索索引输出。
- `README.md`：搜索修复说明。
- `themes/qingshuige-theme/README.md`：搜索前端构建说明。
- `themes/qingshuige-theme/layouts/_partials/site/menu-items.html`：搜索按钮分支。
- `themes/qingshuige-theme/layouts/_partials/site/scripts.html`：搜索弹层挂载及脚本加载。
- `themes/qingshuige-theme/layouts/_partials/head/css.html`：搜索样式加载。
- `themes/qingshuige-theme/assets/css/components/header.css`：搜索按钮样式，保留头像的共享规则。

文章、媒体、默认 `hugo.yaml`、PaperMod、菜单及开屏脚本等其余文件保持原样；未提交或重置 Git 状态。

## 生成内容保留

原站点 `public/` 的 517 个文件均与操作前 SHA-256 一致。主题 `assets/qingshuige-vue/`、旧 `static/qingshuige-vue/` 等原有编译资源也保持原内容，未运行 Hugo 重建。

因此旧生成页面和资源仍包含此前的搜索功能。源码分离后的站点不再挂载该搜索模块；现有生成内容的保留是用户明确要求。

## 验证

- `npm ci --no-audit --no-fund`：锁定依赖安装成功。
- `npm test`：前端构建成功，原有 28 项测试全部通过。
- `npm run test:core`：12 项核心测试通过。
- `npm run benchmark -- examples/data/search-index.json Hugo 计算机`：成功加载 164 篇文章并完成查询基准。
- 原站点当前模板、主题源 CSS/JS 和预览配置中没有自定义搜索引用。
- 原有文件哈希核对：935 个文件内容未变；只有上述 7 个共享文件修改，31 个原路径的搜索文件迁出或合并。核心源码、客户端、组件及测试在新位置均与原文件一致。
- 主仓库及主题子模块 `git diff --check` 通过。

本机没有可用的 Hugo 可执行文件，未进行整站构建验证。
