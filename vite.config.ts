import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/target/**", "**/src-tauri/**", "**/crates/**"] },
  },
  worker: { format: "es" as const },
  build: { target: "es2022" },
});
