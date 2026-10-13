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
  /** The game whose archives hold it (`tf2`, `hl2`); empty when that is not known. */
  game: string;
}

/** A file the catalogue is made of: its path, and the game it comes from when that is known. */
export type PropFile = string | { path: string; game?: string };

/** The catalogue of a file list: the `.mdl` files of the prop folders, by folder and then name. */
export function parsePropPaths(files: readonly PropFile[]): PropEntry[] {
  const out: PropEntry[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const raw = typeof file === "string" ? file : file.path;
    const game = typeof file === "string" ? "" : file.game ?? "";
    const path = raw.replace(/\\/g, "/");
    if (!/^models\/.+\.mdl$/i.test(path)) continue;
    const below = path.slice("models/".length, -".mdl".length);
    const lower = below.toLowerCase();
    // the game's props are those of its prop folders; whatever is in a folder the user mounted is a prop, if it is in a folder of its own
    // (a model straight in models/ would be taken for a class)
    const custom = game.startsWith("custom:");
    if (custom ? !below.includes("/") : !PROP_ROOTS.some((r) => lower.startsWith(r))) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    const at = below.lastIndexOf("/");
    const folder = at < 0 ? "" : below.slice(0, at);
    const name = below.slice(at + 1);
    out.push({ path, cls: below, name, folder, key: lower, game });
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
export function filterProps(entries: readonly PropEntry[], query: string, folder = "", game = ""): PropEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const prefix = folder.toLowerCase();
  return entries.filter((e) => {
    if (game && e.game !== game) return false;
    if (prefix && e.folder.toLowerCase() !== prefix && !e.folder.toLowerCase().startsWith(`${prefix}/`)) return false;
    return words.every((w) => e.key.includes(w));
  });
}

/** What the games of the archives are called. */
const GAME_NAMES: Record<string, string> = { tf2: "Team Fortress 2", hl2: "Half-Life 2", hl1: "Half-Life", ep1: "Half-Life 2: Episode 1", ep2: "Half-Life 2: Episode 2", portal: "Portal" };
export const gameLabel = (game: string) => (game.startsWith("custom:") ? `Custom: ${game.slice(7)}` : GAME_NAMES[game] ?? (game ? game.toUpperCase() : "Other"));

/** Whether props are of a folder the user mounted (not of a game). */
export const isCustomGame = (game: string) => game.startsWith("custom:");

/** The games the props come from, the game folder's own first, each with how many of them there are. */
export function propGames(entries: readonly PropEntry[]): { id: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.game, (counts.get(e.game) ?? 0) + 1);
  return [...counts]
    // the game folder's own first, the games, then the folders the user mounted
    .sort((a, b) => (a[0] === "tf2" ? -1 : b[0] === "tf2" ? 1 : Number(isCustomGame(a[0])) - Number(isCustomGame(b[0])) || a[0].localeCompare(b[0])))
    .map(([id, count]) => ({ id, label: gameLabel(id), count }));
}

/** What an entity of a prop is called in the lists: the model's own name, as the game spells it. */
export const propLabel = (cls: string) => cls.slice(cls.lastIndexOf("/") + 1);
