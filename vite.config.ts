import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The web build (`vite --mode web`, see build-webapp.bat) is the same app without the desktop shell: the Tauri modules are replaced by ones
 * that work in a page (src/web), and the game's files are served from `web-assets` (made by the bake tool, never committed).
 */
function webTarget(): Plugin {
  const swaps: [RegExp, string][] = [
    [/^@tauri-apps\/api\/core$/, here("./src/web/tauri-core.ts")],
    [/^@tauri-apps\/api\/event$/, here("./src/web/tauri-event.ts")],
    [/^@tauri-apps\/plugin-dialog$/, here("./src/web/dialog.ts")],
    [/(^|\/)playMouse$/, here("./src/web/playMouseWeb.ts")],
  ];
  return {
    name: "web-target",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.includes("/src/web/")) return null;
      for (const [pattern, file] of swaps) if (pattern.test(source)) return file;
      return null;
    },
  };
}

/** With the game's files hosted elsewhere (VITE_ASSETS_URL), the build copies the public folder without its "assets" folder: the site stays small. */
function withoutAssets(publicDir: string, outDir: string): Plugin {
  return {
    name: "web-public-without-assets",
    apply: "build",
    closeBundle() {
      for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
        if (entry.name === "assets") continue;
        fs.cpSync(path.join(publicDir, entry.name), path.join(outDir, entry.name), { recursive: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const web = mode === "web";
  const publicDir = web ? (process.env.WEB_ASSETS ?? "web-assets") : undefined;
  const external = web && !!process.env.VITE_ASSETS_URL;
  return {
    clearScreen: false,
    base: web ? "./" : undefined,
    plugins: web ? [webTarget(), ...(external ? [withoutAssets(publicDir!, "dist-web")] : [])] : [],
    // the web build's game files: made by `webbake`, served (and copied into the build) from here
    publicDir: external ? false : publicDir,
    server: {
      port: 1420,
      strictPort: true,
      watch: { ignored: ["**/target/**", "**/src-tauri/**", "**/crates/**", "**/web-assets/**", "**/dist-web/**"] },
    },
    worker: { format: "es" as const },
    build: { target: "es2022", ...(web ? { outDir: "dist-web", emptyOutDir: true, chunkSizeWarningLimit: 4000 } : {}) },
    define: { __WEB__: JSON.stringify(web) },
  };
});
