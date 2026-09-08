import test from "node:test"
import assert from "node:assert/strict"
import { createSearchClient } from "../adapters/browser/index.js"
import { createSearchClient as compatibilityClient } from "../frontend/search/search-client.js"

const articles = [
  { title: "Hugo 搜索", author: "作者", content: "全文检索", categories: ["学", "学"], url: "/preview/blog/hugo/?from=search#part" },
  { title: "春日诗歌", author: "作者", content: "春日", categories: ["诗"], url: "/preview/blog/poem/" }
]
const response = (payload = articles) => ({ ok: true, json: async () => payload })

function setup(t, fetcher) {
  const previous = globalThis.window
  globalThis.window = { location: new URL("https://example.test/preview/") }
  t.after(() => { globalThis.window = previous })
  t.mock.method(globalThis, "fetch", fetcher)
}

test("concurrent initialization shares one fetch and later searches reuse the index", async (t) => {
  let resolveFetch
  let requests = 0
  setup(t, (_url, options) => {
    requests++
    assert.equal(options.cache, "no-cache")
    return new Promise((resolve) => { resolveFetch = resolve })
  })
  const client = createSearchClient("/concurrent.json")
  assert.equal(client, createSearchClient("/concurrent.json"))
  const pending = [client.categories(), client.search("Hugo")]
  assert.equal(requests, 1)
  resolveFetch(response())
  const [categories, results] = await Promise.all(pending)
  assert.deepEqual(new Set(categories), new Set(["学", "诗"]))
  assert.equal(results[0].article.url, "/preview/blog/hugo/?from=search#part")
  categories.push("不应写回缓存")
  assert.equal((await client.categories()).length, 2)
  await client.search("春日")
  assert.equal(requests, 1)
})

test("HTTP failure is retryable without a page refresh", async (t) => {
  let requests = 0
  setup(t, async () => ++requests === 1 ? { ok: false, status: 503 } : response())
  const client = createSearchClient("/retry.json")
  await assert.rejects(client.load(), /503/)
  assert.equal((await client.search("Hugo")).length, 1)
  assert.equal(requests, 2)
})

test("an invalid index does not leave a partially initialized engine", async (t) => {
  let requests = 0
  setup(t, async () => response(++requests === 1 ? [null] : articles))
  const client = createSearchClient("/invalid.json")
  await assert.rejects(client.categories(), TypeError)
  assert.equal((await client.search("春日"))[0].article.title, "春日诗歌")
})

test("a request timeout releases the pending request for retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let requests = 0
  setup(t, (_url, { signal }) => {
    if (++requests > 1) return Promise.resolve(response())
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
    })
  })
  const client = createSearchClient("/timeout.json")
  const pending = assert.rejects(client.load(), { name: "AbortError" })
  t.mock.timers.tick(12000)
  await pending
  assert.equal((await client.search("Hugo")).length, 1)
})

test("empty indexes are valid and do not refetch", async (t) => {
  let requests = 0
  setup(t, async () => { requests++; return response([]) })
  const client = createSearchClient("/empty.json")
  assert.deepEqual(await client.categories(), [])
  assert.deepEqual(await client.search("Hugo"), [])
  assert.equal(requests, 1)
})

test("script and external result URLs are rejected before navigation", async (t) => {
  const payloads = [
    [{ ...articles[0], url: "javascript:alert(1)" }],
    [{ ...articles[0], url: "//external.test/article" }]
  ]
  setup(t, async () => response(payloads.shift()))
  await assert.rejects(createSearchClient("/unsafe.json").load(), /this site/)
  await assert.rejects(createSearchClient("/external.json").load(), /this site/)
})

test("the legacy client entry point uses the framework-independent browser adapter", () => {
  assert.equal(createSearchClient, compatibilityClient)
})

test("an injected fetch and baseUrl work without window and resolve relative URLs", async () => {
  assert.equal(globalThis.window, undefined)
  let requestedUrl
  const client = createSearchClient("data/search.json", {
    baseUrl: "https://portable.test/docs/",
    fetch: async (url) => {
      requestedUrl = url
      return response([{ ...articles[0], url: "posts/hugo/?q=1#section" }])
    }
  })
  const results = await client.search("Hugo")
  assert.equal(requestedUrl, "https://portable.test/docs/data/search.json")
  assert.equal(results[0].article.url, "/docs/posts/hugo/?q=1#section")
})

test("engine options reach the engine and configured clients cannot share incompatible indexes", async () => {
  const fetcher = async () => response([
    { ...articles[0], content: "a long text for snippet configuration" },
    { ...articles[1], title: "Hugo 诗歌" }
  ])
  const config = { baseUrl: "https://options.test/", fetch: fetcher }
  const one = createSearchClient("/search.json", { ...config, engineOptions: { maxResults: 1, snippetLength: 8 } })
  const two = createSearchClient("/search.json", { ...config, engineOptions: { maxResults: 2 } })
  assert.notEqual(one, two)
  const results = await one.search("Hugo")
  assert.equal(results.length, 1)
  assert.ok(results[0].snippet.length <= 10)
  assert.equal((await two.search("Hugo")).length, 2)
  assert.equal((await one.search("Hugo", { limit: 2 })).length, 2)
})

test("default clients are isolated across site origins and relative base paths", async (t) => {
  const urls = []
  setup(t, async (url) => {
    urls.push(url)
    return response([{ ...articles[0], url: "article/" }])
  })
  const first = createSearchClient("/scoped.json")
  globalThis.window.location = new URL("https://another.test/docs/")
  const second = createSearchClient("/scoped.json")
  globalThis.window.location = new URL("https://another.test/archive/")
  const third = createSearchClient("/scoped.json")
  assert.notEqual(first, second)
  assert.notEqual(second, third)
  assert.equal((await first.search("Hugo"))[0].article.url, "/preview/article/")
  assert.equal((await second.search("Hugo"))[0].article.url, "/docs/article/")
  assert.equal((await third.search("Hugo"))[0].article.url, "/archive/article/")
  assert.deepEqual(urls, ["https://example.test/scoped.json", "https://another.test/scoped.json", "https://another.test/scoped.json"])
})

test("unsafe index URLs are rejected before fetching", () => {
  let requests = 0
  const options = { baseUrl: "https://safe.test/", fetch: async () => { requests++; return response() } }
  for (const url of ["javascript:alert(1)", "//other.test/index.json", "http://safe.test/index.json"]) {
    assert.throws(() => createSearchClient(url, options), /this site/)
  }
  assert.throws(() => createSearchClient("/index.json", { ...options, baseUrl: "file:///tmp/index.html" }), /HTTP/)
  assert.equal(requests, 0)
})

test("categories use the core's normalized article model", async () => {
  const client = createSearchClient("/categories.json", {
    baseUrl: "https://categories.test/",
    fetch: async () => response([
      { ...articles[0], categories: " 技术 " },
      { ...articles[1], categories: ["技术", " 诗 ", "", null] }
    ])
  })
  assert.deepEqual(new Set(await client.categories()), new Set(["技术", "诗"]))
  assert.equal((await client.search("Hugo", { category: "技术" })).length, 1)
})

test("article field normalization stays in the core and invalid engine strategies are not coerced", async () => {
  const options = {
    baseUrl: "https://model.test/",
    fetch: async () => response([{ content: "Hugo body-only document", url: "/article/" }])
  }
  const [result] = await createSearchClient("/model.json", options).search("Hugo")
  assert.equal(result.article.title, "")
  assert.equal(result.article.url, "/article/")
  await assert.rejects(createSearchClient("/model.json", { ...options, engineOptions: { weights: [] } }).load(), /weights/)
})

test("same-origin double-slash paths cannot become cross-origin navigation links", async () => {
  const client = createSearchClient("/paths.json", {
    baseUrl: "https://safe.test/",
    fetch: async () => response([{ ...articles[0], url: "https://safe.test//external.test/post/" }])
  })
  const [result] = await client.search("Hugo")
  assert.equal(new URL(result.article.url, "https://safe.test/").origin, "https://safe.test")
  assert.equal(new URL(result.article.url, "https://safe.test/").pathname, "//external.test/post/")
})

test("timeout retries survive a fetcher that ignores abort and a late response cannot replace the new index", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let finishOldRequest
  let requests = 0
  const client = createSearchClient("/timeout-late.json", {
    baseUrl: "https://timeout.test/",
    timeoutMs: 25,
    fetch: () => ++requests === 1
      ? new Promise((resolve) => { finishOldRequest = resolve })
      : Promise.resolve(response())
  })
  const pending = assert.rejects(client.load(), { name: "AbortError" })
  t.mock.timers.tick(25)
  await pending
  assert.equal((await client.search("Hugo")).length, 1)
  finishOldRequest(response([]))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await client.search("Hugo")).length, 1)
  assert.equal(requests, 2)
})
