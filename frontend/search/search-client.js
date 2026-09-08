import { SearchEngine } from "qingshuige-search"

const clients = new Map()
const requestTimeout = 12000

export function createSearchClient(indexUrl) {
  const url = String(indexUrl || "/search-index.json")
  if (clients.has(url)) return clients.get(url)

  let engine = null
  let categoryValues = []
  let loading = null

  const load = () => {
    if (engine) return Promise.resolve(engine)
    if (loading) return loading

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeout)
    loading = (async () => {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          // 首次打开时验证索引是否更新，同一页面的后续查询复用内存索引。
          cache: "no-cache",
          signal: controller.signal
        })
        if (!response.ok) throw new Error("Search index request failed: " + response.status)
        const payload = await response.json()
        if (!Array.isArray(payload) || payload.some((article) =>
          !article || typeof article !== "object" || typeof article.title !== "string"
          || typeof article.url !== "string" || !article.url.trim()
        )) {
          throw new TypeError("Search index must contain valid articles")
        }

        const articles = payload.map((article) => {
          const target = new URL(article.url, window.location.href)
          if (!["http:", "https:"].includes(target.protocol) || target.origin !== window.location.origin) {
            throw new TypeError("Search result URL must point to this site")
          }
          return { ...article, url: target.pathname + target.search + target.hash }
        })
        const nextEngine = new SearchEngine().load(articles)
        const values = new Set()
        for (const article of articles) {
          if (!Array.isArray(article.categories)) continue
          for (const category of article.categories) {
            const value = String(category ?? "").trim()
            if (value) values.add(value)
          }
        }
        categoryValues = [...values].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
        engine = nextEngine
        return engine
      } finally {
        clearTimeout(timeout)
      }
    })().finally(() => { loading = null })
    return loading
  }

  const client = {
    async search(query, options = {}) {
      const searchEngine = await load()
      return searchEngine.search(query, options)
    },
    async categories() {
      await load()
      return [...categoryValues]
    },
    load
  }
  clients.set(url, client)
  return client
}
