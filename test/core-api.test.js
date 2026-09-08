import test from "node:test"
import assert from "node:assert/strict"
import {
  SearchEngine, createSearch, normalizeArticle, normalizeArticles,
  defaultTokenizer, defaultRanker, defaultFormatter, DEFAULT_OPTIONS, parseDateQuery
} from "../src/index.js"

test("factory exposes the compatible API and normalizes articles without mutating input", () => {
  const source = {
    title: "  Hugo guide  ", author: [" Alice ", "Bob", "Alice"],
    categories: " Notes ", tags: ["static", "static"], image: "/cover.png", extra: { pinned: true }
  }
  const search = createSearch().load([source])
  assert.ok(search instanceof SearchEngine)
  const result = search.search("hugo")[0]
  assert.deepEqual(result.article, {
    id: 0, title: "Hugo guide", content: "", author: "Alice, Bob",
    date: null, categories: ["Notes"], tags: ["static"], url: "",
    image: "/cover.png", extra: { pinned: true }
  })
  assert.equal(source.title, "  Hugo guide  ")
  assert.equal(source.categories, " Notes ")
  assert.equal(search.search("Bob")[0].externalId, 0)
  assert.equal(search.search("hugo", { category: "notes" }).length, 1)
  assert.deepEqual(normalizeArticles([]), [])
  assert.equal(normalizeArticle({ content: "Body only" }).title, "")
})

test("bad article reloads fail clearly and preserve the last usable index", () => {
  const search = createSearch().load([{ title: "Existing title" }])
  for (const invalid of [null, {}, "articles"]) {
    assert.throws(() => search.load(invalid), /expects an Article\[\]/u)
  }
  for (const article of [null, {}, [], "text", { title: " ", content: "\n" }, { title: {}, content: "body" }]) {
    assert.throws(() => search.load([article]), TypeError)
    assert.equal(search.search("existing").length, 1)
  }
  search.load([])
  assert.deepEqual(search.search("existing"), [])
})

test("missing dates are not January 1970 and timezone dates retain the published calendar day", () => {
  const search = createSearch().load([
    { id: "cn", title: "One", date: "2026-09-08T00:30:00+08:00" },
    { id: "us", title: "Two", date: "2026-09-07T23:30:00-07:00" },
    { id: "none", title: "Three", date: null },
    { id: "invalid", title: "Four", date: "2026-02-30" }
  ])
  assert.deepEqual(search.search("2026-09-08", { matchMode: "all" }).map((r) => r.externalId), ["cn"])
  assert.deepEqual(search.search("2026/09/07").map((r) => r.externalId), ["us"])
  assert.deepEqual(search.search("1970"), [])
  assert.equal(search.articles[3].date, null)
  assert.equal(parseDateQuery("2026-02-30"), null)
  assert.equal(parseDateQuery("2026-13"), null)
  assert.deepEqual(parseDateQuery("2024年2月29日"), { year: 2024, month: 2, day: 29 })
})

test("any/all recall query groups across title, author and body with full-field coverage", () => {
  const search = createSearch().load([
    { id: "all", title: "Hugo guide", author: "Alice", content: "Practical plugin design." },
    { id: "two", title: "Hugo internals", author: "Alice", content: "A general introduction." },
    { id: "one", title: "Another entry", author: "Bob", content: "A plugin is useful." }
  ])
  const any = search.search("Hugo Alice plugin")
  assert.deepEqual(new Set(any.map((r) => r.externalId)), new Set(["all", "two", "one"]))
  assert.equal(any[0].externalId, "all")
  assert.equal(any[0].coverage, 1)
  assert.equal(any.find((r) => r.externalId === "two").coverage, 2 / 3)
  assert.deepEqual(search.search("Hugo Alice plugin", { matchMode: "all" }).map((r) => r.externalId), ["all"])
  assert.deepEqual(createSearch({ matchMode: "all" }).load(search.articles).search("Hugo missing"), [])
})

test("short groups count towards all-mode even when intentionally absent from body tokens", () => {
  const search = createSearch().load([
    { id: "yes", title: "今天", content: "Hugo" },
    { id: "no", title: "Other", content: "今天 Hugo" }
  ])
  assert.deepEqual(search.search("今 Hugo", { matchMode: "all" }).map((r) => r.externalId), ["yes"])
})

test("tokenizer, ranker and formatter are independently replaceable", () => {
  const seen = []
  const tokenizer = {
    tokenize(text) {
      seen.push(text)
      return [{ value: "stem", position: 0 }]
    },
    tokenizeQuery(query) {
      return [{ raw: query, tokens: ["stem"], verifyPhrase: false }]
    }
  }
  let formatted = 0
  const search = createSearch({
    tokenizer,
    ranker(context) {
      assert.equal(context.statistics.getDocumentFrequency("stem"), 2)
      assert.equal(context.coverage, 1)
      assert.ok(Number.isFinite(defaultRanker(context)))
      return context.article.priority
    },
    formatter(context) {
      formatted += 1
      assert.equal(defaultFormatter(context).score, context.score)
      return { id: context.article.id, points: context.score }
    }
  }).load([
    { id: "low", title: "First", content: "running", priority: -1 },
    { id: "high", title: "Second", content: "runs", priority: 9 }
  ])
  assert.deepEqual(search.search("run", { limit: 1 }), [{ id: "high", points: 9 }])
  assert.equal(formatted, 1)
  assert.deepEqual(seen, ["running", "runs"])
  assert.equal(typeof defaultTokenizer.tokenize, "function")
  assert.equal(typeof defaultTokenizer.tokenizeQuery, "function")
})

test("frequent tokens never remove recall, including one-document corpora", () => {
  const single = createSearch().load([{ title: "Unrelated", content: "轻量搜索提供全文检索，支持Hugo博客。" }])
  assert.equal(single.search("全文检索").length, 1)
  assert.equal(single.search("Hugo").length, 1)
  const corpus = [
    { id: 1, title: "One", content: "计算机 common rare" },
    { id: 2, title: "Two", content: "计算然后算机 common" },
    { id: 3, title: "Three", content: "计算机 common" }
  ]
  for (const ratio of [0, 0.1, 0.6, 1]) {
    const search = createSearch({ maxDocumentFrequencyRatio: ratio }).load(corpus)
    assert.deepEqual(new Set(search.search("common").map((r) => r.externalId)), new Set([1, 2, 3]))
    assert.deepEqual(new Set(search.search("计算机").map((r) => r.externalId)), new Set([1, 3]))
    assert.deepEqual(search.search("common rare", { matchMode: "all" }).map((r) => r.externalId), [1])
  }
})

test("large common-term posting lists retain every result with deterministic tie ordering", () => {
  const count = 2500
  const corpus = Array.from({ length: count }, (_, id) => ({ id, title: `Entry ${id}`, content: "shared content" }))
  const search = createSearch({ maxResults: count }).load(corpus)
  const results = search.search("shared content", { matchMode: "all" })
  assert.equal(results.length, count)
  assert.deepEqual(results.map((r) => r.externalId), corpus.map((article) => article.id))
})

test("equal relevance sorts by timestamp and puts missing dates after dated articles", () => {
  const search = createSearch({ ranker: () => 0 }).load([
    { id: "missing-first", title: "Hugo" },
    { id: "older", title: "Hugo", date: "2026-09-08T00:30:00+08:00" },
    { id: "newer", title: "Hugo", date: "2026-09-07T23:30:00-07:00" },
    { id: "missing-second", title: "Hugo" }
  ])
  assert.deepEqual(search.search("Hugo").map((r) => r.externalId), ["newer", "older", "missing-first", "missing-second"])
})

test("configuration and query overrides reject invalid values without coercion", () => {
  for (const options of [
    null, [], { hanGramSize: 1 }, { hanGramSize: 2.5 }, { minWordLength: 0 },
    { maxResults: -1 }, { maxResults: "20" }, { snippetLength: NaN },
    { maxDocumentFrequencyRatio: 1.1 }, { maxDocumentFrequencyRatio: -1 },
    { weights: null }, { weights: { coverage: Infinity } }, { weights: { titleExact: -1 } },
    { matchMode: "some" }, { tokenizer: {} }, { ranker: null }, { formatter: "text" }
  ]) assert.throws(() => createSearch(options), Error)
  const search = createSearch({ weights: { titleExact: 50 } }).load([{ title: "Hugo" }])
  assert.equal(search.options.weights.titlePrefix, DEFAULT_OPTIONS.weights.titlePrefix)
  for (const options of [null, [], { limit: -1 }, { limit: 1.5 }, { limit: "2" }, { matchMode: "none" }, { category: [] }]) {
    assert.throws(() => search.search("Hugo", options), Error)
  }
  assert.deepEqual(search.search("Hugo", { limit: 0 }), [])
})

test("invalid strategy outputs produce actionable errors", () => {
  const article = { title: "Hugo", content: "Body" }
  assert.throws(() => createSearch({ ranker: () => NaN }).load([article]).search("Hugo"), /ranker must return/u)
  assert.throws(() => createSearch({ tokenizer: { ...defaultTokenizer, tokenize: () => "body" } }).load([article]), /tokenizer.tokenize/u)
  assert.throws(() => createSearch({ tokenizer: { ...defaultTokenizer, tokenize: () => [{ value: "body", position: -1 }] } }).load([article]), /Token occurrences/u)
  assert.throws(() => createSearch({ tokenizer: { ...defaultTokenizer, tokenizeQuery: () => null } }).load([article]).search("Hugo"), /tokenizer.tokenizeQuery/u)
})

test("body search handles compatibility forms and combining marks with snippets at the original match", () => {
  const content = `${"e\u0301 ".repeat(100)}采用 Ｖｕｅ３．５ 构建，介绍 e\u0301cole 和 q\u0307。`
  const search = createSearch({ snippetLength: 30 }).load([{ title: "Entry", content }])
  for (const query of ["Vue3.5", "Ｖｕｅ３．５", "école", "e\u0301cole", "q\u0307"]) {
    assert.equal(search.search(query).length, 1, query)
    assert.equal(search.search(query)[0].matchedFields.body, true, query)
  }
  assert.ok(search.search("Vue3.5")[0].snippet.includes("Ｖｕｅ３．５"))
  assert.ok(search.search("école")[0].snippet.includes("e\u0301cole"))
})

test("author prefixes use the same contains contract and weight as other partial author matches", () => {
  const search = createSearch().load([
    { id: "prefix", title: "One", author: "清水阁编辑部" },
    { id: "suffix", title: "Two", author: "编辑部清水阁" },
    { id: "exact", title: "Three", author: "清水阁" }
  ])
  const results = search.search("清水阁")
  assert.deepEqual(results.map((result) => result.externalId), ["exact", "prefix", "suffix"])
  assert.deepEqual(results.map((result) => result.matchedFields.author), ["exact", "contains", "contains"])
  assert.equal(results[1].score, results[2].score)
  assert.ok(results[0].score > results[1].score)
})

test("article dates accept only valid ISO dates or RFC3339 strings instead of platform-dependent guesses", () => {
  for (const date of [
    "2026-9-08", "2026/02/30", "2026-09-08junk", "2026-02-30", "2026-13-01",
    "2026-09-08T00:30:00", "2026-09-08 00:30:00", "2026-09-08T24:00:00Z",
    "2026-09-08T12:60:00Z", "2026-09-08T12:00:60Z", "2026-09-08T12:00:00+24:00",
    "2026-09-08T12:00:00+08:60", "September 8, 2026", "2026", "0"
  ]) {
    const search = createSearch().load([{ title: "Entry", date }])
    assert.equal(search.articles[0].date, null, date)
    assert.deepEqual(search.search("2026"), [], date)
  }
  for (const date of ["2026-09-08", "2026-09-08T00:30:00+08:00", "2026-09-08t00:30:00.123z", " 2026-09-08 "]) {
    const search = createSearch().load([{ title: "Entry", date }])
    assert.equal(search.search("2026-09-08").length, 1, date)
  }
  assert.equal(normalizeArticle({ title: "Epoch", date: 0 }).date, "1970-01-01T00:00:00.000Z")
  assert.equal(normalizeArticle({ title: "Object", date: new Date("2026-09-08T00:00:00Z") }).date, "2026-09-08T00:00:00.000Z")
})
