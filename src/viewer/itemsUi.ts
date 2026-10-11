import { showContextMenu } from "./contextMenu";
import { loadItemDb, reloadItemDb } from "./itemCatalog";
import { itemIcon } from "./itemIcons";
import { createBrowserSort, createBrowserView, makeTile, setTileImage } from "./browserView";
import { itemImageFor, itemUsableBy, styleLabel, type ItemDb, type ItemInfo, type PaintInfo } from "./payload";

export interface ItemsEls {
  search: HTMLInputElement;
  /** Row of class-scope buttons (`data-scope`: "", "all", "multi" or "solo"). */
  scopes: HTMLElement;
  /** Cycles the sort order. */
  /** Row of equip-region buttons, rebuilt from the items the class can wear. */
  regions: HTMLElement;
  /** Toggle button: show the medals and badges in the list. */
  medals: HTMLButtonElement;
  /** Selects every equipped cosmetic (to paint them all at once). */
  selectAll: HTMLButtonElement;
  /** Reloads the workshop cosmetics (the importer's zips). */
  refresh: HTMLButtonElement;
  list: HTMLElement;
  equipped: HTMLElement;
  count: HTMLElement;
  /** The row under the list, which gets the thumbnails / list button and the size slider. */
  foot: HTMLElement;
  clear: HTMLButtonElement;
}

/** An equipped cosmetic with its (optional) paint can. */
export interface Equipped {
  item: ItemInfo;
  paint: PaintInfo | null;
  /** Index into `item.styles` (0 for items without styles). */
  style: number;
}

export interface ItemsHooks {
  /** Game class name of the displayed class (`demoman`, not `demo`). */
  gameClass: () => string;
  /** The game classes of every character that picks apply to (several when characters are selected together). */
  classes?: () => string[];
  /** An item was put on (or taken off) the displayed character: the other selected characters get the same. */
  toggled?: (item: ItemInfo, equip: boolean) => void;
  /** The paint or the style of equipped items was changed on the displayed character: the other selected characters that wear them get the same. */
  restyled?: (changes: { item: number; paint?: PaintInfo | null; style?: number }[]) => void;
  /** Everything was taken off the displayed character: the other selected characters lose theirs too. */
  cleared?: () => void;
  /** Called with the full loadout whenever it changes (items or paints). */
  apply: (loadout: Equipped[]) => Promise<void>;
  /** Whether items that share an equip region may be worn together (a setting; off: equipping one replaces the others). */
  allowOverlap: () => boolean;
  /** The item being built in the compiler while it is worn by the displayed character, or null. */
  temporary?: () => { name: string } | null;
  /** Takes the temporary item off. */
  removeTemporary?: () => void;
  /** Opens just this item, alone, in a scene of its own. */
  inspect: (item: ItemInfo) => void;
}

const MAX_ROWS = 600;

const SORTS = {
  newest: (a: ItemInfo, b: ItemInfo) => b.id - a.id || a.displayName.localeCompare(b.displayName),
  alpha: (a: ItemInfo, b: ItemInfo) => a.displayName.localeCompare(b.displayName),
};

const isSolo = (i: ItemInfo) => i.classes.length === 1;

const CLASS_LABEL: Record<string, string> = { scout: "Scout", soldier: "Soldier", pyro: "Pyro", demoman: "Demoman", heavyweapons: "Heavy", engineer: "Engineer", medic: "Medic", sniper: "Sniper", spy: "Spy" };

/** "whole_head" -> "Whole head". */
const regionLabel = (r: string) => (r.charAt(0).toUpperCase() + r.slice(1)).replace(/_/g, " ");

/** Border colours of the item qualities (the game's ClientScheme colours). */
const QUALITY_COLOR: Record<string, string> = {
  unique: "#ffd700",
  vintage: "#476291",
  genuine: "#4d7455",
  strange: "#cf6a32",
  unusual: "#8650ac",
  haunted: "#38f3ab",
  collectors: "#aa0000",
  community: "#70b04a",
  selfmade: "#70b04a",
  valve: "#a50f79",
  normal: "#b2b2b2",
  decorated: "#7d6d00",
};

const hex = (packed: number) => `#${packed.toString(16).padStart(6, "0")}`;

/** The fill of a paint's swatch: its colour, or for a team paint (Team Spirit ...) RED and BLU split along the diagonal. */
function paintFill(paint: PaintInfo): string {
  if (paint.rgb2 === undefined || paint.rgb2 === null || paint.rgb2 === paint.rgb) return hex(paint.rgb);
  return `linear-gradient(to top right, ${hex(paint.rgb)} 50%, ${hex(paint.rgb2)} 50%)`;
}
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Cosmetics browser: filter by class / slot / text, click to equip, conflicts resolved by equip region.
 * Each equipped paintable item takes its own paint from the palette (the paint cans of items_game.txt).
 */
export function createItemsUi(els: ItemsEls, hooks: ItemsHooks) {
  let db: ItemDb | null = null;
  /** Everything the user equipped, in equip order. Items the current class cannot wear are kept (hidden) so they return when switching back. */
  let loadout: Equipped[] = [];
  /** The item that palette clicks paint. */
  let activeId: number | null = null;
  let iconObserver: IntersectionObserver | null = null;
  let scope = "solo";
  /** The characters the picks go to are of different classes: only items all of them can wear are listed (the scope is All-class meanwhile). */
  const mixedClasses = () => (hooks.classes?.() ?? []).length > 1;
  const activeScope = () => (mixedClasses() ? "shared" : scope);
  let region = "";
  let showMedals = false;
  createBrowserView(els.foot, els.list, "cosmetics");
  const sorter = createBrowserSort(els.foot, "cosmetics", "newest", () => renderList());
  const scopeButtons = [...els.scopes.querySelectorAll<HTMLButtonElement>("button")];

  async function ensureDb() {
    if (db) return;
    try {
      db = await loadItemDb();
    } catch (e) {
      els.count.textContent = `could not load items_game.txt: ${String(e)}`;
    }
  }

  /** Whether two equipped items occupy conflicting equip regions (items_game `equip_conflicts`). */
  function conflicts(a: ItemInfo, b: ItemInfo): boolean {
    const table = db?.equipConflicts ?? {};
    for (const ra of a.equipRegions) {
      for (const rb of b.equipRegions) {
        if (ra === rb || table[ra]?.includes(rb) || table[rb]?.includes(ra)) return true;
      }
    }
    return false;
  }

  /** The part of the loadout that the displayed class can wear. */
  const visible = () => {
    const cls = hooks.gameClass();
    return loadout.filter((e) => itemUsableBy(e.item, cls));
  };

  function changed() {
    renderEquipped();
    renderPaintMenu();
    renderList();
    void hooks.apply(visible());
  }

  function renderEquipped() {
    els.equipped.innerHTML = "";
    const shown = visible();
    closeStyleMenu();
    for (const e of shown) {
      const card = document.createElement("div");
      card.className = "equip" + (selection.has(e.item.id) ? " active" : "");
      const dot = e.paint ? `<i class="dot" style="background:${paintFill(e.paint)}" title="${escapeHtml(e.paint.displayName)}"></i>` : "";
      card.innerHTML = `<div class="equipIcon">${dot}<b class="x" title="Remove">✕</b></div><div class="equipName">${escapeHtml(e.item.displayName)}</div>`;
      card.title = e.item.paintable ? "Click to pick a paint (Shift + click selects several)" : "Cannot be painted";
      const image = itemImageFor(e.item, e.style);
      if (image) {
        const icon = card.querySelector<HTMLElement>(".equipIcon")!;
        void itemIcon(image).then((url) => {
          if (url && card.isConnected) icon.style.backgroundImage = `url(${url})`;
        });
      }
      if (e.item.styles.length > 1) {
        const btn = document.createElement("button");
        btn.className = "styleBtn";
        btn.textContent = `${styleLabel(e.item, e.style)} ▾`;
        btn.title = "Change style";
        btn.onclick = (ev) => {
          ev.stopPropagation();
          openStyleMenu(btn, e);
        };
        card.appendChild(btn);
      }
      card.oncontextmenu = (ev) => {
        ev.preventDefault();
        showContextMenu(ev.clientX, ev.clientY, [{ label: "Inspect", run: () => hooks.inspect(e.item) }]);
      };
      card.onclick = (ev) => {
        if ((ev.target as HTMLElement).classList.contains("x")) {
          loadout = loadout.filter((x) => x.item.id !== e.item.id);
          selection.delete(e.item.id);
          if (activeId === e.item.id) activeId = visible().at(-1)?.item.id ?? null;
          changed();
        } else {
          // click an equipped item to paint it: its paint chart opens under it; Shift + click adds it to (or takes it out of) the selection
          const r = card.getBoundingClientRect();
          openPaintMenu(e.item.id, r.left, r.bottom + 4, ev.shiftKey);
        }
      };
      els.equipped.appendChild(card);
    }
    const temp = hooks.temporary?.();
    if (temp) {
      const card = document.createElement("div");
      card.className = "equip temp";
      card.innerHTML = `<div class="equipIcon"><b class="x" title="Remove">✕</b></div><div class="equipName">${escapeHtml(temp.name)}</div><div class="equipName dim">temporary</div>`;
      card.title = "The item from the Compiler tab; it stays until removed here or the compiler item is emptied";
      card.onclick = (ev) => { if ((ev.target as HTMLElement).classList.contains("x")) hooks.removeTemporary?.(); };
      els.equipped.appendChild(card);
    }
  }

  let styleMenu: HTMLElement | null = null;

  function closeStyleMenu() {
    styleMenu?.remove();
    styleMenu = null;
  }

  /** The dropdown for choosing an equipped item's style, anchored under its button. */
  function openStyleMenu(anchor: HTMLElement, e: Equipped) {
    const wasOpenFor = styleMenu?.dataset.item;
    closeStyleMenu();
    if (wasOpenFor === String(e.item.id)) return;
    const menu = document.createElement("div");
    menu.className = "styleMenu";
    menu.dataset.item = String(e.item.id);
    e.item.styles.forEach((_, i) => {
      const row = document.createElement("div");
      row.className = "styleOpt" + (i === e.style ? " on" : "");
      row.textContent = styleLabel(e.item, i);
      row.onclick = (ev) => {
        ev.stopPropagation();
        e.style = i;
        closeStyleMenu();
        changed();
        hooks.restyled?.([{ item: e.item.id, style: i }]);
      };
      menu.appendChild(row);
    });
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 170))}px`;
    menu.style.top = `${r.bottom + 2}px`;
    document.body.appendChild(menu);
    styleMenu = menu;
  }
  window.addEventListener("click", closeStyleMenu);

  // --- the paint menu: a chart of paints that opens on the item that was clicked (in the list on the right or on the model) ---
  // Several equipped items can be selected (Shift + click on their cards); a paint picked in the chart is then applied to all of them.
  // Clicking anywhere else closes the chart and clears the selection.
  let paintMenu: HTMLElement | null = null;
  const selection = new Set<number>();
  let paintOpenedAt = 0;

  function closePaintMenu() {
    const had = paintMenu !== null || selection.size > 0;
    paintMenu?.remove();
    paintMenu = null;
    selection.clear();
    if (had) renderEquipped();
  }
  window.addEventListener("click", (ev) => {
    if (!paintMenu || performance.now() - paintOpenedAt < 80 || paintMenu.contains(ev.target as Node)) return;
    closePaintMenu();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closePaintMenu();
  });

  /**
   * Opens the paint chart for an equipped item near a screen position (nothing when the item is not equipped). With `extend` the item
   * is added to the selection (or taken out of it when it is in it) and the chart stays where it is.
   */
  function openPaintMenu(itemId: number, x: number, y: number, extend = false) {
    if (!visible().some((e) => e.item.id === itemId)) return;
    closeStyleMenu();
    activeId = itemId;
    if (extend && paintMenu) {
      if (selection.has(itemId)) selection.delete(itemId);
      else selection.add(itemId);
      paintOpenedAt = performance.now();
      renderEquipped();
      renderPaintMenu();
      return;
    }
    closePaintMenu();
    selection.add(itemId);
    showPaintMenu(x, y);
  }

  /** Selects every equipped cosmetic and opens the paint chart for all of them. */
  function selectAllEquipped(x: number, y: number) {
    const all = visible();
    if (all.length === 0) return;
    closeStyleMenu();
    closePaintMenu();
    for (const e of all) selection.add(e.item.id);
    showPaintMenu(x, y);
  }

  function showPaintMenu(x: number, y: number) {
    const menu = document.createElement("div");
    menu.className = "paintMenu";
    document.body.appendChild(menu);
    paintMenu = menu;
    paintOpenedAt = performance.now();
    renderPaintMenu();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
    renderEquipped();
  }

  function renderPaintMenu() {
    const menu = paintMenu;
    const chosen = visible().filter((e) => selection.has(e.item.id));
    if (!menu || chosen.length === 0) {
      closePaintMenu();
      return;
    }
    const paintable = chosen.filter((e) => e.item.paintable);
    menu.innerHTML = "";
    const title = document.createElement("div");
    title.className = "paintTitle";
    const names = chosen.length === 1 ? chosen[0].item.displayName : `${chosen.length} cosmetics`;
    const same = paintable.length > 0 && paintable.every((e) => (e.paint?.id ?? null) === (paintable[0].paint?.id ?? null));
    title.textContent =
      paintable.length === 0
        ? `${names} cannot be painted.`
        : `Paint for ${names}: ${same ? (paintable[0].paint ? paintable[0].paint.displayName : "none") : "mixed"}`;
    menu.appendChild(title);
    if (paintable.length === 0) return;
    const palette = document.createElement("div");
    palette.className = "palette";
    const swatch = (paint: PaintInfo | null) => {
      const b = document.createElement("button");
      b.className = "swatch" + (paint === null ? " none" : "") + (same && (paintable[0].paint?.id ?? null) === (paint?.id ?? null) ? " sel" : "");
      if (paint) b.style.background = paintFill(paint);
      b.title = paint ? paint.displayName : "No paint";
      b.textContent = paint ? "" : "✕";
      b.onclick = () => {
        for (const e of paintable) e.paint = paint;
        changed();
        hooks.restyled?.(paintable.map((e) => ({ item: e.item.id, paint })));
      };
      return b;
    };
    palette.appendChild(swatch(null));
    for (const p of db?.paints ?? []) palette.appendChild(swatch(p));
    // Fill complete rows: the widest column count (6..14) that divides the swatches evenly, so no row is left half empty.
    const total = palette.childElementCount;
    let cols = 12;
    for (let c = 14; c >= 6; c--) {
      if (total % c === 0) {
        cols = c;
        break;
      }
    }
    palette.style.display = "grid";
    palette.style.gridTemplateColumns = `repeat(${cols}, 18px)`;
    palette.style.gap = "4px";
    palette.style.justifyContent = "center";
    menu.style.width = `${cols * 22 + 14}px`;
    menu.appendChild(palette);
  }

  function renderList() {
    els.list.innerHTML = "";
    if (!db) return;
    const cls = hooks.gameClass();
    scopeButtons[0].textContent = CLASS_LABEL[cls] ?? cls;
    const all = hooks.classes?.() ?? [cls];
    const mixed = all.length > 1;
    const shownScope = activeScope();
    scopeButtons.forEach((b) => {
      b.classList.toggle("on", (b.dataset.scope ?? "solo") === shownScope);
      b.disabled = mixed && b.dataset.scope !== "shared";
      b.dataset.tip ??= b.title;
      b.title = mixed && b.dataset.scope !== "shared" ? "Characters of different classes are selected: only items all of them can wear" : b.dataset.tip;
    });
    const q = els.search.value.trim().toLowerCase();
    const base = db.items.filter((i) => all.every((c) => itemUsableBy(i, c)) && (showMedals || !i.medal) && (shownScope === "workshop" ? i.workshop : !i.workshop && (shownScope === "solo" ? isSolo(i) : !isSolo(i))));
    renderRegions(base);
    const matches = base
      .filter((i) => (!region || i.equipRegions.includes(region)) && (!q || i.displayName.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)))
      .sort(SORTS[sorter.order()]);
    iconObserver?.disconnect();
    iconObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const tile = e.target as HTMLElement;
          iconObserver?.unobserve(tile);
          const image = tile.dataset.image;
          if (!image) continue;
          void itemIcon(image).then((url) => {
            if (url && tile.isConnected) setTileImage(tile, url);
          });
        }
      },
      { root: els.list, rootMargin: "200px" },
    );
    const equipped = new Set(visible().map((e) => e.item.id));
    for (const it of matches.slice(0, MAX_ROWS)) {
      const tile = makeTile({
        title: `${it.displayName}\n${it.name} (#${it.id}) · ${it.slot}`,
        quality: QUALITY_COLOR[it.quality] ?? QUALITY_COLOR.unique,
        on: equipped.has(it.id),
        name: it.displayName,
        sub: it.slot,
        paintable: it.paintable,
      });
      tile.onclick = () => toggle(it);
      tile.oncontextmenu = (ev) => {
        ev.preventDefault();
        showContextMenu(ev.clientX, ev.clientY, [{ label: "Inspect", run: () => hooks.inspect(it) }]);
      };
      if (it.image) {
        tile.dataset.image = it.image;
        iconObserver.observe(tile);
      }
      els.list.appendChild(tile);
    }
    els.count.textContent = mixed ? `${all.length} classes selected: items for all of them` : matches.length > MAX_ROWS ? `${MAX_ROWS} of ${matches.length} shown, refine the search` : "";
  }

  /** Rebuilds the region buttons from the regions present in `items` (so each shows a count and none is empty). */
  function renderRegions(items: ItemInfo[]) {
    const counts = new Map<string, number>();
    for (const i of items) for (const r of i.equipRegions) counts.set(r, (counts.get(r) ?? 0) + 1);
    if (region && !counts.has(region)) region = "";
    els.regions.innerHTML = "";
    const add = (value: string, text: string, title: string) => {
      const b = document.createElement("button");
      b.className = value === region ? "on" : "";
      b.textContent = text;
      b.title = title;
      b.onclick = () => {
        region = value;
        renderList();
      };
      els.regions.appendChild(b);
    };
    add("", "Any", "No region filter");
    for (const [r, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) add(r, `${regionLabel(r)} ${n}`, `Equip region: ${r}`);
  }

  /** A loadout with an item put on (or taken off) for a class: the same rule for every character an item is picked for. */
  function withItem(base: Equipped[], item: ItemInfo, equip: boolean, cls: string): Equipped[] {
    if (!equip) return base.filter((e) => e.item.id !== item.id);
    // Only items this class wears can conflict; hidden ones of other classes stay.
    const keep = hooks.allowOverlap() ? base : base.filter((e) => !itemUsableBy(e.item, cls) || !conflicts(e.item, item));
    return [...keep.filter((e) => e.item.id !== item.id), { item, paint: null, style: 0 }];
  }

  function toggle(item: ItemInfo) {
    const cls = hooks.gameClass();
    const equip = !visible().some((e) => e.item.id === item.id);
    loadout = withItem(loadout, item, equip, cls);
    if (!equip) {
      if (activeId === item.id) activeId = visible().at(-1)?.item.id ?? null;
    } else activeId = item.id;
    changed();
    hooks.toggled?.(item, equip);
  }

  els.search.oninput = renderList;
  for (const b of scopeButtons) {
    b.onclick = () => {
      if (mixedClasses()) return;
      scope = b.dataset.scope ?? "solo";
      renderList();
    };
  }
  els.medals.onclick = () => {
    showMedals = !showMedals;
    els.medals.classList.toggle("on", showMedals);
    els.medals.setAttribute("aria-pressed", String(showMedals));
    renderList();
  };
  els.selectAll.onclick = () => {
    const r = els.selectAll.getBoundingClientRect();
    selectAllEquipped(r.left, r.bottom + 4);
  };
  els.clear.onclick = () => {
    loadout = [];
    activeId = null;
    changed();
    hooks.cleared?.();
  };

  return {
    /** The loadout of another character with an item put on or taken off, by the rule the browser uses (nothing is shown). */
    toggleFor(state: { loadout: Equipped[]; activeId: number | null }, item: ItemInfo, equip: boolean, cls: string) {
      const next = withItem(state.loadout, item, equip, cls);
      return { loadout: next, activeId: equip ? item.id : state.activeId === item.id ? next.filter((e) => itemUsableBy(e.item, cls)).at(-1)?.item.id ?? null : state.activeId };
    },
    /** The characters the picks go to changed (a selection of several, of one class or of several): the list follows. */
    targetsChanged: renderList,
    /** Reads the catalog again (the workshop zips changed): the list shows the new items. */
    async reloadCatalog() {
      db = null;
      db = await reloadItemDb();
      renderList();
    },
    /** What a character wears: the loadout and the item the palette paints. */
    /** Redraws the equipped list (the temporary item came or went). */
    refreshEquipped: renderEquipped,
    getState: () => ({ loadout, activeId }),
    /** Opens the paint chart for an equipped item at a screen position (a click on the model). */
    openPaint: openPaintMenu,
    /** Shows another character's loadout (class, team and model are already theirs, nothing is applied). */
    load(state: { loadout: Equipped[]; activeId: number | null }) {
      loadout = state.loadout;
      activeId = state.activeId;
      closeStyleMenu();
      closePaintMenu();
      renderEquipped();
      renderList();
    },
    /** Call when the displayed class changes (or first shows): refreshes the list and reapplies the loadout. */
    async onClassChanged() {
      await ensureDb();
      const cls = hooks.gameClass();
      // Items equipped for different classes can now overlap in an equip region: the later one wins.
      const kept: Equipped[] = [];
      for (const e of [...loadout].reverse()) {
        if (!hooks.allowOverlap() && itemUsableBy(e.item, cls) && kept.some((k) => itemUsableBy(k.item, cls) && conflicts(k.item, e.item))) continue;
        kept.unshift(e);
      }
      loadout = kept;
      const shown = visible();
      if (!shown.some((e) => e.item.id === activeId)) activeId = shown.at(-1)?.item.id ?? null;
      renderEquipped();
      renderPaintMenu();
      renderList();
      await hooks.apply(visible());
    },
  };
}
