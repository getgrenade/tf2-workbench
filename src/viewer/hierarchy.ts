import { showContextMenu } from "./contextMenu";
import { hotkeyMatches } from "../hotkeys";
import { flatten, isInside, withDescendants, type HierarchyGroup, type NodeKind, type TreeItem, type TreeNode } from "./hierarchyTree";

/** One thing of the outliner: a character, a light or a camera (a character's id is its number as text). */
export interface Pick {
  kind: NodeKind;
  id: string;
}

/** What the outliner shows for one character, light or camera. */
export interface OutlinerNode extends Pick {
  label: string;
  /** Dim text after the name (a light's kind, a camera's ratio). Characters show their team instead. */
  sub?: string;
  /** Other text a search looks in. */
  keywords: string;
  /** The folder it is in. */
  group?: string;
  /** One of the selected things (any mix of kinds can be selected). */
  selected: boolean;
  /** A hidden character or a light that is off (it is drawn dimmed, and its eye is shut). */
  off: boolean;
  removable: boolean;
  /** Characters: team (0 RED, 1 BLU), class picture, whether the fog covers it, whether it has particles to reset. */
  team?: number;
  icon?: string;
  fogged?: boolean;
  canClearParticles?: boolean;
  /** Cameras: the view is through it. */
  viewing?: boolean;
}

export interface HierarchyHooks {
  /** The selection is these things; `primary` is the one the properties show. */
  select: (picks: Pick[], primary: Pick) => void;
  /** A name (for a character an empty one goes back to the class name). */
  rename: (pick: Pick, name: string) => void;
  /** Hides characters / turns lights off, or the opposite (cameras have nothing to hide). */
  setOff: (picks: Pick[], off: boolean) => void;
  toggleFog: (id: number) => void;
  clearParticles: (id: number) => void;
  /** Looks through a camera, or leaves its view. */
  lookThrough: (id: string) => void;
  remove: (picks: Pick[]) => void;
  /** Puts these things on the clipboard (Ctrl + C). */
  copy: (picks: Pick[]) => void;
  /** Adds copies of what is on the clipboard (Ctrl + V); false when there is nothing to paste. */
  paste: () => void;
  canPaste: () => boolean;
  frame: (id: number) => void;
  /** Puts things in a folder (undefined: no folder); characters can also be put right before / after another character. */
  move: (picks: Pick[], group: string | undefined, anchor?: { id: number; after: boolean }) => void;
  /** Makes a folder (inside `parent`) and returns its id. */
  newGroup: (parent?: string) => string;
  renameGroup: (id: string, name: string) => void;
  toggleGroupHidden: (id: string) => void;
  /** Takes the folder away: what is in it goes up one level, or with `withContents` is removed too. */
  removeGroup: (id: string, withContents?: boolean) => void;
  /** Puts a folder in another (undefined: the top level), and when `before` is given right before that folder. */
  nestGroup: (id: string, parent: string | undefined, before?: string) => void;
}

const ICONS = {
  folder: "M2 5h5l2-2h7v12H2z M2 7h14",
  eye: "M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z M11.500 9a2.500 2.500 0 1 0-5 0 2.500 2.500 0 1 0 5 0",
  hidden: "M2 2l14 14 M1 9s3-5 8-5c5 0 8 5 8 5s-3 5-8 5-8-5-8-5z",
  plus: "M9 3v12 M3 9h12",
  fog: "M2 5h10M5 8h11M2 11h9M13 11h3",
  reset: "M3 8a5 5 0 1 1 0 5M3 3v5h5",
  cross: "M4 4l10 10 M14 4L4 14",
  search: "M12 7a5 5 0 1 0-10 0 5 5 0 1 0 10 0 M11 11l5 5",
  bulb: "M9 2a4.500 4.500 0 0 0-2.500 8.200V12h5v-1.800A4.500 4.500 0 0 0 9 2z M7 14.500h4 M7.800 16.500h2.400",
  camera: "M2 5.500h3l1.200-2h5.600l1.200 2h3v9H2z M9 12.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z",
  viewfinder: "M2 6V2h4 M12 2h4v4 M16 12v4h-4 M6 16H2v-4 M9 7.500a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3z",
};
const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

/** What a drag carries: the things (a list of picks), or a folder; and a tag when all the things are characters (only they can be put in order). */
const ITEMS_MIME = "application/x-workbench-items";
const GROUP_MIME = "application/x-workbench-group";
const CHARACTERS_MIME = "application/x-workbench-characters";

const keyOf = (p: Pick) => `${p.kind}:${p.id}`;
const pickOf = (n: Pick): Pick => ({ kind: n.kind, id: n.id });

/**
 * The scene as one tree: folders (which can hold folders) and, in them or outside, characters, lights and cameras. Any mix of
 * them can be selected (click, Ctrl + click, Shift + click), dragged into folders, renamed in place and hidden with an eye.
 * It only shows what `render` is given and reports what the user does through the hooks.
 */
export function createHierarchy(host: HTMLElement, hooks: HierarchyHooks) {
  host.classList.add("hier");
  // the Add button of the outliner sits in the markup of the host and goes in the bar next to the search
  const adopted = host.querySelector<HTMLElement>("[data-hier-bar]");
  host.innerHTML = `<div class="hierBar"><div class="hierSearch">${icon("search")}<input type="search" placeholder="Search outliner…" aria-label="Search outliner" spellcheck="false"></div></div><div class="hierTree" role="tree" aria-label="Outliner" tabindex="0"></div><div class="hierFoot"></div>`;
  if (adopted) host.querySelector(".hierBar")!.append(adopted);
  const search = host.querySelector<HTMLInputElement>("input")!;
  const tree = host.querySelector<HTMLElement>(".hierTree")!;
  const foot = host.querySelector<HTMLElement>(".hierFoot")!;
  // right-click on empty space: paste what was copied
  tree.addEventListener("contextmenu", (e) => {
    if ((e.target as HTMLElement).closest(".hierRow")) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [{ label: "Paste", run: () => hooks.paste(), disabled: !hooks.canPaste() }]);
  });

  let groups: HierarchyGroup[] = [];
  let nodes: OutlinerNode[] = [];
  const byKey = new Map<string, OutlinerNode>();
  /** The thing the properties show. */
  let primary: Pick | null = null;
  /** The folder that new characters, lights and cameras go into. */
  let active: string | undefined;
  const collapsed = new Set<string>();
  let renaming = false;
  let lastSignature = "";
  /** The things drawn, in order (what a Shift + click range runs over). */
  let visible: Pick[] = [];
  /** The thing the last plain or Ctrl click was on (where a Shift click's range starts). */
  let anchor: string | null = null;

  // --- selection ------------------------------------------------------------------------------------------------

  /** Everything selected, in the order of the list (also what is hidden in a closed folder). */
  const selectedPicks = (): Pick[] => nodes.filter((n) => n.selected).map(pickOf);
  /** What an action on a row applies to: all the selected things when the row is one of them. */
  const targets = (n: OutlinerNode): Pick[] => (n.selected ? selectedPicks() : [pickOf(n)]);

  /** The drawn things from one to the other, both included (null when one is not drawn). */
  function rangeBetween(from: string, to: string): Pick[] | null {
    const a = visible.findIndex((p) => keyOf(p) === from);
    const b = visible.findIndex((p) => keyOf(p) === to);
    return a < 0 || b < 0 ? null : visible.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  /** Plain click: this alone. Ctrl: add or take away. Shift: from the last click to here (with Ctrl: added to what is selected). */
  function click(e: MouseEvent, pick: Pick) {
    const key = keyOf(pick);
    const current = selectedPicks();
    const range = e.shiftKey && anchor ? rangeBetween(anchor, key) : null;
    if (range) {
      const merged = e.ctrlKey || e.metaKey ? [...current, ...range.filter((p) => !current.some((c) => keyOf(c) === keyOf(p)))] : range;
      hooks.select(merged, pick);
      return;
    }
    anchor = key;
    if (e.ctrlKey || e.metaKey) {
      const has = current.some((p) => keyOf(p) === key);
      const next = has ? current.filter((p) => keyOf(p) !== key) : [...current, pick];
      hooks.select(next.length ? next : [pick], next.length && has ? next[next.length - 1] : pick);
    } else hooks.select([pick], pick);
  }

  // --- drag and drop --------------------------------------------------------------------------------------------

  const types = (e: DragEvent) => e.dataTransfer?.types ?? [];
  const carries = (e: DragEvent) => types(e).includes(ITEMS_MIME) || types(e).includes(GROUP_MIME);
  const clearMarks = () => {
    for (const el of tree.querySelectorAll(".dropTarget, .dropBefore, .dropAfter")) el.classList.remove("dropTarget", "dropBefore", "dropAfter");
    tree.classList.remove("dropTarget");
  };
  /** Where on a row the pointer is, from 0 (top) to 1 (bottom). */
  const along = (e: DragEvent, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    return box.height ? (e.clientY - box.top) / box.height : 0.5;
  };
  const draggedPicks = (e: DragEvent): Pick[] | null => {
    try {
      const picks = JSON.parse(e.dataTransfer?.getData(ITEMS_MIME) || "null");
      return Array.isArray(picks) && picks.length && picks.every((p) => p && typeof p.kind === "string" && typeof p.id === "string") ? picks : null;
    } catch {
      return null;
    }
  };

  /** Starts a drag of these things. */
  function dragThings(e: DragEvent, picks: Pick[]) {
    e.dataTransfer?.setData(ITEMS_MIME, JSON.stringify(picks));
    if (picks.every((p) => p.kind === "character")) e.dataTransfer?.setData(CHARACTERS_MIME, "1");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  /** What is dropped, put in a folder (undefined: no folder); a dropped folder goes inside it, or before `folderBefore`. */
  function dropped(e: DragEvent, place: string | undefined, folderBefore?: string, anchorOn?: { id: number; after: boolean }) {
    const folder = e.dataTransfer?.getData(GROUP_MIME);
    if (folder) {
      if (folder !== place && !isInside(groups, place, folder)) hooks.nestGroup(folder, place, folderBefore);
      return;
    }
    const picks = draggedPicks(e);
    if (!picks) return;
    // in order only among characters, and not next to itself
    const order = anchorOn && picks.every((p) => p.kind === "character") && !picks.some((p) => p.id === String(anchorOn.id)) ? anchorOn : undefined;
    hooks.move(picks, place, order);
  }

  /** Makes a row take drops; `zone` says where on it the pointer is, `land` what happens when something is dropped there. */
  function takeDrops(el: HTMLElement, zone: (e: DragEvent) => "before" | "after" | "into", land: (e: DragEvent, zone: "before" | "after" | "into") => void) {
    el.ondragover = (e) => {
      if (!carries(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearMarks();
      const z = zone(e);
      el.classList.add(z === "before" ? "dropBefore" : z === "after" ? "dropAfter" : "dropTarget");
    };
    el.ondragleave = (e) => {
      if (!el.contains(e.relatedTarget as Node | null)) clearMarks();
    };
    el.ondrop = (e) => {
      const z: "before" | "after" | "into" = el.classList.contains("dropBefore") ? "before" : el.classList.contains("dropAfter") ? "after" : "into";
      clearMarks();
      if (!carries(e)) return;
      e.preventDefault();
      e.stopPropagation();
      land(e, z);
    };
  }

  /** The empty part of the tree takes what is dropped on it out of its folder. */
  function dropOnTree(el: HTMLElement) {
    el.ondragover = (e) => {
      if (!carries(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearMarks();
      el.classList.add("dropTarget");
    };
    el.ondragleave = (e) => {
      if (!el.contains(e.relatedTarget as Node | null)) clearMarks();
    };
    el.ondrop = (e) => {
      clearMarks();
      if (!carries(e)) return;
      e.preventDefault();
      dropped(e, undefined);
    };
  }

  // --- rows -----------------------------------------------------------------------------------------------------

  function startRename(label: HTMLElement, current: string, commit: (name: string) => void) {
    if (renaming) return;
    renaming = true;
    const input = document.createElement("input");
    input.className = "hierRename";
    input.value = current;
    input.setAttribute("aria-label", "Rename");
    label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      renaming = false;
      const name = input.value.trim();
      if (ok && name !== current) commit(name);
      else redraw();
    };
    input.onblur = () => finish(true);
    input.onclick = (e) => e.stopPropagation();
    input.ondblclick = (e) => e.stopPropagation();
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    };
  }

  const button = (cls: string, title: string, svg: string, run: () => void, pressed?: boolean) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.title = title;
    b.setAttribute("aria-label", title);
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    b.tabIndex = -1;
    b.innerHTML = svg;
    b.onclick = (e) => {
      e.stopPropagation();
      run();
    };
    b.ondblclick = (e) => e.stopPropagation();
    return b;
  };

  const span = (cls: string, text?: string) => {
    const s = document.createElement("span");
    s.className = cls;
    if (text !== undefined) s.textContent = text;
    return s;
  };

  function newGroupIn(parent: string | undefined) {
    const id = hooks.newGroup(parent);
    active = id;
    if (parent) collapsed.delete(parent);
    redraw();
    const label = tree.querySelector<HTMLElement>(`[data-group="${id}"] .hierLabel`);
    const name = groups.find((g) => g.id === id)?.name ?? "";
    if (label) startRename(label, name, (n) => (n ? hooks.renameGroup(id, n) : redraw()));
  }

  /** The row of a folder. */
  function groupRow(item: Extract<TreeItem, { kind: "group" }>): HTMLElement {
    const g = item.group;
    const row = document.createElement("div");
    row.setAttribute("role", "treeitem");
    row.style.setProperty("--depth", String(item.depth));
    row.className = "hierRow hierGroup" + (item.dimmed ? " dimmed" : "") + (active === g.id ? " active" : "");
    row.dataset.group = g.id;
    row.setAttribute("aria-expanded", String(item.expanded));
    const chevron = span("hierChevron", item.expanded ? "▾" : "▸");
    chevron.onclick = (e) => {
      e.stopPropagation();
      if (collapsed.has(g.id)) collapsed.delete(g.id);
      else collapsed.add(g.id);
      redraw();
    };
    const folder = span("hierIcon folder");
    folder.innerHTML = icon("folder");
    row.append(chevron, folder, span("hierLabel", g.name), span("hierCount", String(item.count)));
    row.append(button("hierTool hierRemove", "Delete the folder (what is in it stays, outside of it)", icon("cross"), () => hooks.removeGroup(g.id)));
    row.append(button("hierEye", g.hidden ? "Show the folder" : "Hide the folder (its characters hide, its lights go off)", icon(g.hidden ? "hidden" : "eye"), () => hooks.toggleGroupHidden(g.id), !!g.hidden));
    const rename = () => startRename(row.querySelector<HTMLElement>(".hierLabel")!, g.name, (n) => (n ? hooks.renameGroup(g.id, n) : redraw()));
    row.onclick = () => {
      active = active === g.id ? undefined : g.id;
      redraw();
    };
    row.ondblclick = rename;
    row.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: "Rename", run: rename },
        { label: g.hidden ? "Show" : "Hide", run: () => hooks.toggleGroupHidden(g.id) },
        { label: "New folder inside", run: () => newGroupIn(g.id) },
        ...(g.parent ? [{ label: "Move out of the folder", run: () => hooks.nestGroup(g.id, groups.find((p) => p.id === g.parent)?.parent) }] : []),
        { label: "Delete folder (keep what is in it)", run: () => hooks.removeGroup(g.id) },
        { label: "Delete folder and everything in it", run: () => hooks.removeGroup(g.id, true) },
      ]);
    };
    row.draggable = true;
    row.ondragstart = (e) => {
      e.dataTransfer?.setData(GROUP_MIME, g.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    row.ondragend = clearMarks;
    // things go into the folder; a folder goes inside it, or (on the upper quarter of the row) before it
    takeDrops(
      row,
      (e) => (types(e).includes(GROUP_MIME) && along(e, row) < 0.25 ? "before" : "into"),
      (e, zone) => {
        if (zone === "before") dropped(e, g.parent, g.id);
        else {
          dropped(e, g.id);
          collapsed.delete(g.id);
        }
      },
    );
    return row;
  }

  /** The row of a character, a light or a camera. */
  function nodeRow(n: OutlinerNode, depth: number, dimmed: boolean): HTMLElement {
    const pick = pickOf(n);
    const row = document.createElement("div");
    row.setAttribute("role", "treeitem");
    row.style.setProperty("--depth", String(depth));
    row.className = "hierRow hierEntity" + (n.kind === "character" ? "" : " hierObject") + (n.selected ? " selected" : "") + (primary && keyOf(primary) === keyOf(n) ? " primary" : "") + (dimmed ? " dimmed" : "");
    row.dataset.key = keyOf(n);
    if (n.kind === "character") row.dataset.id = n.id;
    row.setAttribute("aria-selected", String(n.selected));
    row.tabIndex = -1;

    const glyph = span(n.kind === "character" ? "hierIcon portrait" : "hierIcon");
    if (n.kind === "character") {
      if (n.icon) glyph.style.backgroundImage = `url("${n.icon}")`;
    } else glyph.innerHTML = icon(n.kind === "light" ? "bulb" : "camera");
    const label = span("hierLabel", n.label);
    label.title = n.keywords && n.kind === "character" ? `${n.label}\n${n.keywords}` : n.label;
    row.append(glyph, label);
    if (n.kind === "character") {
      row.append(span("entTeam " + (n.team === 1 ? "blu" : "red"), n.team === 1 ? "BLU" : "RED"));
      row.append(button("hierTool hierFog" + (n.fogged ? " on" : ""), n.fogged ? "Affected by the fog (click to keep this character clear of it)" : "Not affected by the fog (click to put the fog over it)", icon("fog"), () => hooks.toggleFog(Number(n.id))));
      const particles = button("hierTool hierParticles", "Reset this character's frozen weapon particles", icon("reset"), () => hooks.clearParticles(Number(n.id)));
      particles.disabled = !n.canClearParticles;
      row.append(particles);
    } else row.append(span("hierCount", n.sub ?? ""));
    if (n.kind === "camera") row.append(button("hierTool hierLook" + (n.viewing ? " on" : ""), n.viewing ? "Leave this camera's view" : "Look through this camera", icon("viewfinder"), () => hooks.lookThrough(n.id), !!n.viewing));
    if (n.removable) row.append(button("hierTool hierRemove", `Delete the ${n.kind}`, icon("cross"), () => hooks.remove(targets(n))));
    if (n.kind !== "camera") {
      const title = n.off ? `Show the ${n.kind}` : n.kind === "light" ? "Turn the light off" : "Hide the character in the view";
      row.append(button("hierEye", title, icon(n.off ? "hidden" : "eye"), () => hooks.setOff(targets(n), !n.off), n.off));
    }

    row.onclick = (e) => click(e, pick);
    const rename = () => startRename(row.querySelector<HTMLElement>(".hierLabel")!, n.label, (name) => hooks.rename(pick, name));
    row.ondblclick = rename;
    row.oncontextmenu = (e) => {
      e.preventDefault();
      if (!n.selected) hooks.select([pick], pick);
      const mine = targets(n);
      showContextMenu(e.clientX, e.clientY, [
        ...(n.kind === "character" ? [{ label: "Frame", run: () => hooks.frame(Number(n.id)) }] : []),
        ...(n.kind === "camera" ? [{ label: n.viewing ? "Leave the view" : "Look through", run: () => hooks.lookThrough(n.id) }] : []),
        { label: "Rename", run: rename },
        ...(n.kind !== "camera" ? [{ label: n.off ? "Show" : n.kind === "light" ? "Turn off" : "Hide", run: () => hooks.setOff(mine, !n.off) }] : []),
        { label: mine.length > 1 ? "Copy selected" : "Copy", run: () => hooks.copy(mine) },
        { label: "Paste", run: () => hooks.paste(), disabled: !hooks.canPaste() },
        ...groups.filter((g) => g.id !== n.group).map((g) => ({ label: `Move to ${g.name}`, run: () => hooks.move(mine, g.id) })),
        ...(n.group ? [{ label: "Move out of the folder", run: () => hooks.move(mine, undefined) }] : []),
        ...(n.removable ? [{ label: mine.length > 1 ? "Delete selected" : "Delete", run: () => hooks.remove(mine) }] : []),
      ]);
    };
    row.draggable = true;
    row.ondragstart = (e) => dragThings(e, targets(n));
    row.ondragend = clearMarks;
    // dropped on a thing: into its folder (characters dropped on a character go right before or after it, which puts them in order)
    const place = n.group && groups.some((g) => g.id === n.group) ? n.group : undefined;
    takeDrops(
      row,
      (e) => (n.kind === "character" && types(e).includes(CHARACTERS_MIME) ? (along(e, row) < 0.5 ? "before" : "after") : "into"),
      (e, zone) => dropped(e, place, undefined, n.kind === "character" ? { id: Number(n.id), after: zone === "after" } : undefined),
    );
    return row;
  }

  // --- drawing --------------------------------------------------------------------------------------------------

  function redraw() {
    if (renaming) return;
    if (active && !groups.some((g) => g.id === active)) active = undefined;
    const hadFocus = tree.contains(document.activeElement);
    const items = flatten(
      groups,
      nodes.map((n): TreeNode => ({ key: keyOf(n), kind: n.kind, id: n.id, label: n.label, keywords: `${n.keywords} ${n.sub ?? ""} ${n.kind}`, group: n.group, off: n.off })),
      collapsed,
      search.value,
    );
    tree.replaceChildren();
    visible = [];
    for (const item of items) {
      if (item.kind === "group") tree.append(groupRow(item));
      else {
        const n = byKey.get(item.node.key);
        if (!n) continue;
        visible.push(pickOf(n));
        tree.append(nodeRow(n, item.depth, item.dimmed));
      }
    }
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "hierEmpty";
      empty.textContent = search.value.trim() ? "No matches" : "Nothing in the scene";
      tree.append(empty);
    }
    const count = (kind: NodeKind) => {
      const c = nodes.filter((n) => n.kind === kind).length;
      return `${c} ${kind}${c === 1 ? "" : "s"}`;
    };
    foot.textContent = [count("character"), count("light"), count("camera"), groups.length ? `${groups.length} folder${groups.length === 1 ? "" : "s"}` : "", active ? `new things go in ${groups.find((g) => g.id === active)?.name}` : ""].filter(Boolean).join(" · ");
    if (hadFocus) tree.querySelector<HTMLElement>(".selected")?.focus({ preventScroll: true });
    tree.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }

  dropOnTree(tree);
  search.oninput = () => redraw();
  tree.onkeydown = (e) => {
    if (renaming || (e.target as HTMLElement).matches("input")) return;
    const at = primary ? visible.findIndex((p) => keyOf(p) === keyOf(primary!)) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = visible[Math.max(0, Math.min(visible.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        const range = e.shiftKey && anchor ? rangeBetween(anchor, keyOf(next)) : null;
        if (range) hooks.select(range, next);
        else {
          anchor = keyOf(next);
          hooks.select([next], next);
        }
      }
      e.preventDefault();
    } else if (primary && hotkeyMatches("outliner.rename", e)) {
      tree.querySelector<HTMLElement>(`[data-key="${keyOf(primary)}"]`)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      e.preventDefault();
    } else if (primary && hotkeyMatches("outliner.toggle", e)) {
      const chosen = selectedPicks();
      const first = chosen.map((p) => byKey.get(keyOf(p))).find((n) => n && n.kind !== "camera");
      if (first) hooks.setOff(chosen, !first.off);
      e.preventDefault();
    } else if (primary && hotkeyMatches("outliner.delete", e)) {
      hooks.remove(selectedPicks());
      e.preventDefault();
    }
  };

  return {
    /** Makes a folder (inside the active one) and starts renaming it. */
    newFolder: () => newGroupIn(active),
    /** Shows the things, the folders and the one the properties show. */
    render(nextNodes: OutlinerNode[], nextGroups: HierarchyGroup[], nextPrimary: Pick | null) {
      // called for every change of a light or a camera, which can be every frame: nothing to draw when nothing differs
      const signature = JSON.stringify([nextNodes, nextGroups, nextPrimary]);
      if (signature === lastSignature && !renaming) return;
      lastSignature = signature;
      nodes = nextNodes;
      groups = nextGroups;
      primary = nextPrimary;
      byKey.clear();
      for (const n of nodes) byKey.set(keyOf(n), n);
      redraw();
    },
    /** The folder new characters, lights and cameras go into (absent: none). */
    activeGroup: () => (active && groups.some((g) => g.id === active) ? active : undefined),
    /** The folders inside `id` (and itself). */
    withDescendants: (id: string) => withDescendants(groups, id),
  };
}
