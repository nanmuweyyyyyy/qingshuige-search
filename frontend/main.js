import { createApp } from "vue"
import SearchPanel from "./components/SearchPanel.vue"

const components = Object.freeze({
  SearchPanel
})

for (const element of document.querySelectorAll("[data-vue-component]")) {
  const name = element.dataset.vueComponent
  const component = components[name]

  if (!component) {
    console.warn(`[qingshuige-theme] Unknown Vue component: ${name}`)
    continue
  }

  const props = name === "SearchPanel"
    ? { indexUrl: element.dataset.searchIndexUrl }
    : {}

  createApp(component, props).mount(element)
}
