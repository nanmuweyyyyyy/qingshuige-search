import test from "node:test"
import assert from "node:assert/strict"
import { normalizeText, tokenize, tokenizeQuery } from "../src/index.js"

test("normalizes compatibility characters, case and spaces", () => {
  assert.equal(normalizeText("  Ｈｕｇｏ\n VUE  "), "hugo vue")
})

test("tokenizes mixed Chinese and technical words", () => {
  const values = tokenize("今天使用 Hugo 和 Vue3 学习计算机").map((item) => item.value)
  assert.deepEqual(values, [
    "今天", "天使", "使用",
    "hugo",
    "vue3", "vue",
    "学习", "习计", "计算", "算机"
  ])
})

test("single Han characters are not searchable in body", () => {
  assert.deepEqual(tokenize("这"), [])
  assert.deepEqual(tokenizeQuery("这")[0], {
    raw: "这",
    tokens: [],
    bodySearchable: false,
    type: "han"
  })
})

test("query keeps AND tokens inside Han group and separate word groups", () => {
  assert.deepEqual(tokenizeQuery("计算机 Hugo"), [
    { raw: "计算机", tokens: ["计算", "算机"], bodySearchable: true, type: "han" },
    { raw: "hugo", tokens: ["hugo"], bodySearchable: true, type: "word" }
  ])
})


test("versioned technical words expose a base alias without weakening model numbers", () => {
  assert.deepEqual(tokenize("Vue3 GPT-5 74HC193").map((item) => item.value), [
    "vue3", "vue", "gpt-5", "gpt", "74hc193"
  ])
})

test("unspaced Chinese and Latin prose use separate groups and original UTF-16 positions", () => {
  assert.deepEqual(tokenize("使用Hugo开发Vue3搜索"), [
    { value: "使用", position: 0 }, { value: "hugo", position: 2 },
    { value: "开发", position: 6 }, { value: "vue3", position: 8 },
    { value: "vue", position: 8 }, { value: "搜索", position: 12 }
  ])
  assert.deepEqual(tokenizeQuery("Hugo计算机").map((group) => group.raw), ["hugo", "计算机"])
})

test("tokenization options are validated consistently and aliases respect minimum word length", () => {
  for (const tokenizeFunction of [tokenize, tokenizeQuery]) {
    for (const options of [{ hanGramSize: 0 }, { hanGramSize: 2.5 }, { minWordLength: 0 }, { minWordLength: "2" }]) {
      assert.throws(() => tokenizeFunction("Hugo计算机", options), RangeError)
    }
  }
  assert.deepEqual(tokenize("Vue3", { minWordLength: 4 }).map((token) => token.value), ["vue3"])
  assert.deepEqual(tokenize("计算机系统", { hanGramSize: 3 }).map((token) => token.value), ["计算机", "算机系", "机系统"])
})

test("normalization precedes token boundaries while positions remain original UTF-16 offsets", () => {
  const source = "😀 ﬃ e\u0301cole Ｖｕｅ３．５ q\u0307 学习Hugo ㍿"
  const expected = [
    ["ffi", "ﬃ"], ["école", "e\u0301cole"], ["vue3.5", "Ｖｕｅ３．５"], ["q\u0307", "q\u0307"],
    ["学习", "学习"], ["hugo", "Hugo"], ["株式", "㍿"], ["式会", "㍿"], ["会社", "㍿"]
  ].map(([value, original]) => ({ value, position: source.indexOf(original) }))
  assert.deepEqual(tokenize(source), expected)
  for (const [query, normalized] of [["Ｖｕｅ３．５", "vue3.5"], ["e\u0301cole", "école"], ["q\u0307", "q\u0307"], ["ﬃ", "ffi"]]) {
    assert.deepEqual(tokenizeQuery(query).map((group) => group.tokens), [[normalized]])
  }
})

test("normalization preserves positions on runtimes without Intl.Segmenter", () => {
  const originalSegmenter = Intl.Segmenter
  try {
    Intl.Segmenter = undefined
    const source = "😀 ﬃ e\u0301cole Ｖｕｅ３．５ 计算机"
    assert.deepEqual(tokenize(source), [
      { value: "ffi", position: source.indexOf("ﬃ") },
      { value: "école", position: source.indexOf("e\u0301cole") },
      { value: "vue3.5", position: source.indexOf("Ｖｕｅ３．５") },
      { value: "计算", position: source.indexOf("计算机") },
      { value: "算机", position: source.indexOf("计算机") + 1 }
    ])
  } finally {
    Intl.Segmenter = originalSegmenter
  }
})
