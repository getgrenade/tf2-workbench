import { DOCKS, activatePanel, findPanel, hidePanel, movePanel, parseLayout, setDockSize, setFolded, setWeights, showPanel, type DockId, type DockLayout, type DropTarget } from "./dockModel";

/** A panel that can be moved about: its element is kept as it is (ids and listeners untouched) and put in whichever dock holds it. */
export interface PanelDef {
  id: string;
  title: string;
  el: HTMLElement;
}

export interface DockOptions {
  /** The element that holds the three docks and the 3D view (it gets the fold classes and the size variables). */
  view: HTMLElement;
  docks: Record<DockId, HTMLElement>;
  /** The buttons at the edges of the 3D view that fold a dock away. */
  folds: Record<DockId, HTMLElement>;
  panels: PanelDef[];
  defaults: DockLayout;
  storageKey: string;
}

const FOLD_CLASS: Record<DockId, string> = { left: "foldL", right: "foldR", bottom: "foldB" };
const SIZE_VAR: Record<DockId, string> = { left: "--sizeL", right: "--sizeR", bottom: "--sizeB" };
const MIN_SIZE: Record<DockId, number> = { left: 200, right: 200, bottom: 120 };
const GROUP_MIN = 70;
/** The part of a group's edge (as a share of it) that splits it rather than adds a tab. */
const EDGE = 0.22;

/**
 * The three docks (left, right, bottom): each holds groups of panels, a group has tabs, and the tabs can be dragged to any group
 * of any dock, to the edge of a group (a new group next to it) or to an empty dock. The layout is kept between runs.
 */
export function createDocks(o: DockOptions) {
  const byId = new Map(o.panels.map((p) => [p.id, p]));
  const ids = o.panels.map((p) => p.id);
  const limbo = document.createElement("div");
  limbo.hidden = true;
  limbo.className = "dockLimbo";
  o.view.append(limbo);
  const listeners: (() => void)[] = [];

  function load(): DockLayout {
    let raw: unknown = null;
    try { raw = JSON.parse(localStorage.getItem(o.storageKey) ?? "null"); } catch { /* the default layout */ }
    return parseLayout(raw, ids, o.defaults);
  }
  let layout = load();
  const save = () => {
    try { localStorage.setItem(o.storageKey, JSON.stringify(layout)); } catch { /* not remembered */ }
  };
  const set = (next: DockLayout, redraw = true) => {
    layout = next;
    save();
    if (redraw) render();
    for (const l of listeners) l();
  };

  // --- panels -----------------------------------------------------------------------------------------------------

  for (const p of o.panels) {
    p.el.classList.add("dockPanel");
    p.el.dataset.panel = p.id;
    // the title is on the tab: the first heading of a panel keeps only its buttons
    const head = p.el.querySelector<HTMLElement>(":scope > h3");
    if (head) {
      head.classList.add("panelHead");
      const title = document.createElement("span");
      title.className = "panelTitle";
      while (head.firstChild && head.firstChild.nodeType === Node.TEXT_NODE) title.append(head.firstChild);
      head.prepend(title);
      if (!head.querySelector(":scope > :not(.panelTitle)")) head.classList.add("empty");
    }
  }

  // --- drawing ----------------------------------------------------------------------------------------------------

  const stackOf = (dock: DockId) => {
    let stack = o.docks[dock].querySelector<HTMLElement>(":scope > .dockStack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "dockStack";
      o.docks[dock].prepend(stack);
    }
    return stack;
  };

  function tabButton(id: string, active: boolean): HTMLElement {
    const tab = document.createElement("div");
    tab.className = "dockTab" + (active ? " on" : "");
    tab.dataset.panel = id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(active));
    const label = document.createElement("span");
    label.textContent = byId.get(id)?.title ?? id;
    tab.append(label);
    tab.onpointerdown = (e) => beginTabDrag(e, id);
    tab.onclick = () => activate(id);
    return tab;
  }

  function groupElement(dock: DockId, gi: number): HTMLElement {
    const g = layout.docks[dock].groups[gi];
    const el = document.createElement("div");
    el.className = "dockGroup";
    el.dataset.dock = dock;
    el.dataset.group = String(gi);
    el.style.flex = `${g.weight} 1 0px`;
    const strip = document.createElement("div");
    strip.className = "dockTabs";
    strip.setAttribute("role", "tablist");
    for (const id of g.tabs) strip.append(tabButton(id, id === g.active));
    const body = document.createElement("div");
    body.className = "dockBody";
    for (const id of g.tabs) {
      const panel = byId.get(id)!.el;
      panel.hidden = id !== g.active;
      body.append(panel);
    }
    el.append(strip, body);
    return el;
  }

  function splitElement(dock: DockId, gi: number): HTMLElement {
    const s = document.createElement("div");
    s.className = "dockSplit";
    s.setAttribute("role", "separator");
    s.title = "Drag to resize the two groups";
    s.onpointerdown = (e) => beginSplitDrag(e, dock, gi);
    return s;
  }

  function render() {
    for (const id of layout.hidden) limbo.append(byId.get(id)!.el);
    for (const dock of DOCKS) {
      const stack = stackOf(dock);
      stack.replaceChildren();
      const groups = layout.docks[dock].groups;
      o.docks[dock].classList.toggle("empty", groups.length === 0);
      if (!groups.length) {
        const hint = document.createElement("div");
        hint.className = "dockEmpty";
        hint.textContent = "Drag a panel here";
        stack.append(hint);
      }
      groups.forEach((_, gi) => {
        if (gi > 0) stack.append(splitElement(dock, gi));
        stack.append(groupElement(dock, gi));
      });
    }
    chrome();
  }

  /** Folds and sizes of the docks. */
  function chrome() {
    for (const dock of DOCKS) {
      const folded = layout.folded.includes(dock);
      o.view.classList.toggle(FOLD_CLASS[dock], folded);
      o.folds[dock].classList.toggle("folded", folded);
      const size = layout.docks[dock].size;
      if (size) o.view.style.setProperty(SIZE_VAR[dock], `${size}px`);
      else o.view.style.removeProperty(SIZE_VAR[dock]);
    }
  }

  // --- actions ----------------------------------------------------------------------------------------------------

  /** Shows a tab of its group (without drawing everything again). */
  function activate(id: string) {
    const at = findPanel(layout, id);
    if (!at) return;
    const next = activatePanel(layout, id);
    const group = o.docks[at.dock].querySelector<HTMLElement>(`.dockGroup[data-group="${at.group}"]`);
    if (group) {
      for (const tab of group.querySelectorAll<HTMLElement>(".dockTab")) {
        const on = tab.dataset.panel === id;
        tab.classList.toggle("on", on);
        tab.setAttribute("aria-selected", String(on));
      }
      for (const panel of group.querySelectorAll<HTMLElement>(":scope > .dockBody > .dockPanel")) panel.hidden = panel.dataset.panel !== id;
    }
    set(next, false);
  }

  function hide(id: string) {
    if (!findPanel(layout, id)) return;
    set(hidePanel(layout, id));
  }

  function toggleFold(dock: DockId) {
    set(setFolded(layout, dock, !layout.folded.includes(dock)), false);
    chrome();
  }

  const home = (id: string): DockId => findPanel(o.defaults, id)?.dock ?? "right";

  /** Makes a panel show: brings it back when hidden, opens its dock when folded, and makes it the tab of its group. */
  function reveal(id: string) {
    let next = layout;
    if (!findPanel(next, id)) next = showPanel(next, id, home(id));
    const at = findPanel(next, id);
    if (at && next.folded.includes(at.dock)) next = setFolded(next, at.dock, false);
    set(next);
    activate(id);
  }

  function togglePanel(id: string) {
    if (findPanel(layout, id)) hide(id);
    else reveal(id);
  }

  function reset() {
    set(parseLayout(null, ids, o.defaults));
  }

  // --- dragging a tab ---------------------------------------------------------------------------------------------

  let dragging = false;

  function beginTabDrag(down: PointerEvent, id: string) {
    if (down.button !== 0) return;
    const startX = down.clientX, startY = down.clientY;
    let started = false;
    let ghost: HTMLElement | null = null;
    let hint: HTMLElement | null = null;
    let target: { drop: DropTarget; rect: { left: number; top: number; width: number; height: number } } | null = null;
    const peeked: DockId[] = [];

    const move = (e: PointerEvent) => {
      if (!started) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
        started = true;
        dragging = true;
        document.body.classList.add("dockDragging");
        ghost = document.createElement("div");
        ghost.className = "dockGhost";
        ghost.textContent = byId.get(id)?.title ?? id;
        hint = document.createElement("div");
        hint.className = "dockDropHint";
        document.body.append(ghost, hint);
        // a folded dock opens while a panel is dragged, so it can be dropped on
        for (const dock of layout.folded) {
          peeked.push(dock);
          o.view.classList.remove(FOLD_CLASS[dock]);
        }
      }
      ghost!.style.left = `${e.clientX + 12}px`;
      ghost!.style.top = `${e.clientY + 8}px`;
      target = hitTest(e.clientX, e.clientY);
      if (target) {
        hint!.hidden = false;
        Object.assign(hint!.style, { left: `${target.rect.left}px`, top: `${target.rect.top}px`, width: `${target.rect.width}px`, height: `${target.rect.height}px` });
      } else hint!.hidden = true;
    };
    const end = (apply: boolean) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      if (!started) return;
      ghost?.remove();
      hint?.remove();
      document.body.classList.remove("dockDragging");
      dragging = false;
      let next = layout;
      if (apply && target) next = movePanel(layout, id, target.drop);
      // docks that were opened for the drag fold again, unless the panel was dropped into one
      const folded = new Set(layout.folded);
      if (apply && target) folded.delete(target.drop.dock);
      next = { ...next, folded: [...folded] };
      set(next);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        end(false);
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
  }

  /** Where a dragged panel would go with the pointer here, and the area to show for it. */
  function hitTest(x: number, y: number): { drop: DropTarget; rect: { left: number; top: number; width: number; height: number } } | null {
    for (const dock of DOCKS) {
      const root = o.docks[dock];
      const box = root.getBoundingClientRect();
      if (box.width < 2 || box.height < 2 || x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const groups = [...root.querySelectorAll<HTMLElement>(".dockGroup")];
      const rectOf = (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
      const horizontal = dock === "bottom";
      for (let gi = 0; gi < groups.length; gi++) {
        const gr = groups[gi].getBoundingClientRect();
        if (x < gr.left || x > gr.right || y < gr.top || y > gr.bottom) continue;
        const strip = groups[gi].querySelector<HTMLElement>(".dockTabs")!;
        const sr = strip.getBoundingClientRect();
        if (y <= sr.bottom) {
          // over the tabs: a place among them
          const tabs = [...strip.querySelectorAll<HTMLElement>(".dockTab")];
          let index = tabs.length;
          for (let i = 0; i < tabs.length; i++) {
            const r = tabs[i].getBoundingClientRect();
            if (x < r.left + r.width / 2) { index = i; break; }
          }
          const mark = index < tabs.length ? tabs[index].getBoundingClientRect().left : (tabs.at(-1)?.getBoundingClientRect().right ?? sr.left);
          return { drop: { kind: "tab", dock, group: gi, index }, rect: { left: mark - 2, top: sr.top, width: 4, height: sr.height } };
        }
        const along = horizontal ? (x - gr.left) / gr.width : (y - gr.top) / gr.height;
        if (along < EDGE || along > 1 - EDGE) {
          const after = along > 0.5;
          const half = horizontal ? { left: after ? gr.left + gr.width / 2 : gr.left, top: gr.top, width: gr.width / 2, height: gr.height } : { left: gr.left, top: after ? gr.top + gr.height / 2 : gr.top, width: gr.width, height: gr.height / 2 };
          return { drop: { kind: "split", dock, group: gi, after }, rect: half };
        }
        const tabCount = groups[gi].querySelectorAll(".dockTab").length;
        return { drop: { kind: "tab", dock, group: gi, index: tabCount }, rect: rectOf(gr) };
      }
      // in the dock but not on a group: the end of the dock
      return { drop: { kind: "dock", dock }, rect: rectOf(box) };
    }
    return null;
  }

  // --- resizing: the groups of a dock, and the docks ---------------------------------------------------------------

  function beginSplitDrag(down: PointerEvent, dock: DockId, gi: number) {
    if (down.button !== 0) return;
    down.preventDefault();
    const horizontal = dock === "bottom";
    const stack = stackOf(dock);
    const groups = [...stack.querySelectorAll<HTMLElement>(":scope > .dockGroup")];
    const sizes = groups.map((g) => (horizontal ? g.getBoundingClientRect().width : g.getBoundingClientRect().height));
    const before = gi - 1, after = gi;
    const startPos = horizontal ? down.clientX : down.clientY;
    const pair = sizes[before] + sizes[after];
    const handle = down.currentTarget as HTMLElement;
    handle.setPointerCapture(down.pointerId);
    handle.classList.add("dragging");
    const apply = (px: number[]) => groups.forEach((g, i) => (g.style.flex = `${px[i]} 1 0px`));
    const move = (e: PointerEvent) => {
      const delta = (horizontal ? e.clientX : e.clientY) - startPos;
      const first = Math.min(Math.max(sizes[before] + delta, GROUP_MIN), pair - GROUP_MIN);
      const px = [...sizes];
      px[before] = first;
      px[after] = pair - first;
      apply(px);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      handle.classList.remove("dragging");
      const px = groups.map((g) => (horizontal ? g.getBoundingClientRect().width : g.getBoundingClientRect().height));
      const total = px.reduce((a, b) => a + b, 0) || 1;
      // kept as shares, so the groups keep their proportions when the window changes
      set(setWeights(layout, dock, px.map((v) => (v / total) * groups.length)), false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  /** The handle on the inner edge of each dock, which drags its width (its height, for the bottom one). */
  for (const dock of DOCKS) {
    const edge = document.createElement("div");
    edge.className = `dockEdge ${dock}`;
    edge.setAttribute("role", "separator");
    edge.title = "Drag to resize the panel (double-click: back to the default size)";
    edge.onpointerdown = (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      edge.setPointerCapture(down.pointerId);
      edge.classList.add("dragging");
      const root = o.docks[dock];
      const start = dock === "bottom" ? root.getBoundingClientRect().height : root.getBoundingClientRect().width;
      const from = dock === "bottom" ? down.clientY : down.clientX;
      const room = (dock === "bottom" ? o.view.getBoundingClientRect().height : o.view.getBoundingClientRect().width) - 260;
      let size = start;
      const move = (e: PointerEvent) => {
        // the left dock grows to the right, the right dock to the left, the bottom one upwards
        const delta = dock === "left" ? e.clientX - from : dock === "right" ? from - e.clientX : from - e.clientY;
        size = Math.min(Math.max(start + delta, MIN_SIZE[dock]), Math.max(MIN_SIZE[dock], room));
        o.view.style.setProperty(SIZE_VAR[dock], `${Math.round(size)}px`);
      };
      const up = () => {
        edge.removeEventListener("pointermove", move);
        edge.removeEventListener("pointerup", up);
        edge.removeEventListener("pointercancel", up);
        edge.classList.remove("dragging");
        set(setDockSize(layout, dock, size), false);
      };
      edge.addEventListener("pointermove", move);
      edge.addEventListener("pointerup", up);
      edge.addEventListener("pointercancel", up);
    };
    edge.ondblclick = () => {
      set(setDockSize(layout, dock, undefined), false);
      chrome();
    };
    o.docks[dock].append(edge);
  }

  for (const dock of DOCKS) o.folds[dock].onclick = () => toggleFold(dock);

  render();

  return {
    activate,
    reveal,
    togglePanel,
    toggleFold,
    reset,
    isVisible: (id: string) => findPanel(layout, id) !== null,
    panels: () => o.panels.map((p) => ({ id: p.id, title: p.title, visible: findPanel(layout, p.id) !== null })),
    /** Called after the layout changed (a tab moved, a panel hidden or shown, a dock folded). */
    onChange: (fn: () => void) => listeners.push(fn),
    isDragging: () => dragging,
  };
}
