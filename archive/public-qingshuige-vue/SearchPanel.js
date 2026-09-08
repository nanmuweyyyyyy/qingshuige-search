import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "./vendor/vue.esm-browser.prod.js"
import { createSearchClient } from "./search-client.js"


const __sfc__ = {
  __name: 'SearchPanel',
  props: {
  indexUrl: {
    type: String,
    default: "/search-index.json"
  }
},
  setup(__props, { expose: __expose }) {
  __expose();

const props = __props

const dialog = ref(null)
const input = ref(null)
const open = ref(false)
const query = ref("")
const selectedCategory = ref("")
const categories = ref([])
const results = ref([])
const selectedIndex = ref(-1)
const loading = ref(false)
const error = ref("")
let debounceTimer = null
let requestVersion = 0
let triggerElements = []
let lastTrigger = null

const client = createSearchClient(props.indexUrl)

const statusText = computed(() => {
  if (loading.value) return "正在准备搜索索引…"
  if (error.value) return error.value
  if (!query.value.trim()) return "输入标题、作者或正文关键词开始搜索"
  if (results.value.length === 0) return `没有找到与「${query.value.trim()}」相关的文章`
  return `找到 ${results.value.length} 篇相关文章`
})

const queryTerms = computed(() => {
  const terms = query.value.match(/\p{Script=Han}+|[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu) ?? []
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function highlightSegments(text) {
  const source = String(text ?? "")
  if (!source || queryTerms.value.length === 0) {
    return [{ text: source, highlighted: false }]
  }

  const pattern = queryTerms.value.map(escapeRegExp).join("|")
  if (!pattern) return [{ text: source, highlighted: false }]

  const regex = new RegExp(`(${pattern})`, "giu")
  const segments = []
  let cursor = 0

  for (const match of source.matchAll(regex)) {
    const index = match.index ?? 0
    if (index > cursor) {
      segments.push({ text: source.slice(cursor, index), highlighted: false })
    }
    segments.push({ text: match[0], highlighted: true })
    cursor = index + match[0].length
  }

  if (cursor < source.length) {
    segments.push({ text: source.slice(cursor), highlighted: false })
  }

  return segments.length ? segments : [{ text: source, highlighted: false }]
}

function articleDate(article) {
  const value = String(article?.date ?? "")
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value
}

function articleCategories(article) {
  return Array.isArray(article?.categories) ? article.categories.filter(Boolean) : []
}

async function prepare() {
  if (categories.value.length || loading.value) return
  loading.value = true
  error.value = ""
  try {
    categories.value = await client.categories()
  } catch (cause) {
    console.error("[qingshuige-search] Failed to initialize search", cause)
    error.value = "搜索索引加载失败，请刷新页面后重试"
  } finally {
    loading.value = false
  }
}

async function runSearch() {
  const value = query.value.trim()
  const version = ++requestVersion

  if (!value) {
    results.value = []
    selectedIndex.value = -1
    error.value = ""
    return
  }

  loading.value = true
  error.value = ""

  try {
    const nextResults = await client.search(value, {
      category: selectedCategory.value || undefined,
      limit: 20
    })

    if (version !== requestVersion) return
    results.value = nextResults
    selectedIndex.value = nextResults.length ? 0 : -1
  } catch (cause) {
    if (version !== requestVersion) return
    console.error("[qingshuige-search] Search failed", cause)
    results.value = []
    selectedIndex.value = -1
    error.value = "搜索暂时不可用，请稍后重试"
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

function scheduleSearch() {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(runSearch, 180)
}

function setTriggerExpanded(expanded) {
  for (const element of triggerElements) {
    element.setAttribute("aria-expanded", String(expanded))
  }
}

function openSearch(source = null) {
  if (source instanceof Element) lastTrigger = source
  if (open.value) return
  open.value = true
  setTriggerExpanded(true)
  prepare()
  nextTick(() => input.value?.focus())
}

function closeSearch() {
  if (!open.value) return
  open.value = false
  setTriggerExpanded(false)
  window.clearTimeout(debounceTimer)
  nextTick(() => (lastTrigger ?? triggerElements[0])?.focus())
}

function handleSearchTrigger(event) {
  openSearch(event.currentTarget)
}

function moveSelection(delta) {
  if (!results.value.length) return
  const length = results.value.length
  const current = selectedIndex.value < 0 ? 0 : selectedIndex.value
  selectedIndex.value = (current + delta + length) % length
  nextTick(() => {
    dialog.value
      ?.querySelector(`[data-result-index="${selectedIndex.value}"]`)
      ?.scrollIntoView({ block: "nearest" })
  })
}

function openSelected() {
  const item = results.value[selectedIndex.value]
  const url = item?.article?.url
  if (url) window.location.assign(url)
}

function trapFocus(event) {
  if (event.key !== "Tab" || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hasAttribute("hidden"))

  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleWindowKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault()
    open.value ? closeSearch() : openSearch()
    return
  }

  if (!open.value) return

  if (event.key === "Escape") {
    event.preventDefault()
    closeSearch()
  } else if (event.key === "ArrowDown") {
    event.preventDefault()
    moveSelection(1)
  } else if (event.key === "ArrowUp") {
    event.preventDefault()
    moveSelection(-1)
  } else if (event.key === "Enter" && document.activeElement === input.value) {
    event.preventDefault()
    openSelected()
  }
}

watch([query, selectedCategory], scheduleSearch)

onMounted(() => {
  triggerElements = [...document.querySelectorAll("[data-search-trigger]")]
  for (const element of triggerElements) {
    element.addEventListener("click", handleSearchTrigger)
  }
  window.addEventListener("keydown", handleWindowKeydown)
})

onBeforeUnmount(() => {
  for (const element of triggerElements) {
    element.removeEventListener("click", handleSearchTrigger)
    element.setAttribute("aria-expanded", "false")
  }
  window.removeEventListener("keydown", handleWindowKeydown)
  window.clearTimeout(debounceTimer)
})

const __returned__ = { props, dialog, input, open, query, selectedCategory, categories, results, selectedIndex, loading, error, get debounceTimer() { return debounceTimer }, set debounceTimer(v) { debounceTimer = v }, get requestVersion() { return requestVersion }, set requestVersion(v) { requestVersion = v }, get triggerElements() { return triggerElements }, set triggerElements(v) { triggerElements = v }, get lastTrigger() { return lastTrigger }, set lastTrigger(v) { lastTrigger = v }, client, statusText, queryTerms, escapeRegExp, highlightSegments, articleDate, articleCategories, prepare, runSearch, scheduleSearch, setTriggerExpanded, openSearch, closeSearch, handleSearchTrigger, moveSelection, openSelected, trapFocus, handleWindowKeydown, computed, nextTick, onBeforeUnmount, onMounted, ref, watch, get createSearchClient() { return createSearchClient } }
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true })
return __returned__
}

}

import { createElementVNode as _createElementVNode, openBlock as _openBlock, createElementBlock as _createElementBlock, vModelText as _vModelText, withDirectives as _withDirectives, normalizeClass as _normalizeClass, renderList as _renderList, Fragment as _Fragment, toDisplayString as _toDisplayString, createCommentVNode as _createCommentVNode, createTextVNode as _createTextVNode, withModifiers as _withModifiers, Teleport as _Teleport, createBlock as _createBlock } from "./vendor/vue.esm-browser.prod.js"

const _hoisted_1 = { class: "qsg-search-header" }
const _hoisted_2 = { class: "qsg-search-input-wrap" }
const _hoisted_3 = {
  key: 0,
  class: "qsg-search-filters",
  "aria-label": "文章分类筛选"
}
const _hoisted_4 = ["onClick"]
const _hoisted_5 = {
  class: "qsg-search-status",
  role: "status",
  "aria-live": "polite"
}
const _hoisted_6 = {
  key: 1,
  class: "qsg-search-results",
  role: "listbox",
  "aria-label": "搜索结果"
}
const _hoisted_7 = ["href", "data-result-index", "aria-selected", "onMouseenter"]
const _hoisted_8 = { class: "qsg-search-result-title" }
const _hoisted_9 = { key: 0 }
const _hoisted_10 = { key: 1 }
const _hoisted_11 = { class: "qsg-search-meta" }
const _hoisted_12 = { key: 0 }
const _hoisted_13 = { key: 1 }
const _hoisted_14 = {
  key: 0,
  class: "qsg-search-snippet"
}
const _hoisted_15 = { key: 0 }
const _hoisted_16 = { key: 1 }

export function render(_ctx, _cache) {
  return (_openBlock(), _createBlock(_Teleport, { to: "body" }, [
    (_ctx.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 0,
          class: "qsg-search-layer",
          onMousedown: _cache[4] || (_cache[4] = _withModifiers((...args) => (_ctx.closeSearch && _ctx.closeSearch(...args)), ["self"]))
        }, [
          _createElementVNode("section", {
            id: "qsg-search-dialog",
            ref: "dialog",
            class: "qsg-search-dialog",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "站内搜索",
            onKeydown: _cache[3] || (_cache[3] = (...args) => (_ctx.trapFocus && _ctx.trapFocus(...args)))
          }, [
            _createElementVNode("header", _hoisted_1, [
              _createElementVNode("div", _hoisted_2, [
                _cache[5] || (_cache[5] = _createElementVNode("svg", {
                  viewBox: "0 0 24 24",
                  "aria-hidden": "true"
                }, [
                  _createElementVNode("circle", {
                    cx: "11",
                    cy: "11",
                    r: "6.5"
                  }),
                  _createElementVNode("path", { d: "m16 16 4.2 4.2" })
                ], -1 /* CACHED */)),
                _withDirectives(_createElementVNode("input", {
                  ref: "input",
                  "onUpdate:modelValue": _cache[0] || (_cache[0] = $event => ((_ctx.query) = $event)),
                  class: "qsg-search-input",
                  type: "search",
                  autocomplete: "off",
                  spellcheck: "false",
                  placeholder: "搜索标题、作者或正文…",
                  "aria-label": "搜索关键词"
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelText, _ctx.query]
                ])
              ]),
              _createElementVNode("button", {
                class: "qsg-search-close",
                type: "button",
                "aria-label": "关闭搜索",
                onClick: _cache[1] || (_cache[1] = (...args) => (_ctx.closeSearch && _ctx.closeSearch(...args)))
              }, [...(_cache[6] || (_cache[6] = [
                _createElementVNode("span", { "aria-hidden": "true" }, "×", -1 /* CACHED */)
              ]))])
            ]),
            (_ctx.categories.length)
              ? (_openBlock(), _createElementBlock("div", _hoisted_3, [
                  _createElementVNode("button", {
                    type: "button",
                    class: _normalizeClass(['qsg-search-filter', { 'is-active': _ctx.selectedCategory === '' }]),
                    onClick: _cache[2] || (_cache[2] = $event => (_ctx.selectedCategory = ''))
                  }, " 全部 ", 2 /* CLASS */),
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.categories, (category) => {
                    return (_openBlock(), _createElementBlock("button", {
                      key: category,
                      type: "button",
                      class: _normalizeClass(['qsg-search-filter', { 'is-active': _ctx.selectedCategory === category }]),
                      onClick: $event => (_ctx.selectedCategory = category)
                    }, _toDisplayString(category), 11 /* TEXT, CLASS, PROPS */, _hoisted_4))
                  }), 128 /* KEYED_FRAGMENT */))
                ]))
              : _createCommentVNode("v-if", true),
            _createElementVNode("div", _hoisted_5, _toDisplayString(_ctx.statusText), 1 /* TEXT */),
            (_ctx.results.length)
              ? (_openBlock(), _createElementBlock("div", _hoisted_6, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.results, (result, index) => {
                    return (_openBlock(), _createElementBlock("a", {
                      key: result.externalId ?? result.article.url,
                      href: result.article.url,
                      "data-result-index": index,
                      class: _normalizeClass(['qsg-search-result', { 'is-selected': _ctx.selectedIndex === index }]),
                      role: "option",
                      "aria-selected": _ctx.selectedIndex === index,
                      onMouseenter: $event => (_ctx.selectedIndex = index)
                    }, [
                      _createElementVNode("h2", _hoisted_8, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.highlightSegments(result.article.title), (segment, segmentIndex) => {
                          return (_openBlock(), _createElementBlock(_Fragment, { key: segmentIndex }, [
                            (segment.highlighted)
                              ? (_openBlock(), _createElementBlock("mark", _hoisted_9, _toDisplayString(segment.text), 1 /* TEXT */))
                              : (_openBlock(), _createElementBlock("span", _hoisted_10, _toDisplayString(segment.text), 1 /* TEXT */))
                          ], 64 /* STABLE_FRAGMENT */))
                        }), 128 /* KEYED_FRAGMENT */))
                      ]),
                      _createElementVNode("div", _hoisted_11, [
                        (result.article.author)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_12, _toDisplayString(result.article.author), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        (_ctx.articleDate(result.article))
                          ? (_openBlock(), _createElementBlock("span", _hoisted_13, _toDisplayString(_ctx.articleDate(result.article)), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.articleCategories(result.article), (category) => {
                          return (_openBlock(), _createElementBlock("span", { key: category }, _toDisplayString(category), 1 /* TEXT */))
                        }), 128 /* KEYED_FRAGMENT */))
                      ]),
                      (result.snippet)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_14, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.highlightSegments(result.snippet), (segment, segmentIndex) => {
                              return (_openBlock(), _createElementBlock(_Fragment, { key: segmentIndex }, [
                                (segment.highlighted)
                                  ? (_openBlock(), _createElementBlock("mark", _hoisted_15, _toDisplayString(segment.text), 1 /* TEXT */))
                                  : (_openBlock(), _createElementBlock("span", _hoisted_16, _toDisplayString(segment.text), 1 /* TEXT */))
                              ], 64 /* STABLE_FRAGMENT */))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        : _createCommentVNode("v-if", true)
                    ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_7))
                  }), 128 /* KEYED_FRAGMENT */))
                ]))
              : _createCommentVNode("v-if", true),
            _cache[7] || (_cache[7] = _createElementVNode("footer", { class: "qsg-search-footer" }, [
              _createElementVNode("span", null, [
                _createElementVNode("kbd", null, "↑"),
                _createElementVNode("kbd", null, "↓"),
                _createTextVNode(" 选择")
              ]),
              _createElementVNode("span", null, [
                _createElementVNode("kbd", null, "Enter"),
                _createTextVNode(" 打开")
              ]),
              _createElementVNode("span", null, [
                _createElementVNode("kbd", null, "Esc"),
                _createTextVNode(" 关闭")
              ])
            ], -1 /* CACHED */))
          ], 544 /* NEED_HYDRATION, NEED_PATCH */)
        ], 32 /* NEED_HYDRATION */))
      : _createCommentVNode("v-if", true)
  ]))
}

__sfc__.render = render
export default __sfc__
