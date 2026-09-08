import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { JSDOM } from "jsdom"

const pluginRoot = fileURLToPath(new URL("../", import.meta.url))
const hugo = process.env.HUGO_BIN || "hugo"
const probe = spawnSync(hugo, ["version"], { encoding: "utf8", windowsHide: true })
const available = probe.status === 0
if (!available && (process.env.HUGO_BIN || process.env.npm_lifecycle_event === "test:hugo")) {
  throw new Error(`Hugo is required for test:hugo. Set HUGO_BIN to Hugo >= 0.158.0. ${probe.error?.message || probe.stderr}`)
}

function write(root, relative, content) {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function article(title, params = {}, content = "文章正文 Hugo search.") {
  return `${JSON.stringify({ title, date: "2026-08-07", ...params }, null, 2)}\n${content}\n`
}

function buildSite(t, { search = {}, config = {}, pages, assets = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "qsg-hugo-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(path.join(pluginRoot, "adapters/hugo"), path.join(root, "plugin"), { recursive: true })
  write(root, "layouts/baseof.html", `<!doctype html><html><head>{{ partial "qingshuige-search/head.html" . }}</head><body><main>{{ block "main" . }}{{ .Title }}{{ end }}</main>{{ partial "qingshuige-search/trigger.html" (dict "page" . "floating" true) }}{{ partial "qingshuige-search/scripts.html" . }}</body></html>`)
  for (const layout of ["home", "single", "list"]) {
    write(root, `layouts/${layout}.html`, '{{ define "main" }}{{ .Title }}{{ end }}')
  }
  if (assets) {
    // Isolate Hugo's publication contract; browser behavior has its own suite.
    write(root, "assets/qingshuige-search/qingshuige-search.js", "export const adapterFixture = true;")
    write(root, "assets/qingshuige-search/qingshuige-search.css", ".qsg-search-dialog{color:var(--qsg-ink)}")
  }
  for (const [name, text] of Object.entries(pages || {
    "blog/visible.md": article("可搜索文章", { categories: "文", tags: "检索", author: "甲" }),
    "almanac/annual.md": article("年鉴", { categories: ["年鉴"], author: [{ name: "乙" }, "丙"] }),
    "blog/default-author.md": article("默认作者"),
    "blog/hidden.md": article("隐藏文章", { searchHidden: true }),
    "blog/draft.md": article("草稿文章", { draft: true }),
    "notes/excluded.md": article("其他栏目")
  })) write(root, `content/${name}`, text)

  const settings = {
    baseURL: "https://example.test/",
    defaultContentLanguage: "zh",
    title: "Fixture",
    disableKinds: ["taxonomy", "term", "rss", "sitemap"],
    params: {
      author: { name: "站点作者" },
      qingshuigeSearch: { enabled: true, sections: ["blog", "almanac"], ...search }
    },
    module: { mounts: [
      { source: "layouts", target: "layouts" },
      { source: "assets", target: "assets" },
      { source: "plugin/layouts", target: "layouts" },
      { source: "plugin/assets", target: "assets" }
    ] },
    ...config
  }
  write(root, "hugo.json", JSON.stringify(settings))
  const result = spawnSync(hugo, ["--source", root, "--config", "hugo.json", "--destination", path.join(root, "public"), "--cacheDir", path.join(root, "cache")], { encoding: "utf8", windowsHide: true })
  return { root, result, output: `${result.stdout}\n${result.stderr}` }
}

function documentAt(root, file = "index.html") {
  return new JSDOM(readFileSync(path.join(root, "public", file), "utf8")).window.document
}

function filesUnder(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? filesUnder(path.join(root, entry.name)).map(file => `${entry.name}/${file}`)
    : [entry.name])
}

test("Hugo adapter integration", { skip: available ? false : "Install Hugo >= 0.158.0 or set HUGO_BIN to run adapter builds" }, async t => {
  await t.test("publishes filtered normalized Article[] and preserves JavaScript option casing", t => {
    const { root, result, output } = buildSite(t, { search: {
      engine: { hanGramSize: 3, minWordLength: 2, maxDocumentFrequencyRatio: 0.75, maxResults: 7, snippetLength: 64, matchMode: "all", weights: { titleExact: 0, bodyPhrase: 9 } },
      ui: { resultLimit: 7, debounceMs: 0 }
    } })
    assert.equal(result.status, 0, output)
    const document = documentAt(root)
    const mount = document.querySelector("[data-qsg-search]")
    assert.equal(mount.dataset.searchIndexUrl, "/search-index.json")
    assert.deepEqual(JSON.parse(mount.dataset.searchOptions), { hanGramSize: 3, minWordLength: 2, maxDocumentFrequencyRatio: 0.75, maxResults: 7, snippetLength: 64, matchMode: "all", weights: { titleExact: 0, bodyPhrase: 9 } })
    assert.deepEqual(JSON.parse(mount.dataset.searchUi), { resultLimit: 7, debounceMs: 0 })
    assert.equal(document.querySelectorAll("[data-search-trigger]").length, 1)
    assert.ok(document.querySelector('script[type="module"][integrity]'))
    assert.ok(document.querySelector('link[rel="stylesheet"][integrity]'))
    const articles = JSON.parse(readFileSync(path.join(root, "public/search-index.json")))
    assert.equal(articles.length, 3)
    assert.deepEqual(articles.find(item => item.title === "可搜索文章").categories, ["文"])
    assert.deepEqual(articles.find(item => item.title === "可搜索文章").tags, ["检索"])
    assert.equal(articles.find(item => item.title === "年鉴").author, "乙, 丙")
    assert.equal(articles.find(item => item.title === "默认作者").author, "站点作者")
    for (const item of articles) {
      assert.deepEqual(Object.keys(item).sort(), ["author", "categories", "content", "date", "id", "tags", "title", "url"])
      assert.equal(item.id, item.url)
      assert.equal(typeof item.content, "string")
    }
  })

  await t.test("disabled search publishes no index, mount, trigger, or plugin assets", t => {
    const { root, result, output } = buildSite(t, { search: { enabled: false }, assets: false })
    assert.equal(result.status, 0, output)
    const document = documentAt(root)
    assert.equal(document.querySelector("[data-qsg-search], [data-search-trigger], script, link"), null)
    assert.equal(filesUnder(path.join(root, "public")).some(file => file.includes("qingshuige-search") || file.endsWith(".json")), false)
  })

  await t.test("publishes decoded plain text for typographic and explicit HTML entities", t => {
    const { root, result, output } = buildSite(t, { pages: {
      "blog/entities.md": article("实体文本", {}, '计算机 &ldquo;时空&rdquo; &amp; 旅行，**重要**。\n\n"Quoted text".\n\nHTML code: `&lt;span&gt;`。')
    } })
    assert.equal(result.status, 0, output)
    const [entry] = JSON.parse(readFileSync(path.join(root, "public/search-index.json")))
    assert.match(entry.content, /计算机 “时空” & 旅行，重要。/)
    assert.match(entry.content, /“Quoted text”/)
    assert.doesNotMatch(entry.content, /&(?:ldquo|rdquo|amp);/)
    // Decode once: an escaped entity typed as code remains literal source text.
    assert.match(entry.content, /HTML code: &lt;span&gt;。/)
  })

  await t.test("one custom indexPath controls generation and requests under a baseURL subdirectory", t => {
    const { root, result, output } = buildSite(t, { search: { indexPath: "data/articles.json" }, config: { baseURL: "https://example.test/docs/" } })
    assert.equal(result.status, 0, output)
    const document = documentAt(root)
    assert.equal(document.querySelector("[data-qsg-search]").dataset.searchIndexUrl, "/docs/data/articles.json")
    assert.ok(existsSync(path.join(root, "public/data/articles.json")))
    assert.equal(existsSync(path.join(root, "public/search-index.json")), false)
    for (const item of JSON.parse(readFileSync(path.join(root, "public/data/articles.json")))) assert.match(item.url, /^\/docs\//)
  })

  await t.test("languages get separate data and unique resource paths", t => {
    const { root, result, output } = buildSite(t, {
      search: { indexPath: "data/articles.json" },
      config: { baseURL: "https://example.test/docs/", defaultContentLanguageInSubdir: true, languages: { zh: { weight: 1 }, en: { weight: 2 } } },
      pages: {
        "blog/post.zh.md": article("中文文章"),
        "blog/post.en.md": article("English article")
      }
    })
    assert.equal(result.status, 0, output)
    for (const [language, title] of [["zh", "中文文章"], ["en", "English article"]]) {
      const document = documentAt(root, `${language}/index.html`)
      assert.equal(document.querySelector("[data-qsg-search]").dataset.searchIndexUrl, `/docs/${language}/data/articles.json`)
      const articles = JSON.parse(readFileSync(path.join(root, "public", language, "data/articles.json")))
      assert.equal(articles.length, 1)
      assert.equal(articles[0].title, title)
      assert.match(articles[0].url, new RegExp(`^/docs/${language}/`))
    }
  })

  await t.test("empty sections includes every regular page, while hidden pages remain excluded", t => {
    const { root, result, output } = buildSite(t, { search: { sections: [] } })
    assert.equal(result.status, 0, output)
    const articles = JSON.parse(readFileSync(path.join(root, "public/search-index.json")))
    assert.equal(articles.length, 4)
    assert.ok(articles.some(item => item.title === "其他栏目"))
  })

  await t.test("invalid indexPath and missing assets fail the build with actionable messages", t => {
    const invalid = buildSite(t, { search: { indexPath: "../search-index.json" } })
    assert.notEqual(invalid.result.status, 0)
    assert.match(invalid.output, /indexPath must be a relative/)
    const missing = buildSite(t, { assets: false })
    assert.notEqual(missing.result.status, 0)
    assert.match(missing.output, /assets are missing/)
  })
})
