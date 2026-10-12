/**
 * The Props panel: the prop models of the game by folder, with a search, a picture of each, and two ways into the scene: double-click (or
 * the button) puts one in front of the camera, and dragging one onto the view puts it where it is dropped.
 */
import { searchPaths } from "../api";
import { filterProps, parsePropPaths, propFolders, type PropEntry } from "./propList";
import { propThumbnail } from "./propThumbs";

/** What a dragged tile carries: the model's path, for the view to read on drop. */
export const PROP_DRAG_TYPE = "application/x-workbench-prop";

export interface PropHost {
  /** Puts a prop in the scene: at a place of the view (client position of a drop), or in front of the camera when there is none. */
  add(path: string, at?: { clientX: number; clientY: number }): void;
}

/** The most tiles drawn at once: the rest is reached by narrowing the search (the list stays quick, and so does the page). */
const MAX_TILES = 360;

export function createPropPanel(root: HTMLElement, host: PropHost) {
  root.innerHTML = `<div class="propBar">
  <input class="text propSearch" placeholder="Search props…" spellcheck="false" />
  <button class="propAdd" title="Put the selected prop in front of the camera (or double-click it)" disabled>Add</button>
</div>
<div class="propBody">
  <div class="propFolders" role="tree"></div>
  <div class="propGrid"></div>
</div>
<div class="itemFoot"><span class="propCount dim hint"></span></div>`;
  const search = root.querySelector<HTMLInputElement>(".propSearch")!;
  const add = root.querySelector<HTMLButtonElement>(".propAdd")!;
  const folderBox = root.querySelector<HTMLElement>(".propFolders")!;
  const grid = root.querySelector<HTMLElement>(".propGrid")!;
  const count = root.querySelector<HTMLElement>(".propCount")!;

  let entries: PropEntry[] = [];
  let folder = "";
  let picked: PropEntry | null = null;
  let tries = 0;
  let loaded = false;
  let observer: IntersectionObserver | null = null;

  const pick = (entry: PropEntry | null) => {
    picked = entry;
    add.disabled = !entry;
    for (const tile of grid.querySelectorAll<HTMLElement>(".propTile")) tile.classList.toggle("on", tile.dataset.path === entry?.path);
  };

  function drawFolders() {
    const folders = propFolders(entries);
    // the subfolders of a folder show while it, or something inside it, is the one being looked at
    const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    const visible = folders.filter((f) => f.depth === 0 || folder === parentOf(f.path) || folder.startsWith(`${parentOf(f.path)}/`));
    const rows = [Object.assign(document.createElement("button"), { className: `propFolder${folder === "" ? " on" : ""}`, textContent: `All  (${entries.length})` })];
    rows[0].onclick = () => { folder = ""; refresh(); };
    for (const f of visible) {
      const b = document.createElement("button");
      b.className = `propFolder${folder === f.path ? " on" : ""}`;
      b.style.paddingLeft = `${8 + f.depth * 12}px`;
      b.textContent = `${f.name}  (${f.count})`;
      b.title = f.path;
      b.onclick = () => { folder = folder === f.path ? parentOf(f.path) : f.path; refresh(); };
      rows.push(b);
    }
    folderBox.replaceChildren(...rows);
  }

  function tile(entry: PropEntry): HTMLElement {
    const t = document.createElement("div");
    t.className = `propTile${picked?.path === entry.path ? " on" : ""}`;
    t.dataset.path = entry.path;
    t.draggable = true;
    t.title = entry.cls;
    const img = document.createElement("img");
    img.className = "propThumb";
    img.draggable = false;
    img.alt = "";
    const label = document.createElement("span");
    label.textContent = entry.name;
    t.append(img, label);
    t.onclick = () => pick(entry);
    t.ondblclick = () => host.add(entry.path);
    t.ondragstart = (e) => {
      pick(entry);
      e.dataTransfer?.setData(PROP_DRAG_TYPE, entry.path);
      e.dataTransfer?.setData("text/plain", entry.path);
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "copy"; if (img.complete && img.naturalWidth) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2); }
    };
    (t as HTMLElement & { entry?: PropEntry }).entry = entry;
    return t;
  }

  function refresh() {
    drawFolders();
    const found = filterProps(entries, search.value, folder);
    const shown = found.slice(0, MAX_TILES);
    observer?.disconnect();
    // a picture is drawn when its tile comes into view (and skipped if it has left it by the time it is its turn)
    observer = new IntersectionObserver((seen) => {
      for (const s of seen) {
        const el = s.target as HTMLElement & { entry?: PropEntry; drawn?: boolean };
        if (!s.isIntersecting || el.drawn || !el.entry) continue;
        el.drawn = true;
        const img = el.querySelector("img")!;
        void propThumbnail(el.entry.path, () => el.isConnected && el.dataset.visible === "1").then((url) => {
          if (url) img.src = url; else if (el.isConnected) el.classList.add("noThumb");
          if (!url) el.drawn = false;
        });
        observer?.unobserve(el);
      }
      for (const s of seen) (s.target as HTMLElement).dataset.visible = s.isIntersecting ? "1" : "0";
    }, { root: grid, rootMargin: "120px" });
    const tiles = shown.map(tile);
    grid.replaceChildren(...tiles);
    grid.scrollTop = 0;
    for (const t of tiles) observer.observe(t);
    count.textContent = found.length > shown.length ? `Showing ${shown.length} of ${found.length}: narrow the search for the rest` : `${found.length} prop${found.length === 1 ? "" : "s"}`;
    if (picked && !found.includes(picked)) pick(null);
  }

  search.oninput = refresh;
  add.onclick = () => { if (picked) host.add(picked.path); };

  // the file list comes from the game files, which may not be indexed yet when the panel is made: it is asked for again until it is there
  function load() {
    if (loaded) return;
    count.textContent = tries ? "Waiting for the game to be indexed…" : "Loading…";
    void searchPaths(".mdl", 300000).then((paths) => {
      const found = parsePropPaths(paths);
      if (!found.length) throw new Error("no props yet");
      loaded = true;
      entries = found;
      refresh();
    }).catch(() => {
      count.textContent = "Waiting for the game to be indexed to list its props…";
      if (++tries < 120) setTimeout(load, 2000);
    });
  }
  load();
  return { refresh, reload: () => { loaded = false; tries = 0; load(); } };
}
