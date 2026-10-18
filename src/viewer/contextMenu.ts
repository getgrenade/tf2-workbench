/** An entry of the menu, or a line between groups of them (`"-"`; doubled or leading and trailing lines are dropped). */
export type ContextEntry = { label: string; run: () => void; disabled?: boolean } | "-";

/** A small right-click menu at the pointer; it closes on the next click, Escape, scrolling or a window change. */
export function showContextMenu(x: number, y: number, entries: ContextEntry[]) {
  document.querySelector(".ctxMenu")?.remove();
  const menu = document.createElement("div");
  menu.className = "ctxMenu";
  // the lines: one between groups, none at the ends (an entry left out by the caller can leave two together)
  const trimmed = entries.filter((e, i, all) => e !== "-" || (i > 0 && i < all.length - 1 && all[i - 1] !== "-"));
  for (const entry of trimmed) {
    if (entry === "-") {
      const sep = document.createElement("div");
      sep.className = "ctxSep";
      menu.appendChild(sep);
      continue;
    }
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
