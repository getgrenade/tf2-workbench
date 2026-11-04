import { icon } from "../icons";

/** The thumbnails / list switch and the size slider of the cosmetics and weapons browsers, and the tiles they draw. */

export type BrowserMode = "grid" | "list";

interface BrowserLook {
  mode: BrowserMode;
  /** Width of a thumbnail in pixels; in the list it sets the height of a row. */
  size: number;
}

export const MIN_SIZE = 64;
export const MAX_SIZE = 180;
export const DEFAULT_SIZE = 88;
/** From this thumbnail width on, the thumbnails carry the item's name. */
export const NAMED_FROM = 104;

/** Reads a saved look; anything unusable gives the default one. */
export function parseLook(text: string | null): BrowserLook {
  try {
    const raw = text ? JSON.parse(text) : null;
    const size = Number(raw?.size);
    return {
      mode: raw?.mode === "list" ? "list" : "grid",
      size: Number.isFinite(size) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size))) : DEFAULT_SIZE,
    };
  } catch {
    return { mode: "grid", size: DEFAULT_SIZE };
  }
}

const GRID_ICON = icon("layoutGrid");
const LIST_ICON = icon("list");

/**
 * Puts a mode button and a size slider at the start of `bar`, and makes `list` follow them. The choice is kept per browser
 * (`key`) between runs.
 */
export function createBrowserView(bar: HTMLElement, list: HTMLElement, key: string) {
  const storeKey = `tf2workbench.browser.${key}`;
  let look: BrowserLook;
  try {
    look = parseLook(localStorage.getItem(storeKey));
  } catch {
    look = parseLook(null);
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "iconBtn viewToggle";
  const size = document.createElement("input");
  size.type = "range";
  size.className = "viewSize";
  size.min = String(MIN_SIZE);
  size.max = String(MAX_SIZE);
  size.step = "4";
  size.setAttribute("aria-label", "Size");
  size.title = "Size of the thumbnails (the height of the rows in the list)";
  const apply = () => {
    list.dataset.view = look.mode;
    list.style.setProperty("--tile", `${look.size}px`);
    if (look.mode === "grid" && look.size >= NAMED_FROM) list.dataset.names = "";
    else delete list.dataset.names;
    toggle.innerHTML = look.mode === "grid" ? LIST_ICON : GRID_ICON;
    toggle.title = look.mode === "grid" ? "Show a list" : "Show thumbnails";
    toggle.setAttribute("aria-label", toggle.title);
    size.value = String(look.size);
    try {
      localStorage.setItem(storeKey, JSON.stringify(look));
    } catch {
      /* the choice just is not kept */
    }
  };
  toggle.onclick = () => {
    look = { ...look, mode: look.mode === "grid" ? "list" : "grid" };
    apply();
  };
  size.oninput = () => {
    look = { ...look, size: Number(size.value) };
    apply();
  };
  bar.prepend(toggle, size);
  apply();
  return { mode: () => look.mode };
}

export type BrowserSort = "newest" | "alpha";

const NEWEST_ICON = icon("clock");
const ALPHA_ICON = icon("arrowDownAZ");

/**
 * A button at the start of `bar` that switches the order of a browser between newest first and A–Z; its icon shows the order the
 * list has now. The choice is kept per browser (`key`) between runs, and `changed` is called when it changes.
 */
export function createBrowserSort(bar: HTMLElement, key: string, fallback: BrowserSort, changed: () => void) {
  const storeKey = `tf2workbench.browser.${key}.sort`;
  let order: BrowserSort = fallback;
  try {
    const saved = localStorage.getItem(storeKey);
    if (saved === "newest" || saved === "alpha") order = saved;
  } catch {
    /* the default stays */
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "iconBtn sortToggle";
  const apply = () => {
    button.innerHTML = order === "newest" ? NEWEST_ICON : ALPHA_ICON;
    button.title = order === "newest" ? "Newest first (click for A–Z)" : "A–Z (click for newest first)";
    button.setAttribute("aria-label", button.title);
    try {
      localStorage.setItem(storeKey, order);
    } catch {
      /* the choice just is not kept */
    }
  };
  button.onclick = () => {
    order = order === "newest" ? "alpha" : "newest";
    apply();
    changed();
  };
  bar.prepend(button);
  apply();
  return { order: () => order };
}

/** One item of a browser: a picture, its name and a line under it (the list shows both; thumbnails show the name when large). */
export function makeTile(opts: { title: string; quality: string; on: boolean; name: string; sub: string; paintable?: boolean }): HTMLElement {
  const tile = document.createElement("div");
  tile.className = "tile" + (opts.on ? " on" : "");
  tile.style.setProperty("--q", opts.quality);
  tile.title = opts.title;
  const img = document.createElement("span");
  img.className = "tileImg";
  const name = document.createElement("span");
  name.className = "tileName";
  name.textContent = opts.name;
  const sub = document.createElement("span");
  sub.className = "tileSub";
  sub.textContent = opts.sub;
  tile.append(img, name, sub);
  if (opts.paintable) {
    const paint = document.createElement("i");
    paint.className = "tilePaint";
    tile.append(paint);
  }
  return tile;
}

/** Shows the loaded picture on a tile. */
export function setTileImage(tile: HTMLElement, url: string) {
  const img = tile.querySelector<HTMLElement>(".tileImg");
  if (img) img.style.backgroundImage = `url(${url})`;
}
