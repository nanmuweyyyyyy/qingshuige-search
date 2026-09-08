import { resolve } from "node:path"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base: "./",
  // 库模式不会自动替换 NODE_ENV；浏览器中没有 Node.js 的 process。
  define: {
    "process.env.NODE_ENV": JSON.stringify(command === "build" ? "production" : "development"),
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: {
      origin: "http://localhost:1313"
    }
  },
  build: {
    outDir: "assets/qingshuige-vue",
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "frontend/main.js"),
      formats: ["es"],
      fileName: "qingshuige-vue",
      cssFileName: "qingshuige-vue"
    }
  }
}))
