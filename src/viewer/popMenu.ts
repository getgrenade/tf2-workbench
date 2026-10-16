/** A drop-down menu panel with sub-menus that open to the side when you hover (or click) an entry, like the Add menu of 3D editors. */

export interface MenuItem {
  label: string;
  /** SVG path data on an 18 x 18 grid (stroked), shown before the label. */
  icon?: string;
  /** Dim text after the label. */
  hint?: string;
  /** Sub-menu: opens beside the entry. */
  children?: MenuItem[];
  /** Called when the entry is picked (not for an entry with a sub-menu); `ctrl` says whether Ctrl was held. */
  run?: (mod: { ctrl: boolean }) => void;
  disabled?: boolean;
  /** A thin line before this entry. */
  separator?: boolean;
  /** Shows a check mark (true) or an empty place (false) before the label. */
  checked?: boolean;
  /** The menu stays open when the entry is picked (its check mark turns over). */
  keepOpen?: boolean;
  /** A small × at the end of the entry that deletes what it stands for: it closes the menu and calls this (the entry itself is not picked). */
  remove?: () => void;
  /** What the × says when the pointer rests on it. */
  removeTitle?: string;
}

const OPEN_DELAY = 140;

/** Opens the menu under `anchor` (or at a point). It closes on a pick, a click outside, Escape, a scroll or a window change. */
export function openMenu(anchor: HTMLElement | { x: number; y: number }, items: MenuItem[]) {
  document.querySelector(".popMenuRoot")?.dispatchEvent(new Event("popmenu-close"));
  const levels: HTMLElement[] = [];
  const root = document.createElement("div");
  root.className = "popMenuRoot";
  document.body.append(root);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const close = () => {
    clearTimeout(timer);
    root.remove();
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("resize", close);
    window.removeEventListener("wheel", onWheel, true);
  };
  root.addEventListener("popmenu-close", close);
  const onDown = (e: PointerEvent) => {
    if (!levels.some((l) => l.contains(e.target as Node)) && !(anchor instanceof HTMLElement && anchor.contains(e.target as Node))) close();
  };
  const onWheel = (e: WheelEvent) => {
    if (!levels.some((l) => l.contains(e.target as Node))) close();
  };

  /** Shows the panel for `list` at depth `depth` (closing the deeper ones), beside `side` or at the point. */
  const show = (list: MenuItem[], depth: number, place: { x: number; y: number; flipX?: number }) => {
    for (const deeper of levels.splice(depth)) deeper.remove();
    const panel = document.createElement("div");
    panel.className = "popMenu";
    panel.setAttribute("role", "menu");
    panel.dataset.depth = String(depth);
    for (const item of list) {
      if (item.separator) {
        const line = document.createElement("div");
        line.className = "popSep";
        panel.append(line);
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "popItem" + (item.children ? " hasChildren" : "");
      row.setAttribute("role", "menuitem");
      row.disabled = !!item.disabled;
      const icon = document.createElement("span");
      icon.className = "popIcon";
      const mark = () => {
        if (item.checked !== undefined) icon.innerHTML = item.checked ? '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 9.500l3.500 3.500L14 5.500"/></svg>' : "";
        else if (item.icon) icon.innerHTML = `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${item.icon}"/></svg>`;
      };
      mark();
      const label = document.createElement("span");
      label.className = "popLabel";
      label.textContent = item.label;
      row.append(icon, label);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "popHint";
        hint.textContent = item.hint;
        row.append(hint);
      }
      if (item.children) {
        const arrow = document.createElement("span");
        arrow.className = "popArrow";
        arrow.textContent = "▸";
        row.append(arrow);
      }
      if (item.remove) {
        const x = document.createElement("span");
        x.className = "popRemove";
        x.setAttribute("role", "button");
        x.setAttribute("aria-label", item.removeTitle ?? "Delete");
        x.title = item.removeTitle ?? "Delete";
        x.textContent = "×";
        x.onclick = (e) => { e.stopPropagation(); e.preventDefault(); close(); item.remove!(); };
        row.append(x);
        // Delete on the entry asks the same
        row.addEventListener("keydown", (e) => { if (e.key === "Delete") { e.preventDefault(); e.stopPropagation(); close(); item.remove!(); } });
      }
      const openChildren = () => {
        for (const sibling of panel.querySelectorAll(".popItem.open")) sibling.classList.remove("open");
        if (!item.children) {
          for (const deeper of levels.splice(depth + 1)) deeper.remove();
          return;
        }
        row.classList.add("open");
        const r = row.getBoundingClientRect();
        show(item.children, depth + 1, { x: r.right - 2, y: r.top - 5, flipX: r.left + 2 });
      };
      row.onpointerenter = () => {
        clearTimeout(timer);
        row.focus({ preventScroll: true });
        timer = setTimeout(openChildren, item.children ? OPEN_DELAY : 0);
      };
      row.onclick = (e) => {
        if (item.children) {
          openChildren();
          return;
        }
        if (item.keepOpen) {
          if (item.checked !== undefined) item.checked = !item.checked;
          mark();
          item.run?.({ ctrl: e.ctrlKey || e.metaKey });
          return;
        }
        close();
        item.run?.({ ctrl: e.ctrlKey || e.metaKey });
      };
      panel.append(row);
    }
    root.append(panel);
    levels.push(panel);
    const box = panel.getBoundingClientRect();
    let x = place.x;
    if (x + box.width > innerWidth - 4) x = place.flipX !== undefined ? place.flipX - box.width : innerWidth - box.width - 4;
    panel.style.left = `${Math.max(4, x)}px`;
    panel.style.top = `${Math.max(4, Math.min(place.y, innerHeight - box.height - 4))}px`;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      if (levels.length > 1) {
        levels.pop()!.remove();
        levels[levels.length - 1].querySelector<HTMLElement>(".popItem.open")?.classList.remove("open");
      } else close();
      return;
    }
    const panel = levels[levels.length - 1];
    const rows = [...panel.querySelectorAll<HTMLButtonElement>(".popItem:not(:disabled)")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const down = e.key === "ArrowDown";
      rows[at < 0 ? (down ? 0 : rows.length - 1) : (at + (down ? 1 : -1) + rows.length) % rows.length]?.focus();
    } else if (e.key === "ArrowRight" && rows[at]?.classList.contains("hasChildren")) {
      rows[at].click();
      levels[levels.length - 1].querySelector<HTMLElement>(".popItem")?.focus();
    } else if (e.key === "ArrowLeft" && levels.length > 1) {
      levels.pop()!.remove();
      const parent = levels[levels.length - 1].querySelector<HTMLElement>(".popItem.open");
      parent?.classList.remove("open");
      parent?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const at = anchor instanceof HTMLElement ? (() => { const r = anchor.getBoundingClientRect(); return { x: r.left, y: r.bottom + 3 }; })() : anchor;
  show(items, 0, at);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);
  window.addEventListener("wheel", onWheel, true);
  levels[0].querySelector<HTMLElement>(".popItem")?.focus({ preventScroll: true });
}
