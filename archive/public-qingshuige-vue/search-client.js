import { SearchEngine } from "./search/index.js"

const clients = new Map()

function normalizeIndexUrl(value) {
  const fallback = "/search-index.json"
  if (!value) return fallback
  return String(value)
}

export function createSearchClient(indexUrl) {
  const url = normalizeIndexUrl(indexUrl)
  if (clients.has(url)) return clients.get(url)

  let engine = null
  let articles = []
  let loading = null

  const load = async () => {
    if (engine) return engine
    if (loading) return loading

    loading = fetch(url, {
      headers: { Accept: "application/json" },
      cache: "force-cache"
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Search index request failed: ${response.status}`)
        }

        const payload = await response.json()
        if (!Array.isArray(payload)) {
          throw new TypeError("Search index must contain an Article[]")
        }

        articles = payload
        engine = new SearchEngine().load(payload)
        return engine
      })
      .catch((error) => {
        loading = null
        throw error
      })

    return loading
  }

  const client = {
    async search(query, options = {}) {
      const searchEngine = await load()
      return searchEngine.search(query, options)
    },

    async categories() {
      await load()
      const values = new Set()
      for (const article of articles) {
        if (!Array.isArray(article.categories)) continue
        for (const category of article.categories) {
          const value = String(category ?? "").trim()
          if (value) values.add(value)
        }
      }
      return [...values].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    },

    load
  }

  clients.set(url, client)
  return client
}
