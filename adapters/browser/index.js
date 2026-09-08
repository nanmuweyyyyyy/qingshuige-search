import { SearchEngine } from "../../src/index.js"

// Only default clients are shared. Explicit options create an independent client,
// so functions and custom strategies never collide in a serialized cache key.
const defaultClients = new WeakMap()
const defaultTimeoutMs = 12000

function sameSiteUrl(value, base, label) {
  let url
  try {
    url = new URL(value, base)
  } catch {
    throw new TypeError(`${label} must be a valid URL for this site`)
  }
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin) {
    throw new TypeError(`${label} must point to this site`)
  }
  return url
}

/**
 * Load a same-origin JSON Article[] and reuse its search index across queries.
 * `baseUrl` and `fetch` let callers use this adapter without a browser global.
 * Concurrent operations share one load; failures and timeouts can be retried.
 */
export function createSearchClient(indexUrl = "/search-index.json", options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Search client options must be an object")
  }
  const fetcher = options.fetch ?? globalThis.fetch
  if (typeof fetcher !== "function") throw new TypeError("Search client requires a fetch function")
  const baseValue = options.baseUrl ?? globalThis.location?.href ?? globalThis.window?.location?.href
  let base
  try {
    base = new URL(baseValue)
  } catch {
    throw new TypeError("Search client requires an absolute baseUrl outside a browser")
  }
  if (!["http:", "https:"].includes(base.protocol)) {
    throw new TypeError("Search client baseUrl must use HTTP or HTTPS")
  }
  const url = sameSiteUrl(String(indexUrl || "/search-index.json"), base, "Search index URL")
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Search client timeoutMs must be a positive number")
  }
  if (options.engineOptions != null && (typeof options.engineOptions !== "object" || Array.isArray(options.engineOptions))) {
    throw new TypeError("Search client engineOptions must be an object")
  }
  const shared = Object.keys(options).length === 0
  const key = JSON.stringify([base.href, url.href])
  let clients = defaultClients.get(fetcher)
  if (shared && clients?.has(key)) return clients.get(key)

  const engineOptions = { ...options.engineOptions }
  if (engineOptions.weights && typeof engineOptions.weights === "object" && !Array.isArray(engineOptions.weights)) {
    engineOptions.weights = { ...engineOptions.weights }
  }
  let engine = null
  let categoryValues = []
  let loading = null

  const load = () => {
    if (engine) return Promise.resolve(engine)
    if (loading) return loading

    const controller = new AbortController()
    let timeout
    const expired = new Promise((_resolve, reject) => {
      timeout = setTimeout(() => {
        // Reject even if an injected fetch implementation ignores AbortSignal.
        reject(new DOMException("Search index request timed out", "AbortError"))
        controller.abort()
      }, timeoutMs)
    })
    const request = (async () => {
      const response = await fetcher.call(globalThis, url.href, {
        headers: { Accept: "application/json" },
        cache: "no-cache",
        signal: controller.signal
      })
      if (!response.ok) throw new Error("Search index request failed: " + response.status)
      const payload = await response.json()
      if (!Array.isArray(payload) || payload.some((article) =>
        !article || typeof article !== "object" || Array.isArray(article)
        || typeof article.url !== "string" || !article.url.trim()
      )) {
        throw new TypeError("Search index must contain valid articles")
      }

      const articles = payload.map((article) => {
        const target = sameSiteUrl(article.url, base, "Search result URL")
        const path = target.pathname + target.search + target.hash
        // A same-origin absolute URL may contain a pathname starting with //.
        // Keep it absolute so links cannot reinterpret the path as another host.
        return { ...article, url: path.startsWith("//") ? target.href : path }
      })
      return new SearchEngine(engineOptions).load(articles)
    })()
    loading = Promise.race([request, expired]).then((nextEngine) => {
      const values = new Set()
      for (const article of nextEngine.articles) {
        if (!Array.isArray(article.categories)) continue
        for (const category of article.categories) {
          const value = String(category ?? "").trim()
          if (value) values.add(value)
        }
      }
      categoryValues = [...values].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      engine = nextEngine
      return engine
    }).finally(() => {
      clearTimeout(timeout)
      loading = null
    })
    return loading
  }

  const client = {
    async search(query, searchOptions = {}) {
      return (await load()).search(query, searchOptions)
    },
    async categories() {
      await load()
      return [...categoryValues]
    },
    load
  }
  if (shared) {
    if (!clients) defaultClients.set(fetcher, clients = new Map())
    clients.set(key, client)
  }
  return client
}
