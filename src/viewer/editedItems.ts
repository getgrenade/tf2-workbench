/**
 * Which items have an edited material (a VMT changed or a map replaced, see vmtEdits.ts and textureOverrides.ts), for the "!" on their
 * tiles. An item's materials are learned as it is worn (they come from its model) and kept between runs, so an item edited before shows
 * the mark in the browsers without being worn again.
 */

const KEY = "tf2workbench.itemMaterials";

export class EditedItems {
  /** The (lower-case) material paths of each item id. */
  private readonly materials = new Map<number, Set<string>>();
  private edited = new Set<string>();
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()) {
    try {
      const saved = JSON.parse(this.storage?.getItem(KEY) ?? "{}") as Record<string, string[]>;
      for (const [id, paths] of Object.entries(saved)) if (Array.isArray(paths)) this.materials.set(Number(id), new Set(paths));
    } catch { /* nothing learned yet */ }
  }

  onChange(fn: () => void) { this.listeners.push(fn); }
  private changed() { for (const fn of this.listeners) fn(); }

  /** Learns the materials of an item (as it is worn); kept when they are new. */
  learn(id: number, paths: Iterable<string>) {
    const next = new Set([...paths].map((p) => p.toLowerCase()));
    const had = this.materials.get(id);
    if (had && had.size === next.size && [...next].every((p) => had.has(p))) return;
    this.materials.set(id, next);
    try {
      this.storage?.setItem(KEY, JSON.stringify(Object.fromEntries([...this.materials].map(([k, v]) => [k, [...v]]))));
    } catch { /* not kept */ }
    this.changed();
  }

  /** The material paths that are edited now. */
  setEdited(paths: Iterable<string>) {
    const next = new Set([...paths].map((p) => p.toLowerCase()));
    if (next.size === this.edited.size && [...next].every((p) => this.edited.has(p))) return;
    this.edited = next;
    this.changed();
  }

  /** Whether an item wears an edited material. */
  has(id: number): boolean {
    const paths = this.materials.get(id);
    if (!paths) return false;
    for (const p of paths) if (this.edited.has(p)) return true;
    return false;
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** The one the browsers and the texture panel share. */
export const editedItems = new EditedItems();

/** The mark on a tile or an equipped card of an edited item. */
export const EDITED_TITLE = "Its VMT or a texture was edited (reset it in the Textures panel)";
