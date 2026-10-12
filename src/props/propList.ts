/**
 * The prop models of the installed game as a catalogue: what is in which folder, and what a search finds. No DOM and no game access here
 * (the browser panel feeds it the file list), so it can be tested.
 */

/** Where the game keeps props: a path under `models/` that contains one of these is a prop of the catalogue. */
export const PROP_ROOTS = ["props_", "props/", "egypt/", "mvm/", "props_gameplay/"];

export interface PropEntry {
  /** The model file: `models/props_c17/barrel001.mdl`. */
  path: string;
  /** What a scene entity calls it (the path below models/, no extension): `props_c17/barrel001`. */
  cls: string;
  /** The file's name without the extension (`barrel001`). */
  name: string;
  /** The folder below models/ (`props_c17`, `props_c17/furniture`). */
  folder: string;
  /** Lowercase `folder/name`, for searching. */
  key: string;
}

/** The catalogue of a file list: the `.mdl` files of the prop folders, by folder and then name. */
export function parsePropPaths(paths: readonly string[]): PropEntry[] {
  const out: PropEntry[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const path = raw.replace(/\\/g, "/");
    if (!/^models\/.+\.mdl$/i.test(path)) continue;
    const below = path.slice("models/".length, -".mdl".length);
    const lower = below.toLowerCase();
    if (!PROP_ROOTS.some((r) => lower.startsWith(r))) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    const at = below.lastIndexOf("/");
    const folder = at < 0 ? "" : below.slice(0, at);
    const name = below.slice(at + 1);
    out.push({ path, cls: below, name, folder, key: lower });
  }
  return out.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder.localeCompare(b.folder)));
}

export interface PropFolder {
  /** The whole path of the folder (`props_c17/furniture`), empty for the root. */
  path: string;
  /** Its own name (`furniture`). */
  name: string;
  /** How many levels down it is (the top folders are 0). */
  depth: number;
  /** The props in it and below it. */
  count: number;
}

/** The folders of a catalogue as a flat list in tree order (a folder, then what is in it), each with the number of props in it and below. */
export function propFolders(entries: readonly PropEntry[]): PropFolder[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const parts = e.folder ? e.folder.split("/") : [];
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([path, count]) => ({ path, name: path.slice(path.lastIndexOf("/") + 1), depth: path.split("/").length - 1, count }));
}

/**
 * The props of a folder (and its subfolders) whose name or folder holds every word of the search, in the catalogue's order. An empty
 * folder is every folder; words match anywhere in `folder/name`.
 */
export function filterProps(entries: readonly PropEntry[], query: string, folder = ""): PropEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const prefix = folder.toLowerCase();
  return entries.filter((e) => {
    if (prefix && e.folder.toLowerCase() !== prefix && !e.folder.toLowerCase().startsWith(`${prefix}/`)) return false;
    return words.every((w) => e.key.includes(w));
  });
}

/** What an entity of a prop is called in the lists: the model's own name, as the game spells it. */
export const propLabel = (cls: string) => cls.slice(cls.lastIndexOf("/") + 1);
