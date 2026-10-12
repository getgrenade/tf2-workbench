/**
 * The web build's stand-in for `@tauri-apps/api/core` (vite swaps the module): `invoke` answers the desktop commands in the page. The game's
 * data comes from the app's own backend running as WebAssembly in a worker (backend.worker.ts) over the files baked into the site; what the
 * desktop keeps in its config folder (settings, the session, poses, light setups) lives in the browser's storage; files the user picks or
 * saves are uploads and downloads (see dialog.ts).
 */
import { downloadBlob, readUpload } from "./dialog";
import { resetEngine, startEngine, stepEngine, stopEngine } from "../viewer/particles/sdk/engine";

type Pending = { resolve: (v: { kind: "json" | "bytes"; data: unknown }) => void; reject: (e: Error) => void };

const BASE = new URL(import.meta.env.BASE_URL, window.location.href).href;
/** The backend runs in several workers: each fetches one file at a time (a synchronous request), so a page that asks for many files at once
 *  would otherwise wait for them one after the other. */
const POOL = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
const workers: Worker[] = [];
const busy: number[] = [];
let ready: Promise<unknown> | null = null;
let nextId = 1;
const pending = new Map<number, Pending & { worker: number }>();

function spawn(index: number): Worker {
  const worker = new Worker(new URL("./backend.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; kind?: "json" | "bytes"; data?: unknown; error?: string; missing?: string }>) => {
    if (e.data.missing) { ((window as unknown as { __missingGameFiles?: Set<string> }).__missingGameFiles ??= new Set()).add(e.data.missing); return; }
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    busy[p.worker]--;
    if (e.data.error !== undefined) p.reject(new Error(e.data.error)); else p.resolve({ kind: e.data.kind!, data: e.data.data });
  };
  worker.onerror = (e) => console.error("backend worker", index, e.message);
  return worker;
}

function backend(): Promise<unknown> {
  if (!workers.length) {
    for (let i = 0; i < POOL; i++) { workers.push(spawn(i)); busy.push(0); }
    ready = Promise.all(workers.map((_, i) => send(i, { init: BASE })));
  }
  return ready!;
}

/** Commands whose answer builds on what the same worker already holds for a model (its parsed files): they stay with one worker per model. */
const BY_MODEL = new Set(["eval_poses", "bake_sequence", "list_sequences", "model_physics"]);

/** The worker for a command: the model's own one for the commands above, otherwise the one with the fewest requests waiting. */
function pick(command: string | undefined, args: unknown): number {
  if (command && BY_MODEL.has(command)) {
    const path = String((args as { path?: unknown } | null)?.path ?? "");
    let h = 0;
    for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
    return h % workers.length;
  }
  let best = 0;
  for (let i = 1; i < workers.length; i++) if (busy[i] < busy[best]) best = i;
  return best;
}

function send(worker: number, message: { command?: string; args?: unknown; init?: string }): Promise<{ kind: "json" | "bytes"; data: unknown }> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, worker });
    busy[worker]++;
    workers[worker].postMessage({ id, ...message });
  });
}

/** Commands the backend answers from the game's files. */
const FROM_GAME = new Set([
  "load_model", "load_material", "load_texture_frames", "load_particle_asset", "load_overlay_font", "list_sequences", "bake_sequence",
  "eval_poses", "get_weapon_profile", "player_gibs", "model_physics", "search_paths",
]);

const statics = new Map<string, Promise<unknown>>();
/** Answers that were made when the site was built (the lists) are plain files. */
function staticFile(name: string, kind: "json" | "bytes"): Promise<unknown> {
  let hit = statics.get(name);
  if (!hit) {
    hit = fetch(`${BASE}${name}`).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return kind === "json" ? r.json() : r.arrayBuffer(); });
    statics.set(name, hit);
    hit.catch(() => statics.delete(name));
  }
  return hit;
}

// --- what the desktop keeps in its config folder --------------------------------------------------------------------------------------
const store = {
  get(key: string): string | null { try { return localStorage.getItem(`tf2workbench.${key}`); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(`tf2workbench.${key}`, value); } catch (e) { throw new Error(`The browser would not keep it: ${String(e)}`); } },
  remove(key: string) { try { localStorage.removeItem(`tf2workbench.${key}`); } catch { /* nothing to remove */ } },
};

interface Saved { name: string; text: string; at: number }
const readSaved = (key: string): Saved[] => { try { return JSON.parse(store.get(key) ?? "[]") as Saved[]; } catch { return []; } };
const newestFirst = (list: Saved[]) => [...list].sort((a, b) => b.at - a.at);
function putSaved(key: string, name: string, text: string) {
  const list = readSaved(key).filter((s) => s.name !== name);
  list.push({ name, text, at: Date.now() });
  store.set(key, JSON.stringify(list));
}

/** What the particle engine reads (the PCF of an effect, its materials and textures) comes from the same backend as everything else. */
const particleFiles = { load: (path: string) => invoke<ArrayBuffer>("load_particle_asset", { path }) };

const unavailable = (what: string) => Promise.reject(new Error(`${what} is not available in the web version`));

type Args = Record<string, unknown>;

export async function invoke<T>(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<T> {
  const a = (args ?? {}) as Args;
  if (FROM_GAME.has(command)) {
    await backend();
    const reply = await send(pick(command, a), { command, args: a });
    return reply.data as T;
  }
  switch (command) {
    case "find_tf2": return "the web build" as T;
    case "index_tf2": return { tfDir: "the web build", totalFiles: 0, totalBytes: 0, millis: 0, archives: [] } as T;
    case "list_items": return (await staticFile("static-list_items.bin", "bytes")) as T;
    case "list_unusual_effects": return (await staticFile("static-list_unusual_effects.json", "json")) as T;
    case "particle_system_file": {
      const files = (await staticFile("static-particle_files.json", "json")) as Record<string, string>;
      const system = String(a.system);
      const hit = files[system] ?? Object.entries(files).find(([name]) => name.toLowerCase() === system.toLowerCase())?.[1];
      if (!hit) throw new Error(`Particle system not installed: ${system}`);
      return hit as T;
    }
    // settings, the session, poses and light setups: the browser's storage
    case "get_settings": try { return JSON.parse(store.get("settings") ?? "{}") as T; } catch { return {} as T; }
    case "set_settings": store.set("settings", JSON.stringify(a.settings)); return undefined as T;
    case "load_session": return store.get("session") as T;
    case "save_session": store.set("session", String(a.contents)); return undefined as T;
    case "list_poses": return newestFirst(readSaved("poses")).map((s) => s.name) as T;
    case "read_poses": return newestFirst(readSaved("poses")).map((s) => [s.name, s.text]) as T;
    case "save_pose": putSaved("poses", String(a.name), String(a.contents)); return undefined as T;
    case "load_pose": { const hit = readSaved("poses").find((s) => s.name === a.name); if (!hit) throw new Error("no such pose"); return hit.text as T; }
    case "delete_pose": store.set("poses", JSON.stringify(readSaved("poses").filter((s) => s.name !== a.name))); return undefined as T;
    case "open_poses_folder": return "this browser's storage" as T;
    case "read_light_setups": return newestFirst(readSaved("lightSetups")).map((s) => [s.name, s.text]) as T;
    case "save_light_setup": putSaved("lightSetups", String(a.name), String(a.contents)); return undefined as T;
    case "delete_light_setup": store.set("lightSetups", JSON.stringify(readSaved("lightSetups").filter((s) => s.name !== a.name))); return undefined as T;
    case "open_light_setups_folder": return "this browser's storage" as T;
    // files the user picked or saves
    case "read_text_file": return (await readUpload(String(a.path)).text()) as T;
    case "write_text_file": downloadBlob(String(a.path), new Blob([String(a.contents)], { type: "application/json" })); return undefined as T;
    case "write_binary_file": {
      const name = decodeURIComponent(options?.headers?.path ?? "");
      downloadBlob(name, new Blob([args as BlobPart]));
      return undefined as T;
    }
    case "workshop_stamp": return "0" as T;
    case "refresh_workshop": return undefined as T;
    case "list_custom_effects": return [] as T;
    case "clear_taunt_cache": return { removed: 0, deferred: 0, bytes: 0 } as T;
    case "taunt_cache_path": return "" as T;
    // the particles: Valve's simulation, ported (the desktop build asks its native helper)
    case "native_particle_reset": return resetEngine() as T;
    case "native_particle_start":
      return (await startEngine(particleFiles, a.cp as number[], a.generation as number, String(a.file), String(a.system), (a.boxes as number[][]) ?? [], Number(a.refire ?? 0), Number(a.slots ?? 1))) as T;
    case "native_particle_step": {
      const floor = a.floor === null || a.floor === undefined ? null : Number(a.floor);
      return stepEngine(a.handle as number, a.ticks as number, a.cp as number[], (a.boxes as number[][]) ?? [], Number(a.action ?? 0), (a.flame as number[]) ?? [], (a.colors as number[]) ?? [],
        (a.instances as number[][]) ?? [], (a.target as number[]) ?? [], floor) as T;
    }
    case "native_particle_stop": stopEngine(a.handle as number); return undefined as T;
    case "play_mouse_stop": return undefined as T;
    default: return unavailable(command.replace(/_/g, " ")) as Promise<T>;
  }
}
