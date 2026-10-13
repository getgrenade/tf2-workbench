/**
 * Drag and drop inside the page, done with the pointer. The desktop program takes files dropped from the file explorer through the window's
 * own handler (see fileDrop.ts), and on Windows that handler leaves no room for the web view's own drag and drop: a drag started in the page
 * (an outliner row, a prop from the browser) goes nowhere. So the page's drags are made here: the elements that are `draggable` are dragged
 * by the pointer, and the same events the browser would send (`dragstart`, `dragenter`, `dragover`, `dragleave`, `drop`, `dragend`, with a
 * real `DataTransfer`) are sent to them, so the code that handles those events does not know the difference.
 */

const THRESHOLD = 5;

interface Drag {
  source: HTMLElement;
  data: DataTransfer;
  ghost: HTMLElement;
  over: Element | null;
  accepted: boolean;
}

function send(type: string, target: Element | null, data: DataTransfer, at: { x: number; y: number }, related: Element | null = null): boolean {
  if (!target) return false;
  const event = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: data, clientX: at.x, clientY: at.y, relatedTarget: related });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Whether a drag of this element starts at all: the element (or what it holds) is draggable and the press is not on a control. */
function draggableAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("input, textarea, select, [contenteditable=\"true\"]")) return null;
  const el = target.closest<HTMLElement>("[draggable=\"true\"]");
  return el;
}

export function installPointerDnd() {
  let press: { source: HTMLElement; x: number; y: number; id: number } | null = null;
  let drag: Drag | null = null;

  // the browser's own drags are not wanted (they would be taken by the window's file drop handler and go nowhere)
  window.addEventListener("dragstart", (e) => { if (e.isTrusted) e.preventDefault(); }, true);

  const ghostOf = (source: HTMLElement) => {
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("id");
    ghost.draggable = false;
    const box = source.getBoundingClientRect();
    Object.assign(ghost.style, { position: "fixed", left: "0", top: "0", width: `${box.width}px`, margin: "0", pointerEvents: "none", opacity: "0.75", zIndex: "99999", transform: "translate(-9999px,-9999px)" });
    ghost.classList.add("dndGhost");
    document.body.append(ghost);
    return ghost;
  };

  const finish = (at: { x: number; y: number }, drop: boolean) => {
    const d = drag;
    drag = null;
    press = null;
    if (!d) return;
    document.body.classList.remove("dndActive");
    d.ghost.remove();
    if (d.over) {
      if (drop && d.accepted) send("drop", d.over, d.data, at);
      else send("dragleave", d.over, d.data, at);
    }
    send("dragend", d.source, d.data, at);
    // the click that ends a drag is not a click on what was dragged
    const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, true), 50);
  };

  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || drag) return;
    const source = draggableAt(e.target);
    press = source ? { source, x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  }, true);

  window.addEventListener("pointermove", (e) => {
    const at = { x: e.clientX, y: e.clientY };
    if (!drag) {
      if (!press || e.pointerId !== press.id || (e.buttons & 1) === 0) { press = null; return; }
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < THRESHOLD) return;
      const data = new DataTransfer();
      data.effectAllowed = "uninitialized";
      const source = press.source;
      // the code that owns the drag decides whether there is one, and what it carries
      if (send("dragstart", source, data, at)) { press = null; return; }
      drag = { source, data, ghost: ghostOf(source), over: null, accepted: false };
      document.body.classList.add("dndActive");
    }
    const d = drag!;
    d.ghost.style.transform = `translate(${at.x + 12}px, ${at.y + 12}px)`;
    const target = document.elementFromPoint(at.x, at.y);
    if (target !== d.over) {
      if (d.over) send("dragleave", d.over, d.data, at, target);
      d.over = target;
      if (target) send("dragenter", target, d.data, at, null);
    }
    d.accepted = target ? send("dragover", target, d.data, at) : false;
    document.body.classList.toggle("dndRefused", !d.accepted);
    e.preventDefault();
  }, true);

  window.addEventListener("pointerup", (e) => { finish({ x: e.clientX, y: e.clientY }, true); press = null; }, true);
  window.addEventListener("pointercancel", (e) => finish({ x: e.clientX, y: e.clientY }, false), true);
  window.addEventListener("blur", () => finish({ x: 0, y: 0 }, false));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag) { e.stopPropagation(); finish({ x: 0, y: 0 }, false); } }, true);
}
