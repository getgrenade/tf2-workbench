/**
 * The texture and VMT edits of the Textures panel, kept between runs: the image file each replaced map came from (read again at the next
 * start) and the text of each edited VMT. They are put back on a material as it is loaded, before it is first drawn.
 */
export interface SavedMaterialEdits {
  textures: { path: string; slot: string; file: string }[];
  vmts: { path: string; text: string }[];
}

const KEY = "tf2workbench.materialEdits";

export function loadMaterialEdits(storage: Pick<Storage, "getItem"> | null = safeStorage()): SavedMaterialEdits {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "null") as Partial<SavedMaterialEdits> | null;
    const textures = Array.isArray(raw?.textures) ? raw!.textures.filter((t) => t && typeof t.path === "string" && typeof t.slot === "string" && typeof t.file === "string") : [];
    const vmts = Array.isArray(raw?.vmts) ? raw!.vmts.filter((v) => v && typeof v.path === "string" && typeof v.text === "string") : [];
    return { textures, vmts };
  } catch {
    return { textures: [], vmts: [] };
  }
}

export function saveMaterialEdits(edits: SavedMaterialEdits, storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()) {
  try {
    if (!edits.textures.length && !edits.vmts.length) storage?.removeItem(KEY);
    else storage?.setItem(KEY, JSON.stringify(edits));
  } catch { /* not remembered */ }
}

/** The saved edits of one material (paths compare without case). */
export function editsFor(edits: SavedMaterialEdits, path: string): { vmt: string | null; textures: { slot: string; file: string }[] } {
  const want = path.toLowerCase();
  return {
    vmt: edits.vmts.find((v) => v.path.toLowerCase() === want)?.text ?? null,
    textures: edits.textures.filter((t) => t.path.toLowerCase() === want).map(({ slot, file }) => ({ slot, file })),
  };
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
