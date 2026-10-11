/** What a box or a click on the view can select. */
export interface BoxHits<A> {
  actors: A[];
  lights: string[];
  cameras: string[];
}

export type BoxMode = "replace" | "add" | "subtract";

/** Shift adds to the selection; Ctrl takes away from it; no key replaces it (Alt is the camera orbit, the tool leaves it alone). */
export function boxMode(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): BoxMode {
  if (e.ctrlKey || e.metaKey) return "subtract";
  return e.shiftKey ? "add" : "replace";
}

export interface BoxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The corners of a drag, in order (left < right, top < bottom). */
export function normalizeRect(ax: number, ay: number, bx: number, by: number): BoxRect {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/** True when two rectangles share any area (or touch). */
export function rectsOverlap(a: BoxRect, b: BoxRect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/** The selection after a box: replaced by the hits, added to, or reduced by them. Items are compared by `key`. */
export function combine<T>(current: readonly T[], hits: readonly T[], mode: BoxMode, key: (item: T) => string): T[] {
  const has = (list: readonly T[], item: T) => list.some((x) => key(x) === key(item));
  if (mode === "replace") return [...hits];
  if (mode === "add") return [...current, ...hits.filter((h) => !has(current, h))];
  return current.filter((c) => !has(hits, c));
}

/**
 * The box select tool of the 3D view: while it is on, dragging with the left button draws a box and selects what it covers
 * (a plain click selects what is under the pointer). The other buttons still move the camera.
 * Started with its key (`quick`) it is for one box and switches itself off after it; started with the button it stays on until it is switched off.
 */
export function createBoxSelect<A>(opts: {
  canvas: HTMLElement;
  wrap: HTMLElement;
  button: HTMLButtonElement;
  /** The things inside a box (client coordinates). */
  inBox: (box: BoxRect) => BoxHits<A>;
  /** The thing under a point, for a click. */
  atPoint: (x: number, y: number) => BoxHits<A>;
  apply: (hits: BoxHits<A>, mode: BoxMode) => void;
  /** False while something else owns the pointer (play mode, a camera view). */
  allowed: () => boolean;
}) {
  let on = false;
  /** On for one box only (started with the key). */
  let once = false;
  const frame = document.createElement("div");
  frame.className = "boxSelectFrame";
  frame.hidden = true;
  opts.wrap.append(frame);
  let drag: { id: number; x: number; y: number } | null = null;

  const set = (value: boolean, quick = false) => {
    on = value;
    once = value && quick;
    opts.button.classList.toggle("once", once);
    opts.button.classList.toggle("on", on);
    opts.button.setAttribute("aria-pressed", String(on));
    opts.wrap.classList.toggle("boxSelecting", on);
    if (!on) cancel();
  };
  const cancel = () => {
    if (drag && opts.canvas.hasPointerCapture(drag.id)) opts.canvas.releasePointerCapture(drag.id);
    drag = null;
    frame.hidden = true;
  };
  const draw = (x: number, y: number) => {
    if (!drag) return;
    const wrap = opts.wrap.getBoundingClientRect();
    const r = normalizeRect(drag.x, drag.y, x, y);
    Object.assign(frame.style, { left: `${r.x0 - wrap.left}px`, top: `${r.y0 - wrap.top}px`, width: `${r.x1 - r.x0}px`, height: `${r.y1 - r.y0}px` });
  };

  // on the window in the capture phase, ahead of everything on the canvas (the camera controls, the gizmos, the Ctrl + drag of lights and the click picking), which never see the drag
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!on || e.target !== opts.canvas || e.button !== 0 || e.altKey || !opts.allowed()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      opts.canvas.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    true,
  );
  opts.canvas.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) {
      frame.hidden = false;
      draw(e.clientX, e.clientY);
    }
  });
  opts.canvas.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const start = drag;
    cancel();
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3;
    opts.apply(moved ? opts.inBox(normalizeRect(start.x, start.y, e.clientX, e.clientY)) : opts.atPoint(e.clientX, e.clientY), boxMode(e));
    if (once) set(false);
  });
  opts.canvas.addEventListener("pointercancel", cancel);
  window.addEventListener(
    "keydown",
    (e) => {
      if (drag && e.key === "Escape") {
        e.stopPropagation();
        cancel();
      } else if (on && once && !drag && e.key === "Escape") set(false);
    },
    true,
  );
  // the button keeps it on (and off again); pressed while a one-box tool is on, it makes that one stay
  opts.button.onclick = () => set(on && !once ? false : true);

  return {
    /** The key: on for one box, or off if it is on already. */
    quick: () => set(!on, true),
    set,
    isOn: () => on,
  };
}
