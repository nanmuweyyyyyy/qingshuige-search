import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { JSDOM } from "jsdom"

const bundle = await readFile(process.env.QSG_SEARCH_TEST_BUNDLE
  ?? new URL("../assets/qingshuige-search/qingshuige-search.js", import.meta.url), "utf8")
const articles = [
  { title: "Hugo 搜索优化", author: "清水阁", content: "文章全文检索", categories: ["学"], url: "/blog/hugo/" },
  { title: "Hugo 诗歌", author: "清水阁", content: "另一个搜索结果", categories: ["诗"], url: "/blog/poem/" },
  { title: "Vue 组件", author: "清水阁", content: "组件交互", categories: ["学"], url: "/blog/vue/" }
]
const response = (data = articles) => ({ ok: true, json: async () => data })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await wait(10)
  }
  assert.fail("Timed out waiting for expected DOM state")
}

function setup(t, fetcher = async () => response(), options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><header class="site-header"><button data-search-trigger aria-expanded="false"><svg><circle/></svg>搜索文章</button></header><main class="site-main"><button id="origin">正文操作</button></main><footer class="site-footer"></footer><div data-vue-component="SearchPanel" data-search-index-url="/search-index.json"></div></body></html>', {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  })
  const { window } = dom
  const document = window.document
  options.prepare?.(document)
  const scrolls = []
  window.fetch = fetcher
  window.scrollTo = (options) => scrolls.push(options)
  // jsdom 不进行布局或页面导航；仅替代测试中用到的滚动接口。
  window.HTMLElement.prototype.scrollIntoView = () => {}
  const errors = []
  const warnings = []
  window.console.error = (...args) => errors.push(args)
  window.console.warn = (...args) => warnings.push(args)
  window.addEventListener("error", (event) => errors.push(event.error))
  assert.equal(window.process, undefined)
  window.eval(bundle)
  t.after(() => window.close())
  const select = (selector) => document.querySelector(selector)
  const key = (target, value, options = {}) => {
    const event = new window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options })
    target.dispatchEvent(event)
    return event
  }
  const input = (value) => {
    const element = select(".qsg-search-input")
    element.value = value
    element.dispatchEvent(new window.Event("input", { bubbles: true }))
  }
  const search = async (value) => {
    input(value)
    await wait(0)
    await until(() => select(".qsg-search-results").getAttribute("aria-busy") === "false"
      && !select(".qsg-search-status").textContent.includes("正在"))
  }
  const open = async () => {
    select("[data-search-trigger]").click()
    await until(() => select(".qsg-search-input"))
  }
  return { window, document, select, key, input, search, open, errors, warnings, scrolls }
}

test("production bundle mounts without Node globals; clicking the icon opens and focuses search", async (t) => {
  const ui = setup(t)
  ui.select("[data-search-trigger] circle").dispatchEvent(new ui.window.MouseEvent("click", { bubbles: true }))
  await until(() => ui.select(".qsg-search-input"))
  assert.equal(ui.document.activeElement, ui.select(".qsg-search-input"))
  assert.equal(ui.select("[data-search-trigger]").getAttribute("aria-expanded"), "true")
  assert.equal(ui.document.body.style.position, "fixed")
  assert.equal(ui.select(".site-main").inert, true)
  ui.key(ui.document.activeElement, "Escape")
  await until(() => !ui.select(".qsg-search-dialog"))
  assert.equal(ui.document.activeElement, ui.select("[data-search-trigger]"))
  assert.equal(ui.document.body.style.position, "")
  assert.deepEqual(ui.errors, [])
})

test("Ctrl/Meta+K toggles search and restores the original content focus", async (t) => {
  const ui = setup(t)
  ui.select("#origin").focus()
  ui.key(ui.window, "k", { ctrlKey: true })
  await until(() => ui.select(".qsg-search-input"))
  ui.key(ui.window, "k", { metaKey: true })
  await until(() => !ui.select(".qsg-search-dialog"))
  assert.equal(ui.document.activeElement, ui.select("#origin"))
  ui.key(ui.window, "k", { ctrlKey: true, repeat: true })
  assert.equal(ui.select(".qsg-search-dialog"), null)
})

test("queries render linked results, category filters and keyboard selection", async (t) => {
  const ui = setup(t)
  await ui.open()
  await ui.search("Hugo")
  assert.equal(ui.document.querySelectorAll(".qsg-search-result").length, 2)
  assert.equal(ui.select(".qsg-search-result").getAttribute("href"), "/blog/hugo/")
  assert.equal(ui.select("mark").textContent, "Hugo")
  ui.key(ui.select("input"), "ArrowDown")
  await until(() => ui.select('input').getAttribute("aria-activedescendant") === "qsg-search-result-1")
  const category = [...ui.document.querySelectorAll(".qsg-search-filter")].find((el) => el.textContent === "诗")
  category.focus()
  assert.equal(ui.key(category, "ArrowUp").defaultPrevented, false)
  category.click()
  await until(() => ui.document.querySelectorAll(".qsg-search-result").length === 1)
  assert.equal(ui.select(".qsg-search-result").getAttribute("href"), "/blog/poem/")
  assert.equal(category.getAttribute("aria-pressed"), "true")
  assert.deepEqual(ui.errors, [])
})

test("editing a query removes old results before debounce and Enter cannot open an old article", async (t) => {
  const ui = setup(t)
  await ui.open()
  await ui.search("Hugo")
  ui.input("Vue")
  ui.key(ui.select("input"), "Enter")
  await until(() => ui.select(".qsg-search-result-title")?.textContent === "Vue 组件")
  assert.equal(ui.select(".qsg-search-result-title").textContent, "Vue 组件")
  assert.equal(ui.window.location.pathname, "/")
  assert.deepEqual(ui.errors, [])
})

test("clearing a query during initial loading cannot restore stale results", async (t) => {
  let finish
  const ui = setup(t, () => new Promise((resolve) => { finish = resolve }))
  await ui.open()
  ui.input("Hugo")
  await wait(210)
  ui.input("")
  finish(response())
  await until(() => ui.select(".qsg-search-status").textContent.includes("输入标题"))
  assert.equal(ui.document.querySelectorAll(".qsg-search-result").length, 0)
  assert.equal(ui.select(".qsg-search-results").getAttribute("aria-busy"), "false")
})

test("close and reopen runs a query that was still waiting for debounce", async (t) => {
  const ui = setup(t)
  await ui.open()
  ui.input("Vue")
  ui.select(".qsg-search-close").click()
  await until(() => !ui.select(".qsg-search-dialog"))
  await ui.open()
  await until(() => ui.select(".qsg-search-result-title")?.textContent === "Vue 组件")
  assert.equal(ui.select(".qsg-search-result-title").textContent, "Vue 组件")
})

test("IME confirmation, candidate selection and Escape do not navigate or close search", async (t) => {
  const ui = setup(t)
  await ui.open()
  await ui.search("Hugo")
  const input = ui.select("input")
  assert.equal(ui.key(input, "Enter", { isComposing: true }).defaultPrevented, false)
  assert.equal(ui.key(input, "Enter", { keyCode: 229 }).defaultPrevented, false)
  input.dispatchEvent(new ui.window.CompositionEvent("compositionstart", { bubbles: true }))
  input.value = "Vue"
  assert.equal(ui.key(input, "ArrowDown", { isComposing: true }).defaultPrevented, false)
  assert.equal(ui.key(input, "Escape", { isComposing: true }).defaultPrevented, false)
  assert.ok(ui.select(".qsg-search-dialog"))
  input.dispatchEvent(new ui.window.CompositionEvent("compositionend", { bubbles: true }))
  await until(() => ui.select(".qsg-search-result-title")?.textContent === "Vue 组件")
  assert.equal(ui.select(".qsg-search-result-title").textContent, "Vue 组件")
  assert.equal(ui.window.location.pathname, "/")
  assert.deepEqual(ui.errors, [])
})

test("index failure shows a working retry button", async (t) => {
  let requests = 0
  const ui = setup(t, async () => ++requests === 1 ? { ok: false, status: 503 } : response())
  await ui.open()
  await until(() => ui.select(".qsg-search-error-actions button"))
  ui.select(".qsg-search-error-actions button").click()
  await until(() => !ui.select(".qsg-search-error-actions"))
  await ui.search("Vue")
  assert.equal(ui.select(".qsg-search-result-title").textContent, "Vue 组件")
  assert.equal(requests, 2)
  assert.equal(ui.errors.length, 1)
})

test("pointer events inside the dialog keep it open; the backdrop closes it", async (t) => {
  const ui = setup(t)
  await ui.open()
  ui.select(".qsg-search-dialog").dispatchEvent(new ui.window.Event("pointerdown", { bubbles: true }))
  assert.ok(ui.select(".qsg-search-dialog"))
  ui.select(".qsg-search-layer").dispatchEvent(new ui.window.Event("pointerdown", { bubbles: true }))
  await until(() => !ui.select(".qsg-search-dialog"))
})

test("dynamically added triggers work without duplicate dialogs or duplicate fetches", async (t) => {
  let requests = 0
  const ui = setup(t, async () => { requests++; return response() })
  const trigger = ui.document.createElement("button")
  trigger.dataset.searchTrigger = ""
  ui.document.body.append(trigger)
  trigger.click()
  await until(() => ui.select(".qsg-search-input"))
  trigger.click()
  await until(() => ui.select(".qsg-search-results").getAttribute("aria-busy") === "false")
  assert.equal(ui.document.querySelectorAll(".qsg-search-dialog").length, 1)
  assert.equal(requests, 1)
})

test("the portable mount reads engine/UI JSON and respects the engine default result limit", async (t) => {
  let requestedUrl
  const ui = setup(t, async (url) => { requestedUrl = url; return response() }, {
    prepare(document) {
      const host = document.querySelector("[data-vue-component]")
      host.removeAttribute("data-vue-component")
      host.dataset.qsgSearch = ""
      host.dataset.searchIndexUrl = "/portable/index.json"
      host.dataset.searchOptions = JSON.stringify({ maxResults: 1, snippetLength: 3 })
      host.dataset.searchUi = JSON.stringify({ debounceMs: 0 })
    }
  })
  await ui.open()
  await ui.search("Hugo")
  assert.equal(requestedUrl, "https://example.test/portable/index.json")
  assert.equal(ui.document.querySelectorAll(".qsg-search-result").length, 1)
  assert.ok(ui.select(".qsg-search-status").textContent.includes("显示前 1 篇"))
  assert.ok(ui.select(".qsg-search-snippet").textContent.trim().length <= 5)
  assert.deepEqual(ui.errors, [])
})

test("an explicit UI result limit overrides the engine default and debounceMs controls pending results", async (t) => {
  const ui = setup(t, undefined, {
    prepare(document) {
      const host = document.querySelector("[data-vue-component]")
      host.dataset.searchOptions = JSON.stringify({ maxResults: 1 })
      host.dataset.searchUi = JSON.stringify({ resultLimit: 2, debounceMs: 60 })
    }
  })
  await ui.open()
  await until(() => ui.select(".qsg-search-results").getAttribute("aria-busy") === "false")
  ui.input("Hugo")
  await wait(20)
  assert.equal(ui.document.querySelectorAll(".qsg-search-result").length, 0)
  assert.equal(ui.select(".qsg-search-results").getAttribute("aria-busy"), "true")
  await until(() => ui.document.querySelectorAll(".qsg-search-result").length === 2)
  assert.deepEqual(ui.errors, [])
})

test("loading the bundle twice reuses its mounted app and ignores unrelated Vue markers", async (t) => {
  let requests = 0
  const ui = setup(t, async () => { requests++; return response() }, {
    prepare(document) {
      const unrelated = document.createElement("div")
      unrelated.dataset.vueComponent = "OtherPlatformComponent"
      document.body.append(unrelated)
      document.querySelector("[data-vue-component]").dataset.qsgSearch = ""
    }
  })
  ui.window.eval(bundle)
  await ui.open()
  await until(() => ui.select(".qsg-search-results").getAttribute("aria-busy") === "false")
  assert.equal(ui.document.querySelectorAll(".qsg-search-dialog").length, 1)
  assert.equal(requests, 1)
  ui.key(ui.window, "k", { ctrlKey: true })
  await until(() => !ui.select(".qsg-search-dialog"))
  assert.deepEqual(ui.errors, [])
  assert.deepEqual(ui.warnings, [])
})

test("arbitrary background nodes become inert while the teleported dialog stays interactive and prior state is restored", async (t) => {
  let shell
  let priorInert
  const ui = setup(t, undefined, {
    prepare(document) {
      shell = document.createElement("div")
      shell.id = "custom-layout"
      shell.inert = false
      shell.append(...document.body.children)
      document.body.append(shell)
      priorInert = document.createElement("aside")
      priorInert.inert = true
      document.body.append(priorInert)
      document.body.style.overflow = "auto"
      document.body.style.paddingRight = "7px"
    }
  })
  await ui.open()
  assert.equal(shell.inert, true)
  assert.equal(priorInert.inert, true)
  assert.notEqual(ui.select(".qsg-search-layer").inert, true)
  assert.equal(ui.select(".qsg-search-dialog").closest("[inert]"), null)
  assert.equal(ui.document.activeElement, ui.select(".qsg-search-input"))
  ui.key(ui.window, "Escape")
  await until(() => !ui.select(".qsg-search-dialog"))
  assert.equal(shell.inert, false)
  assert.equal(priorInert.inert, true)
  assert.equal(ui.document.body.style.overflow, "auto")
  assert.equal(ui.document.body.style.paddingRight, "7px")
  assert.equal(ui.document.activeElement, ui.select("[data-search-trigger]"))
})

test("malformed optional JSON falls back to defaults without preventing search", async (t) => {
  const ui = setup(t, undefined, {
    prepare(document) {
      const host = document.querySelector("[data-vue-component]")
      host.dataset.searchOptions = "{invalid"
      host.dataset.searchUi = "[]"
    }
  })
  await ui.open()
  await ui.search("Hugo")
  assert.equal(ui.document.querySelectorAll(".qsg-search-result").length, 2)
  assert.deepEqual(ui.errors, [])
  assert.equal(ui.warnings.length, 2)
})
