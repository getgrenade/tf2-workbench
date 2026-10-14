import { exportBlendRig } from "../api";
import { parseRig, type RigData } from "./rigData";

/**
 * The rigs the user has added in Settings (desktop): .blend files of rigs for the game's skeleton. A rig replaces the built-in controls for the
 * characters of its class while posing. The files are read with Blender (the user's own copy) and the result is kept by the app.
 */

export interface RigEntry {
  id: string;
  path: string;
  /** The class it is for (`heavy`), or `all`. */
  cls: string;
}

export const RIG_CLASSES = ["scout", "soldier", "pyro", "demoman", "heavy", "engineer", "medic", "sniper", "spy"] as const;

const KEY_RIGS = "tf2workbench.blenderRigs";
const KEY_EXE = "tf2workbench.blenderExe";

let entries: RigEntry[] = [];
try { const raw = JSON.parse(localStorage.getItem(KEY_RIGS) ?? "[]"); if (Array.isArray(raw)) entries = raw.filter((e) => e && typeof e.path === "string" && typeof e.cls === "string" && typeof e.id === "string"); } catch { /* none yet */ }
let exe = "";
try { exe = localStorage.getItem(KEY_EXE) ?? ""; } catch { /* default */ }
const listeners: (() => void)[] = [];

const save = () => {
  try { localStorage.setItem(KEY_RIGS, JSON.stringify(entries)); } catch { /* not kept */ }
  for (const fn of listeners) fn();
};

export const onRigsChange = (fn: () => void) => { listeners.push(fn); return () => { listeners.splice(listeners.indexOf(fn), 1); }; };
export const rigEntries = (): RigEntry[] => entries.slice();
export const blenderExe = () => exe;
export function setBlenderExe(path: string) {
  exe = path.trim();
  try { localStorage.setItem(KEY_EXE, exe); } catch { /* not kept */ }
  loads.clear();
  errors.clear();
  for (const fn of listeners) fn();
}

/** The class a rig file is for, from its name ("Heavy_V4.blend" -> heavy; "AllClass" or no class in the name -> all). */
export function guessClass(path: string): string {
  const name = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (/all[-_ ]?class|allclass/.test(name)) return "all";
  return RIG_CLASSES.find((c) => name.includes(c)) ?? (name.includes("demo") ? "demoman" : name.includes("engi") ? "engineer" : "all");
}

export function addRig(path: string): RigEntry {
  const existing = entries.find((e) => e.path.toLowerCase() === path.toLowerCase());
  if (existing) return existing;
  const entry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, path, cls: guessClass(path) };
  entries.push(entry);
  save();
  return entry;
}

export function removeRig(id: string) {
  entries = entries.filter((e) => e.id !== id);
  save();
}

export function setRigClass(id: string, cls: string) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  e.cls = cls;
  save();
}

/** The rig for a character of a class: one made for the class, else one for all. */
export function rigFor(cls: string): RigEntry | null {
  const c = cls.toLowerCase();
  return entries.find((e) => e.cls === c) ?? entries.find((e) => e.cls === "all") ?? null;
}

const loads = new Map<string, Promise<RigData>>();
const errors = new Map<string, string>();

/** The error of the last try to read a rig (empty when it read). */
export const rigError = (id: string): string => errors.get(id) ?? "";

/** Reads a rig (with Blender, once per file and version of it). */
export function loadRig(entry: RigEntry): Promise<RigData> {
  const key = `${entry.path}|${exe}`;
  let p = loads.get(key);
  if (!p) {
    errors.delete(entry.id);
    p = exportBlendRig(entry.path, exe).then(parseRig).catch((e) => {
      errors.set(entry.id, String(e));
      loads.delete(key);
      throw e;
    });
    loads.set(key, p);
  }
  return p;
}

/** Forgets what was read (the file changed, or Blender was changed): it is read again next time. */
export function reloadRig(entry: RigEntry) {
  loads.delete(`${entry.path}|${exe}`);
  errors.delete(entry.id);
}
