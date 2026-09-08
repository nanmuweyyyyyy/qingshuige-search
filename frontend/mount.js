import { createApp } from "vue"
import SearchPanel from "./components/SearchPanel.vue"

const mountedApp = Symbol.for("qingshuige-search.vue-app")
const selector = '[data-qsg-search], [data-vue-component="SearchPanel"]'

function readOptions(element, name) {
  const source = element.dataset[name]
  if (!source) return {}
  try {
    const value = JSON.parse(source)
    if (value && typeof value === "object" && !Array.isArray(value)) return value
  } catch {
    // A malformed optional attribute should not prevent opening search.
  }
  console.warn(`[qingshuige-search] Invalid ${name} JSON; using defaults`)
  return {}
}

/** Mount Vue search on a document, subtree, or an individual host element. */
export function mountSearch(root = document) {
  const elements = [...root.querySelectorAll(selector)]
  if (root.matches?.(selector)) elements.unshift(root)
  return elements.map((element) => {
    if (element[mountedApp]) return element[mountedApp]
    const ui = readOptions(element, "searchUi")
    const props = {
      indexUrl: element.dataset.searchIndexUrl,
      engineOptions: readOptions(element, "searchOptions")
    }
    if (Number.isInteger(ui.resultLimit) && ui.resultLimit > 0) props.resultLimit = ui.resultLimit
    if (Number.isFinite(ui.debounceMs) && ui.debounceMs >= 0) props.debounceMs = ui.debounceMs
    const app = createApp(SearchPanel, props)
    app.mount(element)
    element[mountedApp] = app
    app.onUnmount(() => { delete element[mountedApp] })
    return app
  })
}
