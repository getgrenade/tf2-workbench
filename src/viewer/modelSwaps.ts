/**
 * Cosmetic models swapped for one of the user's own (the Textures panel's Model row): a compiled .mdl, or a source model (.smd, .dmx,
 * .fbx) fitted to the wearer's skeleton as the compiler's preview is. Nothing of the game is changed; the swap only changes what the
 * viewer draws for that model path, and is kept between runs (the file is read again at the next start) until it is reset.
 */
import type { ModelData } from "./payload";

/** The files a model can be swapped for. */
export const SWAP_EXTENSIONS = ["mdl", "smd", "dmx", "fbx"];

export interface SavedModelSwap {
  /** The game's model path that is drawn as the file instead. */
  path: string;
  /** The file on disk, as it was picked. */
  file: string;
}

const KEY = "tf2workbench.modelSwaps";

export function loadModelSwaps(storage: Pick<Storage, "getItem"> | null = safeStorage()): SavedModelSwap[] {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "null") as unknown;
    return Array.isArray(raw) ? raw.filter((s): s is SavedModelSwap => !!s && typeof s.path === "string" && typeof s.file === "string") : [];
  } catch {
    return [];
  }
}

export function saveModelSwaps(swaps: SavedModelSwap[], storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()) {
  try {
    if (!swaps.length) storage?.removeItem(KEY);
    else storage?.setItem(KEY, JSON.stringify(swaps));
  } catch { /* not remembered */ }
}

/** Whether a picked file is a compiled model (read by the backend) rather than a source model (read here). */
export const isCompiledModel = (file: string) => /\.mdl$/i.test(file);

const stem = (p: string) => p.replace(/\\/g, "/").split("/").pop()!.replace(/\.vmt$/i, "").toLowerCase();

/**
 * The materials a source model's material is drawn with, RED then BLU: the swapped model's own, so the swap wears the cosmetic's
 * textures and paint. A material named like one of the original's (its file name) takes that one; any other takes the original's first.
 */
export function swapMaterials(original: ModelData, material: string): [string, string] {
  const meshes = original.bodyParts.flatMap((bp) => bp.models[0]?.meshes ?? []).filter((m) => m.indices.length);
  const want = stem(material);
  const mesh = meshes.find((m) => [m.material, ...m.materials].some((p) => stem(p) === want)) ?? meshes[0];
  if (!mesh) return [material, material];
  const red = mesh.materials[0] ?? mesh.material;
  return [red, mesh.materials[1] ?? red];
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
