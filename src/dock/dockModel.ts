/**
 * The layout of the docks as data (no DOM, so it can be tested): which panels are in which dock, how they are grouped into tabs,
 * which are hidden. The dock UI draws it and turns what the user does (drag a tab, hide a panel) into the functions below.
 */

export type DockId = "left" | "right" | "bottom";
export const DOCKS: readonly DockId[] = ["left", "right", "bottom"];

/** A set of tabs that share one area; the active one is shown. */
export interface DockGroup {
  tabs: string[];
  active: string;
  /** How much of the dock the group takes next to the others (its share, not pixels). */
  weight: number;
}

export interface DockLayout {
  v: 1;
  docks: Record<DockId, { groups: DockGroup[]; /** Width of a side dock, height of the bottom one, in pixels. */ size?: number }>;
  /** Panels the user took away completely (they come back from the layout menu). */
  hidden: string[];
  /** The dock each panel was in last: where it comes back to. */
  lastDock: Record<string, DockId>;
  /** Docks that are folded away. */
  folded: DockId[];
}

/** Where a dragged panel goes. */
export type DropTarget =
  /** Into a group as a tab, at a position among its tabs. */
  | { kind: "tab"; dock: DockId; group: number; index: number }
  /** As a group of its own next to a group (before or after it). */
  | { kind: "split"; dock: DockId; group: number; after: boolean }
  /** As a group of its own at the end of a dock (an empty dock, or the empty space of one). */
  | { kind: "dock"; dock: DockId };

const clone = <T>(value: T): T => structuredClone(value);

export function emptyLayout(): DockLayout {
  return { v: 1, docks: { left: { groups: [] }, right: { groups: [] }, bottom: { groups: [] } }, hidden: [], lastDock: {}, folded: [] };
}

/** Where a panel is: its dock, group and place among the tabs (null when it is hidden). */
export function findPanel(layout: DockLayout, id: string): { dock: DockId; group: number; index: number } | null {
  for (const dock of DOCKS) {
    const groups = layout.docks[dock].groups;
    for (let group = 0; group < groups.length; group++) {
      const index = groups[group].tabs.indexOf(id);
      if (index >= 0) return { dock, group, index };
    }
  }
  return null;
}

/** Takes empty groups away and makes sure each group has an active tab that it holds. */
function tidy(layout: DockLayout) {
  for (const dock of DOCKS) {
    const d = layout.docks[dock];
    d.groups = d.groups.filter((g) => g.tabs.length > 0);
    for (const g of d.groups) {
      if (!g.tabs.includes(g.active)) g.active = g.tabs[0];
      if (!Number.isFinite(g.weight) || g.weight <= 0) g.weight = 1;
    }
  }
}

/** Takes a panel out of wherever it is (without tidying). */
function detach(layout: DockLayout, id: string) {
  const at = findPanel(layout, id);
  if (!at) return;
  const group = layout.docks[at.dock].groups[at.group];
  group.tabs.splice(at.index, 1);
  layout.lastDock[id] = at.dock;
}

/** The layout after a panel was dragged to a place. A panel dropped next to itself, or into its own group where it already is, stays. */
export function movePanel(layout: DockLayout, id: string, target: DropTarget): DockLayout {
  const next = clone(layout);
  const from = findPanel(next, id);
  if (from?.dock === target.dock && target.kind === "split" && next.docks[from.dock].groups[from.group].tabs.length === 1 && from.group === target.group) return next;
  // the group is found before the panel leaves, then by what it is (the numbers shift when a group empties)
  const targetGroup = target.kind === "dock" ? undefined : next.docks[target.dock].groups[target.group];
  const dockGroups = next.docks[target.dock].groups;
  detach(next, id);
  next.hidden = next.hidden.filter((h) => h !== id);
  if (target.kind === "dock") {
    dockGroups.push({ tabs: [id], active: id, weight: 1 });
  } else if (targetGroup) {
    if (target.kind === "tab") {
      // a tab dropped later in its own group: the places moved up by one when it left
      const own = from && next.docks[from.dock].groups[from.group] === targetGroup && from.index < target.index ? 1 : 0;
      const at = Math.max(0, Math.min(target.index - own, targetGroup.tabs.length));
      targetGroup.tabs.splice(at, 0, id);
      targetGroup.active = id;
    } else {
      const place = dockGroups.indexOf(targetGroup);
      dockGroups.splice(place + (target.after ? 1 : 0), 0, { tabs: [id], active: id, weight: targetGroup.weight || 1 });
    }
  }
  next.lastDock[id] = target.dock;
  tidy(next);
  return next;
}

/** Makes a tab the one its group shows. */
export function activatePanel(layout: DockLayout, id: string): DockLayout {
  const at = findPanel(layout, id);
  if (!at || layout.docks[at.dock].groups[at.group].active === id) return layout;
  const next = clone(layout);
  next.docks[at.dock].groups[at.group].active = id;
  return next;
}

/** Takes a panel away completely. */
export function hidePanel(layout: DockLayout, id: string): DockLayout {
  const next = clone(layout);
  detach(next, id);
  if (!next.hidden.includes(id)) next.hidden.push(id);
  tidy(next);
  return next;
}

/** Brings a hidden panel back: as a tab of the last group of the dock it was in last (a group of its own when the dock is empty). */
export function showPanel(layout: DockLayout, id: string, fallbackDock: DockId): DockLayout {
  if (findPanel(layout, id)) return layout;
  const next = clone(layout);
  next.hidden = next.hidden.filter((h) => h !== id);
  const dock = next.lastDock[id] ?? fallbackDock;
  const groups = next.docks[dock].groups;
  const last = groups[groups.length - 1];
  if (last) {
    last.tabs.push(id);
    last.active = id;
  } else groups.push({ tabs: [id], active: id, weight: 1 });
  next.lastDock[id] = dock;
  return next;
}

/** Sets how much of its dock each group takes (their shares). */
export function setWeights(layout: DockLayout, dock: DockId, weights: number[]): DockLayout {
  const next = clone(layout);
  next.docks[dock].groups.forEach((g, i) => { if (weights[i] > 0) g.weight = weights[i]; });
  return next;
}

export function setDockSize(layout: DockLayout, dock: DockId, size: number | undefined): DockLayout {
  const next = clone(layout);
  if (size === undefined) delete next.docks[dock].size;
  else next.docks[dock].size = Math.round(size);
  return next;
}

export function setFolded(layout: DockLayout, dock: DockId, folded: boolean): DockLayout {
  const next = clone(layout);
  next.folded = next.folded.filter((d) => d !== dock);
  if (folded) next.folded.push(dock);
  return next;
}

/**
 * Reads a saved layout and repairs it: panels that do not exist are dropped, a panel that is twice is kept once, and a panel the
 * layout does not mention goes where `defaults` has it (or into its own group of that dock). `ids` are the panels that exist.
 */
export function parseLayout(raw: unknown, ids: readonly string[], defaults: DockLayout): DockLayout {
  const known = new Set(ids);
  const out = emptyLayout();
  const r = raw as Partial<DockLayout> | null;
  if (!r || typeof r !== "object" || r.v !== 1 || !r.docks || typeof r.docks !== "object") return clone(defaults);
  const seen = new Set<string>();
  for (const dock of DOCKS) {
    const d = r.docks[dock];
    if (d && Array.isArray(d.groups)) {
      for (const g of d.groups) {
        if (!g || !Array.isArray(g.tabs)) continue;
        const tabs = g.tabs.filter((t): t is string => typeof t === "string" && known.has(t) && !seen.has(t) && !!seen.add(t));
        if (tabs.length) out.docks[dock].groups.push({ tabs, active: typeof g.active === "string" ? g.active : tabs[0], weight: typeof g.weight === "number" ? g.weight : 1 });
      }
    }
    if (d && typeof d.size === "number" && Number.isFinite(d.size) && d.size >= 120 && d.size <= 2000) out.docks[dock].size = Math.round(d.size);
  }
  if (Array.isArray(r.hidden)) for (const h of r.hidden) if (typeof h === "string" && known.has(h) && !seen.has(h)) { out.hidden.push(h); seen.add(h); }
  if (r.lastDock && typeof r.lastDock === "object") for (const [id, dock] of Object.entries(r.lastDock)) if (known.has(id) && (DOCKS as readonly string[]).includes(dock as string)) out.lastDock[id] = dock as DockId;
  if (Array.isArray(r.folded)) out.folded = r.folded.filter((d): d is DockId => (DOCKS as readonly string[]).includes(d as string));
  // a panel the saved layout does not know (one added since) goes to its default dock, and joins the tabs of a panel that it shares a group with there
  for (const id of ids) {
    if (seen.has(id)) continue;
    const home = findPanel(defaults, id);
    const dock = home?.dock ?? "right";
    const mate = home ? defaults.docks[home.dock].groups[home.group].tabs.find((t) => t !== id && seen.has(t)) : undefined;
    // (only when that panel is still in the dock the new one belongs to: one that was moved away does not take it along)
    const group = mate && home ? out.docks[home.dock].groups.find((g) => g.tabs.includes(mate)) : undefined;
    if (group) {
      group.tabs.push(id);
      out.lastDock[id] = dock;
      seen.add(id);
      continue;
    }
    out.docks[dock].groups.push({ tabs: [id], active: id, weight: 1 });
    out.lastDock[id] = dock;
  }
  tidy(out);
  return out;
}
