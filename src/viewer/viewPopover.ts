/** A small panel under a button, for the settings of a group of buttons (the drop-down arrow of Blender's header groups). */

let current: { close: () => void; anchor: HTMLElement } | null = null;

/**
 * Opens a panel under `anchor`, filled by `build`. It closes on a press outside it, on Escape or when the window changes size, and a click on
 * the anchor while it is open closes it. (It stays open while the window loses focus: the colour pickers are windows of their own.)
 */
export function togglePopover(anchor: HTMLElement, title: string, build: (body: HTMLElement, head: HTMLElement) => void) {
  if (current) {
    const same = current.anchor === anchor;
    current.close();
    if (same) return;
  }
  const root = document.createElement("div");
  root.className = "viewPopover";
  const head = document.createElement("div");
  head.className = "viewPopoverTitle";
  const heading = document.createElement("span");
  heading.textContent = title;
  head.append(heading);
  const body = document.createElement("div");
  body.className = "viewPopoverBody";
  root.append(head, body);
  build(body, head);
  document.body.append(root);

  const place = () => {
    const a = anchor.getBoundingClientRect(), r = root.getBoundingClientRect();
    root.style.left = `${Math.max(4, Math.min(a.right - r.width, window.innerWidth - r.width - 4))}px`;
    root.style.top = `${Math.min(a.bottom + 4, Math.max(4, window.innerHeight - r.height - 4))}px`;
  };
  place();
  anchor.classList.add("open");
  anchor.setAttribute("aria-expanded", "true");

  const onDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!root.contains(target) && !anchor.contains(target)) close();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const close = () => {
    root.remove();
    anchor.classList.remove("open");
    anchor.setAttribute("aria-expanded", "false");
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    if (current?.anchor === anchor) current = null;
  };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);
  current = { close, anchor };
}
