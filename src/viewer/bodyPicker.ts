import type { BodyGroup } from "./bodyGroups";
import type { ViewSelection } from "./actor";
import { boxShape, brushShape, lassoShape, type ScreenShape } from "./screenShapes";

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

export interface BodyHost {
  /** The parts of the selected character that are shown. */
  get(): ReadonlySet<string>;
  set(parts: Set<string>): void;
  groups(): readonly BodyGroup[];
  /** Starts a selection (box, lasso or brush) over the body of the selected character (null when there is none). */
  beginSelect(): ViewSelection | null;
  /** Changes whenever the camera moves (a selection made earlier no longer lines up with the view). */
  viewStamp(): string;
  hasBoxMask(): boolean;
  clearBoxMask(): void;
}

/** Authored class group checklist, with independent manual view selection tools. */
type Tool = "box" | "lasso" | "brush";
const TOOLS: { id: Tool; label: string; title: string; hint: string }[] = [
  { id: "box", label: "Box", title: "Box: drag a rectangle over the view; what it covers of the body is hidden", hint: "Drag a box over the character: what it covers is hidden (Shift: shown again)" },
  { id: "lasso", label: "Lasso", title: "Lasso: draw a free shape over the view; what it encloses is hidden", hint: "Draw around what to hide (Shift: shown again)" },
  { id: "brush", label: "Brush", title: "Brush: paint over the view; what you paint over is hidden at once", hint: "Paint over what to hide (Shift: paint it back)" },
];
let brushSize = 24;
let tool: Tool | null = null;
let ring: HTMLElement | null = null;

/**
 * The parts picker: which parts of the selected character are drawn, as a checklist with All and None (in `panel`, a block of the
 * properties panel, beside the bodygroups; in the view's popup when there is no panel), and the view tools that hide triangles by hand
 * (box, lasso, brush), in a popup off a button at the bottom right of the view.
 */
export function createBodyPicker(tools: HTMLElement, host: BodyHost, panel?: HTMLElement | null | false): { sync: () => void } {
  /** The checklist is in the popup (no panel given): the popup is the parts picker; otherwise it holds the triangle tools alone. */
  const inPopup = panel === undefined || panel === null;
  const button = document.createElement("button");
  button.id = "hudBody";
  button.innerHTML = ICON;
  button.title = inPopup ? "Character parts: choose which parts of the character are shown" : "Hide triangles: box, lasso or brush over the view hides what they cover (which parts are drawn is under Properties, Bodygroups)";
  button.setAttribute("aria-label", inPopup ? "Character parts" : "Hide triangles");
  tools.parentElement?.appendChild(button); // bottom right corner of the view

  const pop = document.createElement("div");
  pop.id = "bodyPop";
  pop.hidden = true;
  pop.innerHTML = `<div class="bpHead">${inPopup ? "Show character parts" : "Hide triangles"}</div>`;
  // the checklist and its presets: in the panel, in the popup when there is none, nowhere when the panel is `false` (the properties
  // panel lists the parts itself)
  const listHost = panel === false ? null : panel ?? pop;
  const presets = document.createElement("div");
  presets.className = "bpPresets";
  const list = document.createElement("div");
  list.className = "bpGroupList";
  listHost?.append(presets, list);
  const checks = new Map<string, HTMLInputElement>();
  let groupKey = "";
  const hint = document.createElement("div");
  hint.className = "bpHint dim";
  hint.textContent = inPopup ? "Checked groups are visible. View tools hide selected triangles (Shift restores them)." : "What a tool covers is hidden (Shift: shown again). Which parts are drawn at all is set under Properties, Bodygroups.";
  pop.appendChild(hint);
  const toolRow = document.createElement("div");
  toolRow.className = "bpBoxRow";
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const b = document.createElement("button");
    b.className = "bpBoxBtn";
    b.textContent = t.label;
    b.title = t.title;
    b.onclick = () => setTool(tool === t.id ? null : t.id);
    toolButtons.set(t.id, b);
    toolRow.appendChild(b);
  }
  const clearButton = document.createElement("button");
  clearButton.textContent = "Clear";
  clearButton.title = "Bring back everything hidden with the view tools";
  clearButton.onclick = () => {
    host.clearBoxMask();
    paint();
  };
  toolRow.appendChild(clearButton);
  const sizeRow = document.createElement("label");
  sizeRow.className = "bpSize";
  sizeRow.hidden = true;
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = "6";
  sizeInput.max = "120";
  sizeInput.value = String(brushSize);
  sizeInput.oninput = () => {
    brushSize = Number(sizeInput.value);
    if (ring) {
      ring.style.width = ring.style.height = `${brushSize}px`;
    }
  };
  sizeRow.append("Brush size", sizeInput);
  if (listHost === pop) presets.after(toolRow, sizeRow);
  else pop.querySelector(".bpHead")!.after(toolRow, sizeRow);
  for (const [label, all] of [["All", true], ["None", false]] as const) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      host.set(new Set(all ? host.groups().map(g => g.id) : []));
      if (all) host.clearBoxMask();
      paint();
    };
    presets.appendChild(b);
  }
  tools.parentElement?.appendChild(pop);

  function paint() {
    if (!listHost) return;
    const groups = host.groups();
    const key = groups.map(g => g.id).join(",");
    if (groupKey !== key) {
      groupKey = key;
      list.replaceChildren();
      checks.clear();
      for (const group of groups) {
        const row = document.createElement("label");
        const check = document.createElement("input");
        check.type = "checkbox";
        check.onchange = () => {
          const next = new Set(host.get());
          if (check.checked) next.add(group.id); else next.delete(group.id);
          host.set(next);
          paint();
        };
        row.append(check, group.label);
        list.appendChild(row);
        checks.set(group.id, check);
      }
    }
    const now = host.get();
    for (const [key, check] of checks) check.checked = now.has(key) || now.has("*");
    if (panel) panel.hidden = groups.length === 0; // (a prop or a building has no parts to pick)
  }

  // --- the view tools: box, lasso and brush over the 3D view ---
  const view = tools.parentElement;
  let layer: HTMLDivElement | null = null;
  let selection: ViewSelection | null = null;

  function syncButton() {
    button.classList.toggle("on", !pop.hidden || tool !== null);
  }

  function stopTool() {
    clearHover();
    pointer = null;
    window.removeEventListener("keydown", onShiftKey);
    window.removeEventListener("keyup", onShiftKey);
    selection?.clear();
    selection = null;
    layer?.remove();
    layer = null;
    ring = null;
    view?.classList.remove("selecting", "brushing");
    view?.removeEventListener("pointerdown", onDown, true);
    view?.removeEventListener("pointermove", onHover);
    window.removeEventListener("keydown", onEsc, true);
    tool = null;
  }

  function setTool(next: Tool | null) {
    if (tool) stopTool();
    for (const [id, b] of toolButtons) b.classList.toggle("on", id === next);
    sizeRow.hidden = next !== "brush";
    if (next && view) {
      tool = next;
      layer = document.createElement("div");
      layer.id = "bodyToolLayer";
      layer.innerHTML = `<div class="bboxHint"></div><div class="bboxRect" hidden></div><svg class="lassoSvg"><polygon points="" /></svg><div class="brushRing" hidden></div>`;
      layer.querySelector(".bboxHint")!.textContent = `${TOOLS.find((t) => t.id === next)!.hint}. Alt + drag turns the camera. Esc to stop.`;
      ring = layer.querySelector<HTMLElement>(".brushRing");
      if (ring) ring.style.width = ring.style.height = `${brushSize}px`;
      view.appendChild(layer);
      view.classList.add("selecting");
      view.classList.toggle("brushing", next === "brush");
      view.addEventListener("pointerdown", onDown, true);
      view.addEventListener("pointermove", onHover);
      window.addEventListener("keydown", onEsc, true);
      window.addEventListener("keydown", onShiftKey);
      window.addEventListener("keyup", onShiftKey);
    }
    syncButton();
  }

  function onEsc(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      setTool(null);
    }
  }

  function onHover(ev: PointerEvent) {
    if (!ring || !layer || tool !== "brush") return;
    const base = layer.getBoundingClientRect();
    pointer = { x: ev.clientX, y: ev.clientY, onCanvas: ev.target instanceof HTMLCanvasElement, shift: ev.shiftKey };
    queueHover();
    ring.hidden = !pointer.onCanvas;
    ring.style.left = `${ev.clientX - base.left - brushSize / 2}px`;
    ring.style.top = `${ev.clientY - base.top - brushSize / 2}px`;
  }

  // The brush shows what it would hide (red) or, with Shift, bring back (green) before you press. The positions of the vertices are
  // worked out again only when the view has moved.
  let pointer: { x: number; y: number; onCanvas: boolean; shift: boolean } | null = null;
  let hover: { sel: ViewSelection; stamp: string; at: number } | null = null;
  let hoverQueued = false;
  function clearHover() {
    hover?.sel.clear();
    hover = null;
  }
  function queueHover() {
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (tool !== "brush" || selection || !pointer) return;
      if (!pointer.onCanvas) {
        hover?.sel.clear();
        return;
      }
      const stamp = host.viewStamp();
      if (!hover || hover.stamp !== stamp || performance.now() - hover.at > 1500) {
        clearHover();
        const sel = host.beginSelect();
        if (sel) hover = { sel, stamp, at: performance.now() };
      }
      hover?.sel.preview(brushShape(pointer.x, pointer.y, pointer.x, pointer.y, brushSize / 2), pointer.shift);
    });
  }
  function onShiftKey(ev: KeyboardEvent) {
    if (ev.key !== "Shift" || !pointer) return;
    pointer.shift = ev.type === "keydown";
    queueHover();
  }

  /** Only the plain left button on the 3D view itself is taken; everything else still reaches the camera controls. */
  function onDown(ev: PointerEvent) {
    if (ev.button !== 0 || ev.altKey || !tool || !layer || !view || !(ev.target instanceof HTMLCanvasElement)) return; // Alt + left button orbits the camera
    clearHover();
    const current = host.beginSelect();
    if (!current) return;
    ev.stopPropagation();
    ev.preventDefault();
    selection = current;
    view.setPointerCapture(ev.pointerId);
    const base = layer.getBoundingClientRect();
    const rectEl = layer.querySelector<HTMLElement>(".bboxRect")!;
    const polygon = layer.querySelector<SVGPolygonElement>(".lassoSvg polygon")!;
    const origin = { x: ev.clientX, y: ev.clientY };
    const used = tool;
    const path: [number, number][] = [[ev.clientX, ev.clientY]];
    let last = { x: ev.clientX, y: ev.clientY };
    let queued: PointerEvent | null = null;

    const boxShapeAt = (e: PointerEvent): ScreenShape => boxShape(Math.min(origin.x, e.clientX), Math.min(origin.y, e.clientY), Math.max(origin.x, e.clientX), Math.max(origin.y, e.clientY));
    const brushShapeAt = (from: { x: number; y: number }, to: { x: number; y: number }) => brushShape(from.x, from.y, to.x, to.y, brushSize / 2);
    if (used === "brush") current.apply(brushShapeAt(last, last), !ev.shiftKey);

    const onMove = (e: PointerEvent) => {
      if (used === "brush") {
        const cur = { x: e.clientX, y: e.clientY };
        current.apply(brushShapeAt(last, cur), !e.shiftKey);
        last = cur;
        onHover(e);
        return;
      }
      if (used === "box") {
        rectEl.hidden = false;
        rectEl.style.left = `${Math.min(origin.x, e.clientX) - base.left}px`;
        rectEl.style.top = `${Math.min(origin.y, e.clientY) - base.top}px`;
        rectEl.style.width = `${Math.abs(e.clientX - origin.x)}px`;
        rectEl.style.height = `${Math.abs(e.clientY - origin.y)}px`;
      } else {
        const [px, py] = path[path.length - 1];
        if (Math.hypot(e.clientX - px, e.clientY - py) >= 3) path.push([e.clientX, e.clientY]);
        polygon.setAttribute("points", path.map(([x, y]) => `${x - base.left},${y - base.top}`).join(" "));
      }
      // the tint on what would be hidden follows the shape (once per frame)
      if (!queued) {
        requestAnimationFrame(() => {
          const q = queued;
          queued = null;
          if (q && selection === current) current.preview(used === "box" ? boxShapeAt(q) : lassoShape(path.slice()), q.shiftKey);
        });
      }
      queued = e;
    };
    const onUp = (e: PointerEvent) => {
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onUp);
      view.removeEventListener("pointercancel", onUp);
      rectEl.hidden = true;
      polygon.setAttribute("points", "");
      queued = null;
      const tiny = used === "box" && Math.abs(e.clientX - origin.x) < 3 && Math.abs(e.clientY - origin.y) < 3;
      if (e.type === "pointercancel" || tiny || (used === "lasso" && path.length < 3)) current.clear();
      else if (used === "box") {
        current.apply(boxShapeAt(e), !e.shiftKey);
        current.clear();
      } else if (used === "lasso") {
        current.apply(lassoShape(path.slice()), !e.shiftKey);
        current.clear();
      }
      selection = null;
      paint();
      if (used === "brush") queueHover();
    };
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerup", onUp);
    view.addEventListener("pointercancel", onUp);
  }

  button.onclick = () => {
    pop.hidden = !pop.hidden;
    syncButton();
    paint();
  };
  return { sync: paint };
}
