# Web version

A static site: the viewer, cosmetics, weapons, animations, play mode and particles, without the item compiler and the desktop-only
features (workshop import, native menus, folders on disk). No server code: any static host serves it.

## How it works

- The app's Rust backend (`crates/workbench-core`, shared with the desktop app) is compiled to WebAssembly (`crates/workbench-wasm`) and runs in a
  Web Worker (`src/web/backend.worker.ts`). It reads the game's files one by one with synchronous XHR from `assets/<path>`, so the desktop
  code that "reads a file and waits for it" stays as it is.
- Vite's web mode (`--mode web`) swaps the Tauri modules for `src/web/*`: `invoke` answers from the worker or from the baked lists;
  settings, session, poses and light setups live in localStorage; saves are downloads and opens are uploads.
- Particles run on a JavaScript port of Valve's particle system (`src/viewer/particles/sdk`). The desktop app can also use a native
  helper built from the Source SDK (`native/particle-probe`).

## The game's files are not in the repository

`build-webapp.bat` extracts them from your own Team Fortress 2 install into `web-assets/` (git-ignored) with the `webbake` crate: it asks
the backend for every model, material, animation, particle effect and sky the viewer can show and copies exactly the files that needed.
Expect tens of minutes and ~5 GB (about 58,000 files). `web-assets/failures.txt` lists what could not be loaded (items the item schema
names but the game does not ship).

```
build-webapp.bat              extract everything, build the backend and the page
build-webapp.bat skipbake     keep web-assets, rebuild only the page and the backend
build-webapp.bat quick        a small extraction, to try the build
```

Output: `dist-web/`. Try it locally with `npx vite preview --mode web --outDir dist-web`; during development
`set WEB_ASSETS=web-assets` and `npm run dev:web`.

## Hosting

58k files / ~5 GB is more than GitHub Pages (1 GB) or Cloudflare Pages (20,000 files) take, so host the game's files in a bucket
(Cloudflare R2, S3, B2, your own server) and the page anywhere:

1. `set ASSETS_URL=https://your-bucket-address/` then `build-webapp.bat skipbake`. `dist-web` is now small (page, wasm, lists, index) and
   the page reads the game's files from `ASSETS_URL + "assets/<path>"`.
2. Upload the contents of `web-assets/assets` so that it appears under `assets/` at that address.
3. Give the bucket CORS: `Access-Control-Allow-Origin` for the page's origin (or `*`), method GET. Serve with long cache headers; the
   files never change for a given bake.
4. Upload `dist-web` to the page host (GitHub Pages works).

Without `ASSETS_URL`, `dist-web` contains everything and any host with enough room serves it as it is.

## Not in the web version

Item compiler, workshop and custom-cosmetic import, taunt cache, opening folders. Custom effect zips are not available either.

## Missing files

`window.__missingGameFiles` (a Set) in the page lists files the backend asked for that the site does not have. Add the roots they
belong to in `crates/webbake/src/main.rs` and bake again.
