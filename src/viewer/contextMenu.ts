/** A small right-click menu at the pointer; it closes on the next click, Escape, scrolling or a window change. */
export function showContextMenu(x: number, y: number, entries: { label: string; run: () => void; disabled?: boolean }[]) {
  document.querySelector(".ctxMenu")?.remove();
  const menu = document.createElement("div");
  menu.className = "ctxMenu";
  for (const entry of entries) {
    const b = document.createElement("button");
    b.textContent = entry.label;
    b.disabled = entry.disabled === true;
    b.onclick = () => {
      close();
      entry.run();
    };
    menu.appendChild(b);
  }
  const close = () => {
    menu.remove();
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("wheel", close, true);
  };
  const onDown = (ev: PointerEvent) => {
    if (!menu.contains(ev.target as Node)) close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    }
  };
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", close);
  window.addEventListener("wheel", close, true);
}
