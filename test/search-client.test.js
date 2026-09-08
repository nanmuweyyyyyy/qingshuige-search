import test from "node:test"
import assert from "node:assert/strict"
import { createSearchClient } from "../frontend/search/search-client.js"

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
