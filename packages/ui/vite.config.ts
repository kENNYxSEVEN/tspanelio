import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const rootPackageJson = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf-8"),
) as { version: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
  __APP_VERSION__: JSON.stringify(rootPackageJson.version),
  },
})