/// <reference lib="webworker" />
/**
 * The web build's backend: the app's own Rust backend (workbench-core) as WebAssembly, in a worker. The module asks for the game's files
 * through `host_fetch`, which fetches them from the site one by one with a synchronous request (allowed in a worker, and the reason the
 * backend can stay the code the desktop app runs: it reads a file and waits for it). The browser's cache keeps what was fetched.
 */
interface Exports {
  memory: WebAssembly.Memory;
  alloc(size: number): number;
  dealloc(ptr: number, size: number): void;
  init(ptr: number, len: number): void;
  call(command: number, commandLen: number, args: number, argsLen: number): number;
  result_ptr(): number;
  result_len(): number;
}

let base = "";
/** Where the game's files are served from: the site itself, or (build-webapp.bat with ASSETS_URL set: VITE_ASSETS_URL) a bucket that holds web-assets/assets. */
let assetsBase = "";
function assetsRoot(root: string): string {
  const given = (import.meta.env.VITE_ASSETS_URL as string | undefined) || "";
  const url = given || root;
  return url.endsWith("/") ? url : url + "/";
}
let wasm: Exports | null = null;
let ready: Promise<void> | null = null;
let stash: Uint8Array | null = null;
/** Files read recently, so that a model's second look at its textures costs no copy. */
const recent = new Map<string, Uint8Array | null>();
let recentBytes = 0;
const RECENT_LIMIT = 40 * 1024 * 1024;
const missing = new Set<string>();

function fetchSync(path: string): Uint8Array | null {
  if (recent.has(path)) { const hit = recent.get(path)!; recent.delete(path); recent.set(path, hit); return hit; }
  const request = new XMLHttpRequest();
  request.open("GET", `${assetsBase}assets/${path.split("/").map(encodeURIComponent).join("/")}`, false);
  request.responseType = "arraybuffer";
  let bytes: Uint8Array | null = null;
  try {
    request.send();
    if (request.status === 200) bytes = new Uint8Array(request.response as ArrayBuffer);
  } catch { /* unreachable: missing */ }
  // (a file the site does not have is reported to the page, which keeps the list: window.__missingGameFiles, for finding what the bake left out)
  if (!bytes && !missing.has(path)) { missing.add(path); (self as unknown as Worker).postMessage({ missing: path }); }
  recent.set(path, bytes);
  recentBytes += bytes?.length ?? 0;
  for (const [key, value] of recent) {
    if (recentBytes <= RECENT_LIMIT) break;
    recent.delete(key);
    recentBytes -= value?.length ?? 0;
  }
  return bytes;
}

async function start(root: string) {
  base = root;
  assetsBase = assetsRoot(root);
  const [module, index] = await Promise.all([
    WebAssembly.compileStreaming(fetch(`${base}workbench.wasm`)),
    fetch(`${base}index.txt`).then((r) => { if (!r.ok) throw new Error(`index.txt: ${r.status}`); return r.arrayBuffer(); }),
  ]);
  let exports!: Exports;
  const instance = await WebAssembly.instantiate(module, {
    env: {
      host_fetch(ptr: number, len: number): number {
        const path = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
        stash = fetchSync(path);
        return stash ? stash.length : -1;
      },
      host_take(destination: number) {
        if (stash) new Uint8Array(exports.memory.buffer, destination, stash.length).set(stash);
        stash = null;
      },
    },
  });
  exports = instance.exports as unknown as Exports;
  wasm = exports;
  const bytes = new Uint8Array(index);
  const at = exports.alloc(bytes.length);
  new Uint8Array(exports.memory.buffer, at, bytes.length).set(bytes);
  exports.init(at, bytes.length);
  exports.dealloc(at, bytes.length);
}

function run(command: string, args: unknown): { kind: "json" | "bytes"; data: ArrayBuffer | unknown } {
  const w = wasm!;
  const put = (bytes: Uint8Array) => { const at = w.alloc(bytes.length); new Uint8Array(w.memory.buffer, at, bytes.length).set(bytes); return at; };
  const name = new TextEncoder().encode(command), json = new TextEncoder().encode(JSON.stringify(args ?? null));
  const a = put(name), b = put(json);
  let status: number;
  try { status = w.call(a, name.length, b, json.length); } finally { w.dealloc(a, name.length); w.dealloc(b, json.length); }
  const out = new Uint8Array(w.memory.buffer, w.result_ptr(), w.result_len()).slice();
  if (status < 0) throw new Error(new TextDecoder().decode(out));
  if (status === 1) return { kind: "bytes", data: out.buffer };
  return { kind: "json", data: JSON.parse(new TextDecoder().decode(out)) };
}

self.onmessage = async (event: MessageEvent<{ id: number; command?: string; args?: unknown; init?: string }>) => {
  const { id, command, args, init } = event.data;
  try {
    if (init !== undefined) { ready ??= start(init); await ready; (self as unknown as Worker).postMessage({ id, kind: "json", data: true }); return; }
    await ready;
    const reply = run(command!, args);
    (self as unknown as Worker).postMessage({ id, ...reply }, reply.kind === "bytes" ? [reply.data as ArrayBuffer] : []);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
