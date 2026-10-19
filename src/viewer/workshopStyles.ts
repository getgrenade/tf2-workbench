/**
 * Styles of workshop cosmetics. The workshop importer has no styles: each zip is one model, and a style is made as a zip of its own
 * (`cighat` and `cighat_style`). They are put together here: by name (`<name>_style`, `<name>_style2`, ... are styles of `<name>`),
 * and by links set by hand in the Workshop styles window (remembered). An item that is a style of another leaves the catalog and is
 * one of that item's styles instead.
 */
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

// --- the window --------------------------------------------------------------------------------------------------------------------

export interface WorkshopStylesHost {
  /** The workshop cosmetics as they are in their zips (before their styles are put together). */
  items(): Promise<ItemInfo[]>;
  /** The links changed: the catalog is read again. */
  changed(): Promise<void>;
}

let closeOpen: (() => void) | null = null;

/** The Workshop styles window: pick an item, see its styles (by name and by hand), link others as its styles by hand. */
/** `open`: the import name of the item to open the window on. */
export function openWorkshopStyles(host: WorkshopStylesHost, open?: string) {
  if (closeOpen) return;
  const win = document.createElement("div");
  win.className = "chartWindow rollWindow workshopStylesWindow";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "Workshop styles");
  win.innerHTML = `<div class="chartHead"><span>Workshop styles</span><button class="chartClose" title="Close" aria-label="Close">×</button></div>
    <div class="rollBody">
      <p class="dim hint">The importer makes one model a zip, so a style is a zip of its own. Zips named <code>&lt;name&gt;_style</code>, <code>&lt;name&gt;_style2</code> … are styles of <code>&lt;name&gt;</code> by themselves; any other can be linked to an item here. For styles with names of their own, particle effects, paint, regions and the rest, an <code>items_game.txt</code> beside the zips says it in the game's own words (see docs/WORKSHOP_SCHEMA.md).</p>
      <label class="chartRow inline">Item <select class="wsBase"></select></label>
      <h3>Its styles</h3>
      <div class="wsList"></div>
      <h3>Link another as a style</h3>
      <div class="wsAdd"><input type="search" class="wsPick" placeholder="Workshop item" spellcheck="false" /><button class="wsAddBtn">Add</button></div>
      <p class="chartInfo" role="status"></p>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => win.querySelector(sel) as T;
  const baseSel = $<HTMLSelectElement>(".wsBase"), list = $(".wsList"), pick = $<HTMLInputElement>(".wsPick"), status = $(".chartInfo");
  const names = document.createElement("datalist");
  names.id = `wsItems${Date.now()}`;
  pick.setAttribute("list", names.id);
  win.appendChild(names);
  let items: ItemInfo[] = [];
  let links = loadStyleLinks();

  const byLower = () => new Map(items.map((i) => [i.name.toLowerCase(), i] as const));
  function render() {
    const { groups, styles } = workshopStyleGroups(items, links);
    const was = baseSel.value;
    baseSel.innerHTML = "";
    // the items that can have styles: every one that is not itself a style of another
    for (const i of items.filter((x) => !styles.has(x)).sort((a, b) => a.displayName.localeCompare(b.displayName))) {
      const n = groups.get(i)?.length ?? 0;
      baseSel.add(new Option(n ? `${i.displayName} (${n + 1} styles)` : i.displayName, i.name.toLowerCase()));
    }
    if ([...baseSel.options].some((o) => o.value === was)) baseSel.value = was;
    const base = byLower().get(baseSel.value);
    list.innerHTML = "";
    if (!base) return;
    const own = document.createElement("div");
    own.className = "wsRow dim";
    own.textContent = `1 · ${base.displayName} (the item itself)`;
    list.appendChild(own);
    const group = groups.get(base) ?? [];
    group.forEach((s, at) => {
      const row = document.createElement("div");
      row.className = "wsRow";
      const label = document.createElement("input");
      label.type = "text";
      label.value = s.label;
      label.disabled = s.byName;
      label.title = s.byName ? `A style by its name (${s.item.name}); rename the zip to change it` : "What the style is called";
      label.onchange = () => {
        const mine = (links[baseSel.value] ??= []);
        const l = mine.find((x) => x.name === s.item.name.toLowerCase());
        if (l) l.label = label.value.trim();
        saveStyleLinks(links);
        void host.changed();
      };
      const what = document.createElement("span");
      what.className = "dim";
      what.textContent = `${at + 2} · ${s.item.name}${s.byName ? " (by name)" : ""}`;
      row.append(what, label);
      if (!s.byName) {
        const remove = document.createElement("button");
        remove.className = "rollRemove";
        remove.textContent = "×";
        remove.title = "Not a style of it any more";
        remove.onclick = () => {
          links[baseSel.value] = (links[baseSel.value] ?? []).filter((x) => x.name !== s.item.name.toLowerCase());
          if (!links[baseSel.value].length) delete links[baseSel.value];
          saveStyleLinks(links);
          render();
          void host.changed();
        };
        row.appendChild(remove);
      }
      list.appendChild(row);
    });
    if (!group.length) list.insertAdjacentHTML("beforeend", `<p class="dim">No other styles yet.</p>`);
    // the ones that can be linked: not this item, not a style already
    names.innerHTML = "";
    for (const i of items) if (i !== base && !styles.has(i) && !groups.has(i)) names.appendChild(new Option(i.name));
  }
  baseSel.onchange = render;
  $(".wsAddBtn").onclick = () => {
    const item = byLower().get(pick.value.trim().toLowerCase()) ?? items.find((i) => i.displayName.toLowerCase() === pick.value.trim().toLowerCase());
    if (!item) { status.textContent = "Pick a workshop item from the list."; return; }
    const base = baseSel.value;
    if (item.name.toLowerCase() === base) { status.textContent = "An item cannot be a style of itself."; return; }
    (links[base] ??= []).push({ name: item.name.toLowerCase(), label: item.displayName });
    saveStyleLinks(links);
    pick.value = "";
    status.textContent = `${item.displayName} is a style of it now.`;
    render();
    void host.changed();
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
      win.style.right = "auto";
    };
    head.onpointerup = () => (head.onpointermove = null);
  };
  const close = () => { win.remove(); closeOpen = null; };
  ($(".chartClose") as HTMLButtonElement).onclick = close;
  win.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } });
  document.body.appendChild(win);
  closeOpen = close;
  void host.items().then((list) => {
    items = list.filter((i) => i.workshop && i.slot !== "taunt");
    links = loadStyleLinks();
    if (!items.length) status.textContent = "There are no workshop cosmetics yet.";
    render();
    if (open) {
      // the item asked for: it, or the item it is a style of
      const { groups } = workshopStyleGroups(items, links);
      const base = [...groups.entries()].find(([, list]) => list.some((s) => s.item.name.toLowerCase() === open.toLowerCase()))?.[0];
      const value = (base ?? items.find((i) => i.name.toLowerCase() === open.toLowerCase()))?.name.toLowerCase();
      if (value && [...baseSel.options].some((o) => o.value === value)) { baseSel.value = value; render(); }
    }
  });
}
