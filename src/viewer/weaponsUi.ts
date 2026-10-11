import { showContextMenu } from "./contextMenu";
import { itemIcon } from "./itemIcons";
import { createBrowserSort, createBrowserView, makeTile, setTileImage } from "./browserView";
import { loadItemDb } from "./itemCatalog";
import { itemImageFor, itemUsableBy, slotForClass, weaponCategory, type ItemDb, type ItemInfo } from "./payload";

export interface WeaponsEls {
  search: HTMLInputElement;
  /** Row of category buttons (`data-slot`: "" for all, else a category). */
  slots: HTMLElement;
  list: HTMLElement;
  count: HTMLElement;
  clear: HTMLButtonElement;
  /** The row under the list, which gets the thumbnails / list button and the size slider. */
  foot: HTMLElement;
}

export interface WeaponsHooks {
  /** Game class name of the displayed class (`demoman`, not `demo`). */
  gameClass: () => string;
  /**
   * Called whenever the held weapon (as shown for the current class) changes. `picked` is true when the user chose it,
   * false for a refresh caused by something else such as a class switch.
   */
  changed: (held: ItemInfo | null, picked: boolean) => void;
  /** Opens just this weapon, alone, in a scene of its own. */
  inspect: (weapon: ItemInfo) => void;
}

/** Border colours by item quality, same as the cosmetics browser. */
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

const SLOT_ORDER: Record<string, number> = { primary: 0, secondary: 1, melee: 2, utility: 3 };

/**
 * Weapon browser: the weapons the displayed class can use, as an icon grid filtered by slot and text. A character
 * holds a single weapon, so picking one replaces the previous one whatever its slot; picking the held one again
 * puts it away. A weapon the new class cannot use is hidden but remembered, like cosmetics.
 */
export function createWeaponsUi(els: WeaponsEls, hooks: WeaponsHooks) {
  let db: ItemDb | null = null;
  let held: ItemInfo | null = null;
  let iconObserver: IntersectionObserver | null = null;
  /** Selected category button: a weapon category or "taunt". */
  let category = "primary";

  const shownHeld = () => (held && itemUsableBy(held, hooks.gameClass()) ? held : null);

  function render() {
    els.list.innerHTML = "";
    iconObserver?.disconnect();
    if (!db) return;
    const cls = hooks.gameClass();
    const q = els.search.value.trim().toLowerCase();
    const slot = category;
    // newest first by item id, or by name
    const order = sorter.order() === "newest" ? (a: ItemInfo, b: ItemInfo) => b.id - a.id || a.displayName.localeCompare(b.displayName) : (a: ItemInfo, b: ItemInfo) => a.displayName.localeCompare(b.displayName);
    const textMatch = (w: ItemInfo) => !q || w.displayName.toLowerCase().includes(q) || w.name.toLowerCase().includes(q);
    const matches = (category === "taunt"
      ? db.taunts.filter((t) => itemUsableBy(t, cls) && textMatch(t)).sort(order)
      : db.weapons
      .filter((w) => itemUsableBy(w, cls) && weaponCategory(slotForClass(w, cls)) === slot && textMatch(w))
            .sort((a, b) => (SLOT_ORDER[weaponCategory(slotForClass(a, cls))] ?? 9) - (SLOT_ORDER[weaponCategory(slotForClass(b, cls))] ?? 9) || order(a, b)));

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
    const current = shownHeld();
    for (const w of matches) {
      const tile = makeTile({
        title: `${w.displayName}\n${w.name} (#${w.id}) · ${slotForClass(w, cls)}${w.workshop ? " · Workshop import" : ""}`,
        quality: w.workshop ? "#70b04a" : QUALITY_COLOR[w.quality] ?? QUALITY_COLOR.unique,
        on: current?.id === w.id,
        name: w.displayName,
        sub: category === "taunt" ? "taunt" : slotForClass(w, cls),
      });
      tile.onclick = () => pick(w);
      if (category !== "taunt") {
        tile.oncontextmenu = (ev) => {
          ev.preventDefault();
          showContextMenu(ev.clientX, ev.clientY, [{ label: "Inspect", run: () => hooks.inspect(w) }]);
        };
      }
      const image = itemImageFor(w);
      if (image) {
        tile.dataset.image = image;
        iconObserver.observe(tile);
      }
      els.list.appendChild(tile);
    }
    els.count.textContent = `${matches.length} ${category === "taunt" ? "taunt" : "weapon"}${matches.length === 1 ? "" : "s"}`;
  }

  function pick(w: ItemInfo) {
    held = held?.id === w.id ? null : w;
    render();
    hooks.changed(shownHeld(), true);
  }

  createBrowserView(els.foot, els.list, "weapons");
  const sorter = createBrowserSort(els.foot, "weapons", "alpha", () => render());
  els.search.oninput = render;
  const buttons = [...els.slots.querySelectorAll<HTMLButtonElement>("button")];
  for (const b of buttons) {
    b.onclick = () => {
      category = b.dataset.slot ?? "primary";
      buttons.forEach((x) => x.classList.toggle("on", x === b));
      render();
    };
  }
  els.clear.onclick = () => {
    held = null;
    render();
    hooks.changed(null, true);
  };

  return {
    reloadCatalog(next: ItemDb) { db = next; render(); },
    /** The held item as picked, even when the displayed class cannot use it. */
    getHeld: () => held,
    /** Shows another character's held item (nothing is applied). */
    load(item: ItemInfo | null) {
      held = item;
      render();
    },
    /** The held weapon if the displayed class can use it, else null. */
    held: shownHeld,
    /** Call when the displayed class changes (or first shows). */
    async onClassChanged() {
      if (!db) {
        try {
          db = await loadItemDb();
        } catch (e) {
          els.count.textContent = `could not load items_game.txt: ${String(e)}`;
          return;
        }
      }
      render();
      hooks.changed(shownHeld(), false);
    },
  };
}
