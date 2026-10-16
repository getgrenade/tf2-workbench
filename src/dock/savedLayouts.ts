/**
 * Layouts the user registered from the Layout menu: a name and the layout of the docks as it was (where the panels are, how they are grouped,
 * which were put away, the sizes). Kept in the browser's storage; the layout itself is read back by the dock model, which repairs it.
 */

const KEY = "tf2workbench.savedLayouts";

export interface SavedLayout {
  name: string;
  layout: unknown;
}

type Store = Pick<Storage, "getItem" | "setItem">;
const defaultStore = (): Store | null => { try { return localStorage; } catch { return null; } };

export function loadSavedLayouts(store: Store | null = defaultStore()): SavedLayout[] {
  try {
    const raw = JSON.parse(store?.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const out: SavedLayout[] = [];
    for (const item of raw) {
      if (!item || typeof item.name !== "string" || !item.name.trim() || !item.layout || typeof item.layout !== "object") continue;
      if (out.some((s) => s.name.toLowerCase() === item.name.trim().toLowerCase())) continue;
      out.push({ name: item.name.trim(), layout: item.layout });
    }
    return out;
  } catch {
    return [];
  }
}

function write(list: SavedLayout[], store: Store | null) {
  try { store?.setItem(KEY, JSON.stringify(list)); } catch { /* not remembered */ }
}

/** The name as it is kept: trimmed, and not longer than a menu can show. */
export const layoutName = (raw: string) => raw.trim().replace(/\s+/g, " ").slice(0, 40);

/** Whether a layout of this name is registered (names do not differ by case). */
export function hasSavedLayout(name: string, store: Store | null = defaultStore()): boolean {
  const n = layoutName(name).toLowerCase();
  return loadSavedLayouts(store).some((s) => s.name.toLowerCase() === n);
}

/** Registers a layout under a name, replacing the one of that name. Returns the list. */
export function registerLayout(name: string, layout: unknown, store: Store | null = defaultStore()): SavedLayout[] {
  const clean = layoutName(name);
  const list = loadSavedLayouts(store);
  if (!clean) return list;
  const entry = { name: clean, layout: JSON.parse(JSON.stringify(layout)) as unknown };
  const at = list.findIndex((s) => s.name.toLowerCase() === clean.toLowerCase());
  if (at >= 0) list[at] = entry; else list.push(entry);
  write(list, store);
  return list;
}

/** Deletes the layout of a name. Returns the list. */
export function deleteSavedLayout(name: string, store: Store | null = defaultStore()): SavedLayout[] {
  const n = name.trim().toLowerCase();
  const list = loadSavedLayouts(store).filter((s) => s.name.toLowerCase() !== n);
  write(list, store);
  return list;
}
