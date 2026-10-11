/** The data and the flattening of the outliner tree (no DOM, so it can be tested). */

export interface HierarchyGroup {
  id: string;
  name: string;
  /** The folder this one sits in (absent: the top level). */
  parent?: string;
  /** Hides every character in the folder, and in the folders inside it (and turns its lights off). */
  hidden?: boolean;
}

export type NodeKind = "character" | "light" | "camera";

/** One thing in the tree: a character, a light or a camera. */
export interface TreeNode {
  /** "kind:id", unique in the scene. */
  key: string;
  kind: NodeKind;
  id: string;
  label: string;
  /** Other text a search looks in (the class, the kind of light ...). */
  keywords: string;
  /** The folder it is in. */
  group?: string;
  /** Hidden (a character) or off (a light): drawn dimmed. */
  off: boolean;
}

export type TreeItem =
  | { kind: "group"; group: HierarchyGroup; depth: number; count: number; expanded: boolean; dimmed: boolean }
  | { kind: "node"; node: TreeNode; depth: number; dimmed: boolean };

/** True when `candidate` is `id` itself or sits inside it (a folder cannot be put into itself or into what it holds). */
export function isInside(groups: readonly HierarchyGroup[], candidate: string | undefined, id: string): boolean {
  const seen = new Set<string>();
  while (candidate && !seen.has(candidate)) {
    if (candidate === id) return true;
    seen.add(candidate);
    candidate = groups.find((g) => g.id === candidate)?.parent;
  }
  return false;
}

/** The folder a thing is really in: absent when its folder is gone. */
export function groupOf(groups: readonly HierarchyGroup[], e: { group?: string }): string | undefined {
  return e.group && groups.some((g) => g.id === e.group) ? e.group : undefined;
}

/** True when the folder, or any folder around it, is hidden. */
export function groupHidden(groups: readonly HierarchyGroup[], id: string | undefined): boolean {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const g = groups.find((x) => x.id === id);
    if (!g) return false;
    if (g.hidden) return true;
    id = g.parent;
  }
  return false;
}

/** True when the thing is hidden itself or by a folder around it. */
export function entityHidden(groups: readonly HierarchyGroup[], e: { group?: string; hidden: boolean }): boolean {
  return e.hidden || groupHidden(groups, groupOf(groups, e));
}

/** The folder and the folders inside it (and inside those). */
export function withDescendants(groups: readonly HierarchyGroup[], id: string): Set<string> {
  const out = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups) if (g.parent && out.has(g.parent) && !out.has(g.id)) { out.add(g.id); grew = true; }
  }
  return out;
}

/**
 * The rows of the tree in the order they are drawn: the folders first (each with what is inside it: its folders, then its
 * things in the order of `nodes`), then the things that are in no folder. A search keeps the folders that match or hold a
 * match, and opens them; a folder whose name matches shows everything in it.
 */
export function flatten(groups: readonly HierarchyGroup[], nodes: readonly TreeNode[], collapsed: ReadonlySet<string>, query: string): TreeItem[] {
  const q = query.trim().toLowerCase();
  const matches = (n: TreeNode) => !q || n.label.toLowerCase().includes(q) || n.keywords.toLowerCase().includes(q);
  const out: TreeItem[] = [];
  const members = (group: string | undefined) => nodes.filter((n) => groupOf(groups, n) === group);
  const kids = (parent: string | undefined) => groups.filter((g) => (g.parent && groups.some((p) => p.id === g.parent) ? g.parent : undefined) === parent);
  const total = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return members(id).length + kids(id).reduce((n, g) => n + total(g.id, seen), 0);
  };
  const draw = (g: HierarchyGroup, depth: number, seen: Set<string>, all: boolean): TreeItem[] | null => {
    if (seen.has(g.id)) return null;
    seen.add(g.id);
    const named = all || (!!q && g.name.toLowerCase().includes(q));
    const inner: TreeItem[] = [];
    for (const child of kids(g.id)) {
      const rows = draw(child, depth + 1, seen, named);
      if (rows) inner.push(...rows);
    }
    const mine = members(g.id).filter(matches);
    if (q && !named && !mine.length && !inner.length) return null;
    const expanded = !!q || !collapsed.has(g.id);
    const rows: TreeItem[] = [{ kind: "group", group: g, depth, count: total(g.id), expanded, dimmed: groupHidden(groups, g.id) }];
    if (expanded) {
      rows.push(...inner);
      for (const n of named ? members(g.id) : mine) rows.push({ kind: "node", node: n, depth: depth + 1, dimmed: n.off || groupHidden(groups, g.id) });
    }
    return rows;
  };
  const seen = new Set<string>();
  for (const g of kids(undefined)) {
    const rows = draw(g, 0, seen, false);
    if (rows) out.push(...rows);
  }
  for (const n of members(undefined).filter(matches)) out.push({ kind: "node", node: n, depth: 0, dimmed: n.off });
  return out;
}

/** A name for a new folder that no other folder has ("Folder", "Folder 2", ...). */
export function newGroupName(groups: readonly HierarchyGroup[]): string {
  const taken = new Set(groups.map((g) => g.name));
  if (!taken.has("Folder")) return "Folder";
  for (let n = 2; ; n++) if (!taken.has(`Folder ${n}`)) return `Folder ${n}`;
}

/** Reads the folders of a saved scene; anything that is not a folder is dropped. */
export function parseGroups(raw: unknown): HierarchyGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: HierarchyGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g.id !== "string" || typeof g.name !== "string" || out.some((x) => x.id === g.id)) continue;
    out.push({ id: g.id, name: g.name.slice(0, 80), ...(typeof g.parent === "string" ? { parent: g.parent } : {}), ...(g.hidden === true ? { hidden: true } : {}) });
  }
  // a parent that is not in the list, or a loop, puts the folder at the top level
  return out.map((g) => (g.parent && (!out.some((p) => p.id === g.parent) || isInside(out, g.parent, g.id)) ? { id: g.id, name: g.name, ...(g.hidden ? { hidden: true } : {}) } : g));
}
