/**
 * Styles of workshop cosmetics. The workshop importer has no styles: each zip is one model, and a style is made as a zip of its own
 * (`cighat` and `cighat_style`). They are put together here: by name (`<name>_style`, `<name>_style2`, ... are styles of `<name>`),
 * and by links set by hand in the Styles panel of an item (remembered). An item that is a style of another leaves the catalog and is
 * one of that item's styles instead.
 */
import { itemIcon } from "./itemIcons";
import type { ItemDb, ItemInfo, ItemStyleInfo } from "./payload";

const KEY = "tf2workbench.workshopStyles";

/** A style linked by hand: the workshop item that is it (its import name, lower case) and what the style is called. */
export interface StyleLink {
  name: string;
  label: string;
}

/** Linked by hand: base item (import name, lower case) -> its styles after its own, in order. */
export type StyleLinks = Record<string, StyleLink[]>;

export function loadStyleLinks(): StyleLinks {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveStyleLinks(links: StyleLinks) {
  try { localStorage.setItem(KEY, JSON.stringify(links)); } catch { /* not kept */ }
}

const BY_NAME = /^(.*)_style(\d*)$/i;

/** The styles a workshop item's name makes it: `<name>_style` -> style of `<name>`, called "Style 2" (the item's own look is 1). */
export function namedStyleOf(name: string): { base: string; order: number } | null {
  const m = BY_NAME.exec(name);
  if (!m || !m[1]) return null;
  return { base: m[1].toLowerCase(), order: m[2] ? Number(m[2]) : 1 };
}

const styleFrom = (item: ItemInfo, name: string): ItemStyleInfo => ({
  name,
  model: item.model,
  perClass: { ...item.perClass },
  skinRed: null,
  skinBlu: null,
  image: item.image,
  bodygroups: { ...item.bodygroups },
});

/** Every style of each workshop base item (by name and by hand), as [style item, label]; and which items are a style of another. */
export function workshopStyleGroups(items: ItemInfo[], links: StyleLinks): { groups: Map<ItemInfo, { item: ItemInfo; label: string; byName: boolean }[]>; styles: Set<ItemInfo> } {
  const workshop = items.filter((i) => i.workshop && i.slot !== "taunt");
  const byName = new Map(workshop.map((i) => [i.name.toLowerCase(), i] as const));
  const groups = new Map<ItemInfo, { item: ItemInfo; label: string; byName: boolean }[]>();
  const styles = new Set<ItemInfo>();
  const add = (base: ItemInfo, item: ItemInfo, label: string, named: boolean) => {
    if (base === item || styles.has(item) || styles.has(base)) return;
    const list = groups.get(base) ?? [];
    list.push({ item, label, byName: named });
    groups.set(base, list);
    styles.add(item);
  };
  // by hand first (they win over the names), in the order set
  for (const [baseName, list] of Object.entries(links)) {
    const base = byName.get(baseName);
    if (!base) continue;
    for (const l of list) {
      const item = byName.get(l.name);
      if (item) add(base, item, l.label || item.displayName, false);
    }
  }
  // then by name, in the order of their numbers (not one the schema file already made a style of the item: that one is just taken out)
  const named = workshop.map((i) => ({ i, s: namedStyleOf(i.name) })).filter((x) => x.s && byName.has(x.s.base)).sort((a, b) => a.s!.order - b.s!.order);
  const alreadyStyle = (base: ItemInfo, i: ItemInfo) => base.styles.some((st) => (i.model !== null && st.model === i.model) || (Object.keys(i.perClass).length > 0 && Object.entries(i.perClass).every(([c, m]) => st.perClass[c] === m)));
  for (const { i, s } of named) {
    const base = byName.get(s!.base)!;
    if (alreadyStyle(base, i)) styles.add(i);
    else add(base, i, s!.order <= 1 ? "Style 2" : `Style ${s!.order + 1}`, true);
  }
  return { groups, styles };
}

/** Puts the workshop items' styles together in a catalog (in place): the styles go onto their base items and leave the list. */
export function applyWorkshopStyles(db: ItemDb, links: StyleLinks = loadStyleLinks()): ItemDb {
  const { groups, styles } = workshopStyleGroups(db.items, links);
  for (const [base, list] of groups) {
    const own = base.styles.length ? base.styles : [styleFrom(base, "Style 1")];
    base.styles = [...own, ...list.map((s) => styleFrom(s.item, s.label))];
  }
  if (styles.size) db.items = db.items.filter((i) => !styles.has(i));
  return db;
}

// --- the popover ----------------------------------------------------------------------------------------------------------------------

export interface ItemStylesHost {
  /** The workshop cosmetics as they are in their zips (before their styles are put together). */
  items(): Promise<ItemInfo[]>;
  /** The links changed: the catalog is read again. */
  changed(): Promise<void>;
  /** Puts the item browser in pick mode: a click on a workshop item that `accept` allows calls `pick` instead of putting it on. */
  startPick(accept: (item: ItemInfo) => boolean, pick: (item: ItemInfo) => void): void;
  /** Ends pick mode (the pick was made, or given up). */
  endPick(): void;
}

let closeOpen: (() => void) | null = null;

/**
 * The styles of one workshop item, in a small panel at `at` (where it was asked for): its styles in order, with their icons; the name of
 * each can be edited, a style linked by hand can be dragged to another place and taken out, and "Add a style…" turns the item browser into
 * a picker (click a workshop item to make it a style of this one). `name` is the import name of the item, or of one of its styles.
 */
export function openItemStyles(host: ItemStylesHost, name: string, at: { x: number; y: number }) {
  closeOpen?.();
  const win = document.createElement("div");
  win.className = "stylesPop";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "Styles");
  win.innerHTML = `<div class="chartHead"><span class="spTitle">Styles</span><button class="chartClose" title="Close" aria-label="Close">×</button></div>
    <div class="spRows"></div>
    <div class="spFoot"><button class="spAdd">Add a style…</button><span class="chartInfo dim" role="status"></span></div>`;
  const $ = <T extends HTMLElement>(sel: string) => win.querySelector(sel) as T;
  const title = $(".spTitle"), rows = $(".spRows"), add = $<HTMLButtonElement>(".spAdd"), status = $(".chartInfo");
  let items: ItemInfo[] = [];
  let links = loadStyleLinks();
  let base: ItemInfo | null = null;
  let picking = false;

  const key = () => base!.name.toLowerCase();
  const save = () => { saveStyleLinks(links); void host.changed(); };
  /** The hand links of the item (made when the first is added). */
  const mine = () => (links[key()] ??= []);
  const icon = (el: HTMLElement, item: ItemInfo) => {
    if (!item.image) return;
    void itemIcon(item.image).then((url) => { if (url && el.isConnected) el.style.backgroundImage = `url(${url})`; });
  };

  function render() {
    if (!base) return;
    const { groups } = workshopStyleGroups(items, links);
    const group = groups.get(base) ?? [];
    title.textContent = `Styles of ${base.displayName}`;
    rows.innerHTML = "";
    const row = (item: ItemInfo, n: number) => {
      const r = document.createElement("div");
      r.className = "spRow";
      const i = document.createElement("i");
      i.className = "spIcon";
      icon(i, item);
      const num = document.createElement("span");
      num.className = "spNum dim";
      num.textContent = String(n);
      r.append(i, num);
      rows.appendChild(r);
      return r;
    };
    // the item itself is its first style
    const own = row(base, 1);
    const ownName = document.createElement("span");
    ownName.className = "spOwn";
    ownName.textContent = base.styles[0]?.name || base.displayName;
    ownName.title = `${base.name}: the item itself`;
    own.appendChild(ownName);
    let dragged: string | null = null;
    group.forEach((s, at) => {
      const r = row(s.item, at + 2);
      r.title = s.byName ? `${s.item.name}: a style by its name` : s.item.name;
      const label = document.createElement("input");
      label.type = "text";
      label.className = "spName";
      label.value = s.label;
      label.title = "What the style is called";
      label.onchange = () => {
        const text = label.value.trim() || s.label;
        const l = mine().find((x) => x.name === s.item.name.toLowerCase());
        // a style by its name that is renamed is a link from then on (it keeps its place after the others linked by hand)
        if (l) l.label = text;
        else mine().push({ name: s.item.name.toLowerCase(), label: text });
        save();
        render();
      };
      r.appendChild(label);
      if (s.byName) {
        const tag = document.createElement("span");
        tag.className = "spTag dim";
        tag.textContent = "by name";
        tag.title = "A style because of the zip's name; it stays one while the zip is called that";
        r.appendChild(tag);
        return;
      }
      // linked by hand: dragged to another place among those, and taken out
      const grip = document.createElement("span");
      grip.className = "spGrip dim";
      grip.textContent = "⋮⋮";
      grip.title = "Drag to put it in another place";
      const remove = document.createElement("button");
      remove.className = "spRemove";
      remove.textContent = "×";
      remove.title = "Not a style of it any more (it is an item of its own again)";
      remove.onclick = () => {
        links[key()] = mine().filter((x) => x.name !== s.item.name.toLowerCase());
        if (!links[key()].length) delete links[key()];
        save();
        render();
      };
      r.append(grip, remove);
      r.draggable = true;
      r.dataset.link = s.item.name.toLowerCase();
      r.ondragstart = (ev) => { dragged = r.dataset.link!; ev.dataTransfer?.setData("text/plain", dragged); r.classList.add("dragging"); };
      r.ondragend = () => { dragged = null; r.classList.remove("dragging"); rows.querySelectorAll(".spRow").forEach((x) => x.classList.remove("before", "after")); };
      r.ondragover = (ev) => {
        if (!dragged || dragged === r.dataset.link) return;
        ev.preventDefault();
        const half = ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2;
        r.classList.toggle("before", half);
        r.classList.toggle("after", !half);
      };
      r.ondragleave = () => r.classList.remove("before", "after");
      r.ondrop = (ev) => {
        if (!dragged || dragged === r.dataset.link) return;
        ev.preventDefault();
        const list = mine();
        const from = list.findIndex((x) => x.name === dragged);
        if (from < 0) return;
        const [moved] = list.splice(from, 1);
        let to = list.findIndex((x) => x.name === r.dataset.link);
        if (!r.classList.contains("before")) to++;
        list.splice(to, 0, moved);
        save();
        render();
      };
    });
    if (!picking) status.textContent = group.length ? "" : "It has no other styles yet.";
  }

  function endPick() {
    if (!picking) return;
    picking = false;
    host.endPick();
    add.textContent = "Add a style…";
    win.classList.remove("picking");
    window.removeEventListener("keydown", onPickKey, true);
    render();
  }
  const onPickKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); endPick(); } };
  add.onclick = () => {
    if (picking) { endPick(); return; }
    if (!base) return;
    picking = true;
    add.textContent = "Cancel";
    win.classList.add("picking");
    status.textContent = "Click a workshop item in the list to make it a style of this one (Esc cancels).";
    window.addEventListener("keydown", onPickKey, true);
    // what can be a style of it: a workshop cosmetic that is not it, not a style already, and has no styles of its own
    const { groups, styles } = workshopStyleGroups(items, links);
    const lowerBase = key();
    host.startPick(
      (i) => {
        const zipped = items.find((x) => x.name.toLowerCase() === i.name.toLowerCase());
        return !!zipped && zipped.name.toLowerCase() !== lowerBase && !styles.has(zipped) && !groups.has(zipped);
      },
      (i) => {
        mine().push({ name: i.name.toLowerCase(), label: i.displayName });
        endPick();
        status.textContent = `${i.displayName} is a style of it now.`;
        save();
        render();
      },
    );
  };

  const head = $(".chartHead");
  head.onpointerdown = (ev) => {
    if ((ev.target as HTMLElement).closest("button")) return;
    const r = win.getBoundingClientRect();
    const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    head.setPointerCapture(ev.pointerId);
    head.onpointermove = (m) => {
      win.style.left = `${Math.min(Math.max(0, m.clientX - dx), innerWidth - 80)}px`;
      win.style.top = `${Math.min(Math.max(0, m.clientY - dy), innerHeight - 40)}px`;
    };
    head.onpointerup = () => (head.onpointermove = null);
  };
  const close = () => { endPick(); win.remove(); closeOpen = null; };
  ($(".chartClose") as HTMLButtonElement).onclick = close;
  win.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); if (picking) endPick(); else close(); } });
  document.body.appendChild(win);
  const r = win.getBoundingClientRect();
  win.style.left = `${Math.max(4, Math.min(at.x, innerWidth - r.width - 4))}px`;
  win.style.top = `${Math.max(4, Math.min(at.y, innerHeight - r.height - 4))}px`;
  closeOpen = close;
  void host.items().then((list) => {
    items = list.filter((i) => i.workshop && i.slot !== "taunt");
    links = loadStyleLinks();
    // the item asked for, or the item it is a style of
    const { groups } = workshopStyleGroups(items, links);
    const lower = name.toLowerCase();
    base = [...groups.entries()].find(([, g]) => g.some((s) => s.item.name.toLowerCase() === lower))?.[0] ?? items.find((i) => i.name.toLowerCase() === lower) ?? null;
    if (!base) { status.textContent = "This is not a workshop cosmetic."; add.disabled = true; return; }
    render();
  });
}
