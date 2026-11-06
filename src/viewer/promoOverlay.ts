/**
 * Background overlays of the promo board: a game texture (a wall, a floor, concrete, wood) tiled over a whole picture, laid faintly over
 * its backdrop. The textures are read from the game's files; the browser lists the surface folders of `materials/` and shows a preview
 * of each texture, read as it scrolls into view (a few at a time, kept once read).
 */

import { listDir, loadTextureFrames } from "../api";
import { icon } from "../icons";
import { parseTextureFrames } from "./sourceMaterials";
import type { GroundSpec, OverlaySpec } from "./promo";

/** The folders of `materials/` whose textures are surfaces that tile (walls, floors, ground); the others are props, signs, effects. */
const SURFACE = /^(brick|concrete|wood|metal|plaster|tile|tiles|stone|rock|rocks|nature|building|buildings|walls?|floors?|cliffs?|ground|dirt|sand|grass|carpet|fabric|asphalt|cobble|roof|roofs|harvest|egypt|hydro|desert|snow|ice|gravel|mud|wallpaper|ceiling|panels?)\b/i;
/** Textures that are not colour (normal maps, masks, the parts of a material that are not its picture). */
const NOT_COLOUR = /(normal|bump|_nrm|_n$|_n_|ssbump|spec|mask|_exp|detail|blend|illum|_ref|envmap|phong|_height|_dx\d|_hdr|lightwarp|_tint|_mod)/i;

let folders: Promise<string[]> | null = null;
/** The surface folders of `materials/` there are (each with its textures somewhere under it). */
export function surfaceFolders(): Promise<string[]> {
  folders ??= listDir("materials").then((l) => l.dirs.filter((d) => SURFACE.test(d)).sort());
  return folders;
}

const listed = new Map<string, Promise<string[]>>();
/** The colour textures under a folder of `materials/` (two levels down), as paths under materials/ without .vtf. */
export function texturesIn(folder: string): Promise<string[]> {
  let out = listed.get(folder);
  if (!out) {
    out = (async () => {
      const found: string[] = [];
      const walk = async (dir: string, depth: number) => {
        const l = await listDir(`materials/${dir}`);
        for (const f of l.files) if (f.name.toLowerCase().endsWith(".vtf") && !NOT_COLOUR.test(f.name.slice(0, -4))) found.push(`${dir}/${f.name.slice(0, -4)}`);
        if (depth < 2) for (const d of l.dirs) await walk(`${dir}/${d}`, depth + 1);
      };
      await walk(folder, 0);
      return found.sort();
    })();
    listed.set(folder, out);
  }
  return out;
}

/** The textures read in full (a few: each is a large picture), the last used kept. */
const full = new Map<string, Promise<HTMLCanvasElement>>();
/** A texture as a canvas (its first frame, as large as the file has it). */
export function loadTexture(path: string): Promise<HTMLCanvasElement> {
  let c = full.get(path);
  if (c) { full.delete(path); full.set(path, c); return c; }
  c = loadTextureFrames(path, 1).then((buffer) => {
    const frame = parseTextureFrames(buffer)[0];
    if (!frame) throw new Error(`could not read ${path}`);
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const data = new ImageData(new Uint8ClampedArray(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength).slice(), frame.width, frame.height);
    // (opaque: a surface's alpha is a mask of its own, not its shape)
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255;
    canvas.getContext("2d")!.putImageData(data, 0, 0);
    return canvas;
  });
  c.catch(() => full.delete(path));
  full.set(path, c);
  while (full.size > 8) full.delete(full.keys().next().value!);
  return c;
}

/** A texture tiled over w × h as an overlay says (its tiles `tile` times its own size, grey when asked). */
export function tileTexture(texture: HTMLCanvasElement, spec: OverlaySpec, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d")!;
  const pattern = ctx.createPattern(texture, "repeat")!;
  pattern.setTransform(new DOMMatrix().translate(spec.ox ?? 0, spec.oy ?? 0).rotate(spec.rot ?? 0).scale(Math.max(0.02, spec.tile)));
  if (spec.grey) ctx.filter = "grayscale(1)";
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** An overlay's image over w × h (its texture read first). */
export async function overlayImage(spec: OverlaySpec, w: number, h: number): Promise<HTMLCanvasElement> {
  if (spec.ground) return groundImage(spec, spec.ground, spec.texture ? await loadTexture(spec.texture) : null, w, h);
  return tileTexture(await loadTexture(spec.texture), spec, w, h);
}

/** Where a ground lies in a picture of w × h: its middle and its two radii (pixels). */
export function groundEllipse(g: GroundSpec, w: number, h: number) {
  const rx = Math.max(1, (g.width * w) / 2);
  return { cx: g.cx * w, cy: g.cy * h, rx, ry: Math.max(1, rx * g.depth) };
}

/**
 * A ground over w × h: its colour in its ellipse, the texture on it as a floor (turned on the floor, then squashed as deep as the
 * ellipse is, so it lies flat), all of it faded out towards the edge.
 */
export function groundImage(spec: OverlaySpec, g: GroundSpec, texture: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d")!;
  const { cx, cy, rx, ry } = groundEllipse(g, c.width, c.height);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = g.color;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  if (texture && g.texStrength > 0) {
    const pattern = ctx.createPattern(texture, "repeat")!;
    pattern.setTransform(new DOMMatrix().translate(cx + (spec.ox ?? 0), cy + (spec.oy ?? 0)).scale(1, Math.max(0.02, g.depth)).rotate(spec.rot ?? 0).scale(Math.max(0.02, spec.tile)));
    ctx.globalAlpha = g.texStrength;
    if (spec.grey) ctx.filter = "grayscale(1)";
    ctx.fillStyle = pattern;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  }
  ctx.restore();
  // the fade: solid out to (1 - softness) of the way, gone at the edge (a smooth fall, not a straight one)
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.setTransform(new DOMMatrix().translate(cx, cy).scale(rx, ry));
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const from = Math.min(0.999, Math.max(0, 1 - g.softness));
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, a = 1 - t * t * (3 - 2 * t);
    fade.addColorStop(from + (1 - from) * t, `rgba(0,0,0,${a})`);
  }
  ctx.fillStyle = fade;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  return c;
}

// --- the browser ------------------------------------------------------------------------------------------------------------------

/** The previews read so far (small), by texture. */
const previews = new Map<string, string>();
const PREVIEW = 112;

/**
 * Opens the window that picks a texture: the surface folders on the left, a search, the previews of the folder's textures. `pick` gets
 * the texture chosen (a double click, or Add).
 */
export function openTextureBrowser(pick: (texture: string) => void, current?: string) {
  document.querySelector(".ovlBrowser")?.remove();
  const box = document.createElement("div");
  box.className = "ovlBrowser";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Background overlay texture");
  box.innerHTML = `<div class="ovlCard">
    <header><h3>Background overlay</h3><input type="search" class="ovlSearch" placeholder="Search textures…" aria-label="Search textures"><button class="ovlClose" title="Close (Esc)" aria-label="Close">${icon("x")}</button></header>
    <div class="ovlBody"><nav class="ovlFolders" aria-label="Folders"></nav><div class="ovlGrid" role="listbox" aria-label="Textures"></div></div>
    <footer><span class="ovlPicked dim">Pick a texture</span><button class="primary ovlAdd" disabled>Use it</button></footer>
  </div>`;
  const $ = <T extends HTMLElement>(s: string) => box.querySelector(s) as T;
  const nav = $(".ovlFolders"), grid = $(".ovlGrid"), search = $<HTMLInputElement>(".ovlSearch"), pickedLabel = $(".ovlPicked"), add = $<HTMLButtonElement>(".ovlAdd");
  let chosen: string | null = current ?? null;
  let folder = current?.split("/")[0] ?? "";
  let list: string[] = [];

  // previews are read as they come into view, four at a time; a folder left stops the ones it had waiting
  let generation = 0;
  const queue: { path: string; img: HTMLElement; gen: number }[] = [];
  let busy = 0;
  const pump = () => {
    while (busy < 4 && queue.length) {
      const job = queue.shift()!;
      if (job.gen !== generation) continue;
      busy++;
      void preview(job.path).then((url) => { if (url) job.img.style.backgroundImage = `url(${url})`; else job.img.classList.add("bad"); }).finally(() => { busy--; pump(); });
    }
  };
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const img = e.target as HTMLElement;
      const path = img.dataset.path!;
      const known = previews.get(path);
      if (known) img.style.backgroundImage = `url(${known})`;
      else { queue.push({ path, img, gen: generation }); pump(); }
    }
  }, { root: grid, rootMargin: "200px" });

  const choose = (path: string) => {
    chosen = path;
    pickedLabel.textContent = path;
    pickedLabel.classList.remove("dim");
    add.disabled = false;
    for (const el of grid.querySelectorAll(".ovlItem")) el.classList.toggle("on", (el as HTMLElement).dataset.path === path);
  };
  const showGrid = () => {
    generation++;
    queue.length = 0;
    seen.disconnect();
    grid.replaceChildren();
    const q = search.value.trim().toLowerCase();
    const shown = q ? list.filter((p) => p.toLowerCase().includes(q)) : list;
    if (!shown.length) {
      grid.innerHTML = `<p class="dim ovlEmpty">${list.length ? "Nothing matches." : "Reading…"}</p>`;
      return;
    }
    for (const path of shown.slice(0, 600)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ovlItem";
      item.dataset.path = path;
      item.title = path;
      item.setAttribute("role", "option");
      const img = document.createElement("span");
      img.className = "ovlImg";
      img.dataset.path = path;
      const name = document.createElement("span");
      name.className = "ovlName";
      name.textContent = path.split("/").pop()!;
      item.append(img, name);
      item.classList.toggle("on", path === chosen);
      item.onclick = () => choose(path);
      item.ondblclick = () => { choose(path); done(); };
      grid.append(item);
      seen.observe(img);
    }
  };
  const openFolder = async (f: string) => {
    folder = f;
    for (const b of nav.querySelectorAll("button")) b.classList.toggle("on", (b as HTMLElement).dataset.folder === f);
    list = [];
    showGrid();
    const got = await texturesIn(f);
    if (folder !== f) return;
    list = got;
    showGrid();
  };
  void surfaceFolders().then((all) => {
    if (!all.length) { nav.innerHTML = `<p class="dim">No surface textures found (is the TF2 folder set?).</p>`; return; }
    for (const f of all) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.folder = f;
      b.textContent = f;
      b.onclick = () => void openFolder(f);
      nav.append(b);
    }
    void openFolder(all.includes(folder) ? folder : all[0]);
  });
  search.oninput = () => showGrid();
  if (chosen) choose(chosen);

  const close = () => { seen.disconnect(); generation++; box.remove(); window.removeEventListener("keydown", onKey, true); };
  const done = () => { if (!chosen) return; const c = chosen; close(); pick(c); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === "Enter" && chosen && e.target !== search) { e.preventDefault(); done(); }
  };
  add.onclick = done;
  $(".ovlClose").onclick = close;
  box.addEventListener("pointerdown", (e) => { if (e.target === box) close(); });
  window.addEventListener("keydown", onKey, true);
  document.body.append(box);
  search.focus();
}

/** A small preview of a texture (a data URL), read once. */
async function preview(path: string): Promise<string | null> {
  const known = previews.get(path);
  if (known) return known;
  try {
    const buffer = await loadTextureFrames(path, 1);
    const frame = parseTextureFrames(buffer)[0];
    if (!frame) return null;
    const src = document.createElement("canvas");
    src.width = frame.width;
    src.height = frame.height;
    const data = new ImageData(new Uint8ClampedArray(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength).slice(), frame.width, frame.height);
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255;
    src.getContext("2d")!.putImageData(data, 0, 0);
    const c = document.createElement("canvas");
    c.width = c.height = PREVIEW;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    // (its middle, square: a tall or wide texture fills the preview)
    const s = Math.min(frame.width, frame.height);
    ctx.drawImage(src, (frame.width - s) / 2, (frame.height - s) / 2, s, s, 0, 0, PREVIEW, PREVIEW);
    const url = c.toDataURL("image/jpeg", 0.8);
    previews.set(path, url);
    return url;
  } catch {
    return null;
  }
}
