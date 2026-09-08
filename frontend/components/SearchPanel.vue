<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { createSearchClient } from "../search/search-client.js"

const props = defineProps({
  indexUrl: { type: String, default: "/search-index.json" }
})

const dialog = ref(null)
const input = ref(null)
const open = ref(false)
const query = ref("")
const selectedCategory = ref("")
const categories = ref([])
const results = ref([])
const selectedIndex = ref(-1)
const loading = ref(false)
const ready = ref(false)
const hasMore = ref(false)
const error = ref("")
const composing = ref(false)
let debounceTimer = null
let requestVersion = 0
let lastTrigger = null
let restorePage = null
const resultLimit = 20
const client = createSearchClient(props.indexUrl)

const statusText = computed(() => {
  if (loading.value) return ready.value ? "正在搜索…" : "正在准备搜索索引…"
  if (error.value) return error.value
  if (composing.value) return "请完成关键词输入"
  if (!query.value.trim()) return "输入标题、作者、日期或正文关键词开始搜索"
  if (results.value.length === 0) return "没有找到与「" + query.value.trim() + "」相关的文章"
  if (hasMore.value) return "显示前 " + resultLimit + " 篇相关文章，可继续输入或筛选分类"
  return "找到 " + results.value.length + " 篇相关文章"
})

const queryTerms = computed(() => {
  const terms = query.value.match(/\p{Script=Han}+|[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu) ?? []
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&")
}

function highlightSegments(text) {
  const source = String(text ?? "")
  if (!source || queryTerms.value.length === 0) return [{ text: source, highlighted: false }]
  const pattern = queryTerms.value.map(escapeRegExp).join("|")
  const regex = new RegExp("(" + pattern + ")", "giu")
  const segments = []
  let cursor = 0
  for (const match of source.matchAll(regex)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ text: source.slice(cursor, index), highlighted: false })
    segments.push({ text: match[0], highlighted: true })
    cursor = index + match[0].length
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), highlighted: false })
  return segments.length ? segments : [{ text: source, highlighted: false }]
}

function articleDate(article) {
  const value = String(article?.date ?? "")
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value
}

function articleCategories(article) {
  return Array.isArray(article?.categories) ? article.categories.filter(Boolean) : []
}

function invalidateSearch() {
  window.clearTimeout(debounceTimer)
  debounceTimer = null
  requestVersion += 1
}

function clearResults() {
  results.value = []
  selectedIndex.value = -1
  hasMore.value = false
}

async function runSearch() {
  invalidateSearch()
  if (!open.value || composing.value) return
  const version = requestVersion
  const value = query.value.trim()
  const category = selectedCategory.value
  loading.value = true
  error.value = ""
  clearResults()

  try {
    const nextCategories = await client.categories()
    if (version !== requestVersion || !open.value) return
    categories.value = nextCategories
    ready.value = true
    const nextResults = value
      ? await client.search(value, { category: category || undefined, limit: resultLimit + 1 })
      : []
    if (version !== requestVersion || !open.value) return
    hasMore.value = nextResults.length > resultLimit
    results.value = nextResults.slice(0, resultLimit)
    selectedIndex.value = results.value.length ? 0 : -1
  } catch (cause) {
    if (version !== requestVersion || !open.value) return
    console.error("[qingshuige-search] Search failed", cause)
    error.value = "搜索加载失败，请检查网络后重试"
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

function scheduleSearch() {
  // 输入变化时立刻使旧请求和旧结果失效，避免防抖期间误开旧文章。
  invalidateSearch()
  clearResults()
  error.value = ""
  loading.value = false
  if (!open.value || composing.value) return
  if (!query.value.trim() && ready.value) return
  loading.value = true
  debounceTimer = window.setTimeout(runSearch, 180)
}

function setTriggerExpanded(expanded) {
  for (const element of document.querySelectorAll("[data-search-trigger]")) {
    element.setAttribute("aria-expanded", String(expanded))
  }
}

function lockPage() {
  const scrollY = window.scrollY
  const body = document.body
  const previous = {}
  for (const key of ["position", "top", "width", "overflow", "paddingRight"]) previous[key] = body.style[key]
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
  if (scrollbarWidth > 0) {
    body.style.paddingRight = (parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth) + "px"
  }
  body.style.position = "fixed"
  body.style.top = "-" + scrollY + "px"
  body.style.width = "100%"
  body.style.overflow = "hidden"

  const background = [...document.querySelectorAll(".site-header, .site-main, .site-footer, .skip-link")]
    .map((element) => ({ element, inert: element.inert }))
  for (const { element } of background) element.inert = true

  restorePage = () => {
    for (const [key, value] of Object.entries(previous)) body.style[key] = value
    for (const { element, inert } of background) element.inert = inert
    window.scrollTo({ top: scrollY, behavior: "instant" })
    restorePage = null
  }
}

function openSearch(source = null) {
  if (open.value) {
    input.value?.focus()
    return
  }
  lastTrigger = source instanceof HTMLElement ? source : document.activeElement
  open.value = true
  composing.value = false
  setTriggerExpanded(true)
  lockPage()
  void runSearch()
  nextTick(() => { if (open.value) input.value?.focus({ preventScroll: true }) })
}

function closeSearch() {
  if (!open.value) return
  open.value = false
  composing.value = false
  invalidateSearch()
  loading.value = false
  setTriggerExpanded(false)
  restorePage?.()
  nextTick(() => {
    if (open.value) return
    const target = lastTrigger?.isConnected ? lastTrigger : document.querySelector("[data-search-trigger]")
    target?.focus({ preventScroll: true })
  })
}

function handleSearchTrigger(event) {
  const trigger = event.target instanceof Element ? event.target.closest("[data-search-trigger]") : null
  if (!trigger || trigger.disabled) return
  event.preventDefault()
  openSearch(trigger)
}

function moveSelection(delta) {
  if (loading.value || !results.value.length) return
  const length = results.value.length
  const current = selectedIndex.value
  selectedIndex.value = current < 0 ? (delta > 0 ? 0 : length - 1) : (current + delta + length) % length
  nextTick(() => {
    dialog.value?.querySelector('[data-result-index="' + selectedIndex.value + '"]')
      ?.scrollIntoView({ block: "nearest" })
  })
}

function openSelected() {
  if (loading.value || composing.value) return
  const url = results.value[selectedIndex.value]?.article?.url
  if (url) window.location.assign(url)
}

function trapFocus(event) {
  if (event.key !== "Tab" || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.getClientRects().length && !element.closest("[inert]"))
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first) return
  if (event.shiftKey && (document.activeElement === first || !dialog.value.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleWindowKeydown(event) {
  // 中文输入法的确认、选词和取消按键交给输入法处理。
  if (event.isComposing || event.keyCode === 229 || composing.value || event.defaultPrevented) return
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
    event.preventDefault()
    if (!event.repeat) open.value ? closeSearch() : openSearch()
    return
  }
  if (!open.value) return
  if (event.key === "Escape") {
    event.preventDefault()
    closeSearch()
    return
  }
  if (document.activeElement !== input.value || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    moveSelection(event.key === "ArrowDown" ? 1 : -1)
  } else if (event.key === "Enter") {
    event.preventDefault()
    if (debounceTimer !== null) void runSearch()
    else openSelected()
  }
}

function startComposition() {
  composing.value = true
  invalidateSearch()
  clearResults()
  loading.value = false
}

function endComposition(event) {
  composing.value = false
  query.value = event.target.value
  scheduleSearch()
}

watch([query, selectedCategory], scheduleSearch, { flush: "sync" })

onMounted(() => {
  document.addEventListener("click", handleSearchTrigger)
  window.addEventListener("keydown", handleWindowKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener("click", handleSearchTrigger)
  window.removeEventListener("keydown", handleWindowKeydown)
  invalidateSearch()
  setTriggerExpanded(false)
  restorePage?.()
})
</script>


<template>
  <Teleport to="body">
    <div v-if="open" class="qsg-search-layer" @pointerdown.self="closeSearch">
      <section
        id="qsg-search-dialog"
        ref="dialog"
        class="qsg-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="站内搜索"
        tabindex="-1"
        @keydown="trapFocus"
      >
        <header class="qsg-search-header">
          <div class="qsg-search-input-wrap">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4.2 4.2" />
            </svg>
            <input
              ref="input"
              v-model="query"
              class="qsg-search-input"
              type="search"
              autocomplete="off"
              spellcheck="false"
              placeholder="搜索标题、作者或正文…"
              aria-label="搜索关键词"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="qsg-search-results"
              aria-expanded="true"
              :aria-activedescendant="selectedIndex >= 0 ? 'qsg-search-result-' + selectedIndex : undefined"
              @compositionstart="startComposition"
              @compositionend="endComposition"
            />
          </div>
          <button class="qsg-search-close" type="button" aria-label="关闭搜索" @click="closeSearch">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div v-if="categories.length" class="qsg-search-filters" aria-label="文章分类筛选">
          <button
            type="button"
            :class="['qsg-search-filter', { 'is-active': selectedCategory === '' }]"
            :aria-pressed="selectedCategory === ''"
            @click="selectedCategory = ''"
          >
            全部
          </button>
          <button
            v-for="category in categories"
            :key="category"
            type="button"
            :class="['qsg-search-filter', { 'is-active': selectedCategory === category }]"
            :aria-pressed="selectedCategory === category"
            @click="selectedCategory = category"
          >
            {{ category }}
          </button>
        </div>

        <div class="qsg-search-status" role="status" aria-live="polite" aria-atomic="true">
          {{ statusText }}
        </div>
        <div v-if="error" class="qsg-search-error-actions">
          <button type="button" class="qsg-search-filter" @click="runSearch(); input?.focus()">重试</button>
        </div>

        <div id="qsg-search-results" class="qsg-search-results" role="listbox" aria-label="搜索结果" :aria-busy="loading">
          <a
            v-for="(result, index) in results"
            :key="result.externalId ?? result.article.url"
            :href="result.article.url"
            :data-result-index="index"
            :id="'qsg-search-result-' + index"
            :class="['qsg-search-result', { 'is-selected': selectedIndex === index }]"
            role="option"
            :aria-selected="selectedIndex === index"
            @mouseenter="selectedIndex = index"
            @focus="selectedIndex = index"
          >
            <h2 class="qsg-search-result-title">
              <template v-for="(segment, segmentIndex) in highlightSegments(result.article.title)" :key="segmentIndex">
                <mark v-if="segment.highlighted">{{ segment.text }}</mark>
                <span v-else>{{ segment.text }}</span>
              </template>
            </h2>

            <div class="qsg-search-meta">
              <span v-if="result.article.author">{{ result.article.author }}</span>
              <span v-if="articleDate(result.article)">{{ articleDate(result.article) }}</span>
              <span v-for="category in articleCategories(result.article)" :key="category">{{ category }}</span>
            </div>

            <p v-if="result.snippet" class="qsg-search-snippet">
              <template v-for="(segment, segmentIndex) in highlightSegments(result.snippet)" :key="segmentIndex">
                <mark v-if="segment.highlighted">{{ segment.text }}</mark>
                <span v-else>{{ segment.text }}</span>
              </template>
            </p>
          </a>
        </div>

        <footer class="qsg-search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style>
.qsg-search-input-wrap svg {
  width: 1.25rem;
  height: 1.25rem;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.qsg-search-layer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: start center;
  padding: min(12vh, 7rem) 1rem 1rem;
  background: rgba(17, 32, 45, 0.48);
  backdrop-filter: blur(6px);
}

.qsg-search-dialog {
  width: min(44rem, 100%);
  max-height: min(76vh, 46rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--qsg-ink);
  background: rgba(255, 255, 255, 0.985);
  border: 1px solid var(--qsg-border);
  border-radius: 1rem;
  box-shadow: 0 1.5rem 4rem rgba(17, 45, 65, 0.25);
}

.qsg-search-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.85rem;
  border-bottom: 1px solid var(--qsg-border);
}

.qsg-search-input-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0 0.75rem;
  border: 1px solid var(--qsg-border);
  border-radius: 0.75rem;
  background: #fff;
}

.qsg-search-input-wrap:focus-within {
  border-color: var(--qsg-blue-500);
  box-shadow: 0 0 0 2px var(--qsg-blue-100);
}

.qsg-search-input {
  width: 100%;
  min-height: 2.8rem;
  border: 0;
  outline: 0;
  color: var(--qsg-ink);
  background: transparent;
  font: inherit;
}

.qsg-search-input::-webkit-search-cancel-button {
  cursor: pointer;
}

.qsg-search-close {
  width: 2.65rem;
  height: 2.65rem;
  border: 0;
  border-radius: 0.7rem;
  color: var(--qsg-ink-soft);
  background: transparent;
  font-size: 1.7rem;
  line-height: 1;
  cursor: pointer;
}

.qsg-search-close:hover,
.qsg-search-close:focus-visible {
  color: var(--qsg-ink);
  background: var(--qsg-blue-100);
}

.qsg-search-filters {
  flex: 0 0 auto;
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding: 0.7rem 0.85rem 0.35rem;
  scrollbar-width: thin;
}

.qsg-search-filter {
  flex: 0 0 auto;
  border: 1px solid var(--qsg-border);
  border-radius: 999px;
  padding: 0.32rem 0.7rem;
  color: var(--qsg-ink-soft);
  background: #fff;
  font: inherit;
  font-size: 0.86rem;
  cursor: pointer;
}

.qsg-search-filter:hover,
.qsg-search-filter:focus-visible,
.qsg-search-filter.is-active {
  border-color: var(--qsg-blue-500);
  color: var(--qsg-blue-800);
  background: var(--qsg-blue-100);
}

.qsg-search-status {
  flex: 0 0 auto;
  padding: 0.4rem 1rem 0.65rem;
  color: var(--qsg-ink-soft);
  font-size: 0.86rem;
}

.qsg-search-error-actions {
  padding: 0 1rem 0.8rem;
}

.qsg-search-results {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 0.6rem 0.65rem;
}

.qsg-search-result {
  display: block;
  padding: 0.8rem 0.85rem;
  color: inherit;
  text-decoration: none;
  border-radius: 0.75rem;
  border: 1px solid transparent;
}

.qsg-search-result:hover,
.qsg-search-result:focus-visible,
.qsg-search-result.is-selected {
  outline: 0;
  border-color: rgba(71, 130, 171, 0.18);
  background: var(--qsg-blue-100);
}

.qsg-search-result-title {
  margin: 0;
  color: var(--qsg-blue-800);
  font-size: 1rem;
  line-height: 1.45;
}

.qsg-search-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.65rem;
  margin-top: 0.3rem;
  color: var(--qsg-ink-soft);
  font-size: 0.78rem;
}

.qsg-search-meta span + span::before {
  content: "·";
  margin-right: 0.65rem;
  opacity: 0.55;
}

.qsg-search-snippet {
  margin: 0.42rem 0 0;
  color: var(--qsg-ink-soft);
  font-size: 0.88rem;
  line-height: 1.6;
}

.qsg-search-dialog mark {
  padding: 0 0.05em;
  color: inherit;
  background: rgba(255, 215, 92, 0.42);
  border-radius: 0.14em;
}

.qsg-search-footer {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
  padding: 0.65rem 0.9rem;
  color: var(--qsg-ink-soft);
  background: rgba(246, 249, 251, 0.92);
  border-top: 1px solid var(--qsg-border);
  font-size: 0.75rem;
}

.qsg-search-dialog kbd {
  display: inline-flex;
  min-width: 1.45rem;
  min-height: 1.35rem;
  align-items: center;
  justify-content: center;
  margin-right: 0.18rem;
  padding: 0 0.28rem;
  border: 1px solid var(--qsg-border);
  border-radius: 0.3rem;
  color: var(--qsg-ink-soft);
  background: #fff;
  font: inherit;
  box-shadow: 0 1px 0 rgba(17, 45, 65, 0.08);
}

@media (max-width: 43.75rem) {
  .qsg-search-layer {
    padding: 0;
    place-items: stretch;
    background: #fff;
  }

  .qsg-search-dialog {
    width: 100%;
    max-height: none;
    height: 100dvh;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .qsg-search-header {
    padding-top: max(0.8rem, env(safe-area-inset-top));
  }

  .qsg-search-footer {
    padding-bottom: max(0.65rem, env(safe-area-inset-bottom));
  }
}
</style>
