import { layoutChart, type ChartLayout } from "./chartLayout";
import type { PaintChartCell, PaintChartOpts } from "./viewer";

/** A cell of the chart with the name it is listed by (in the tooltip and the list of the ones taken out). */
export interface ChartCell extends PaintChartCell {
  label: string;
}

/** What the paint chart editor asks of the program. */
export interface PaintChartHost {
  title: string;
  /** The character's team, for the "only this team" choice of team paints. */
  team: "RED" | "BLU";
  /** The cells: unpainted first when asked, then every paint (a team paint once per team, or only in the character's team). */
  cells(o: { unpainted: boolean; teams: "both" | "own" }): Promise<ChartCell[]>;
  /** Draws the cells laid out by `opts`, scaled to `w` × `h` pixels (a transparent background stays transparent). */
  render(cells: ChartCell[], opts: PaintChartOpts, w: number, h: number): ImageData;
  /** Changes whenever the view's camera moves, so the chart is drawn again only when there is something new. */
  viewStamp(): string;
  /** Shows the character's head with the item, or only the parts the scene shows (absent when the scene already shows the head). */
  showHead?(on: boolean): void;
  save(png: Blob): Promise<void>;
  closed(): void;
}

const KEY = "paintChartOptions";
const SIZES: [number, string][] = [[1280, "720p (1280 × 720)"], [1920, "1080p (1920 × 1080)"], [2560, "1440p (2560 × 1440)"], [3840, "4K (3840 × 2160)"]];
const CELLS: [number, string][] = [[1, "Square"], [4 / 3, "4:3"], [3 / 4, "3:4 (tall)"], [16 / 9, "16:9"]];
const BACKGROUNDS: [string, string, number | null][] = [["transparent", "Transparent", null], ["dark", "Dark brown", 0x2d1f1d], ["black", "Black", 0x000000], ["custom", "Custom colour", null]];
/** Also drawn again this often for a while after a change, so textures that finish loading show up. */
const REFRESH_MS = 700;
/** How long after the last change the chart keeps being drawn again (the textures a change asks for are in by then). */
const SETTLE_MS = 8000;

let closeOpen: (() => void) | null = null;

/**
 * The paint chart editor: a window beside the view with the chart drawn live from the view's camera (orbit, pan or zoom the view and
 * every cell follows), the layout controls, and Save. Click a picture to take it out; the ones taken out are listed below to put back.
 */
export function openPaintChart(host: PaintChartHost) {
  closeOpen?.();
  const state = { cols: 0, gapX: 24, gapY: 24, padding: 48, align: "center" as "center" | "left", width: 1920, cellAspect: 1, background: "transparent", custom: "#2d1f1d", unpainted: true, teams: "both" as "both" | "own", cosmeticOnly: false, head: true };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch { /* the defaults */ }
  const removed = new Set<string>();
  let cells: ChartCell[] = [];
  let shown: ChartCell[] = [];

  const background = () => (state.background === "custom" ? parseInt(state.custom.slice(1), 16) : BACKGROUNDS.find(([id]) => id === state.background)?.[2] ?? null);
  const opts = (): PaintChartOpts => ({ cols: state.cols, gapX: state.gapX, gapY: state.gapY, padding: state.padding, align: state.align, background: background(), width: state.width, height: Math.round((state.width * 9) / 16), cellAspect: state.cellAspect, cosmeticOnly: state.cosmeticOnly });

  const win = document.createElement("div");
  win.className = "chartWindow";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", host.title);
  win.innerHTML = `<div class="chartHead"><span></span><button class="chartClose" title="Close" aria-label="Close">×</button></div>
    <div class="chartBody"><div class="chartMain"><div class="chartStage"><canvas></canvas></div><div class="chartRemoved"></div></div><div class="chartSide"></div></div>`;
  const head = win.querySelector(".chartHead") as HTMLElement;
  (head.querySelector("span") as HTMLElement).textContent = host.title;
  const canvas = win.querySelector("canvas") as HTMLCanvasElement;
  const stage = win.querySelector(".chartStage") as HTMLElement;
  const removedBox = win.querySelector(".chartRemoved") as HTMLElement;
  const side = win.querySelector(".chartSide") as HTMLElement;

  // --- controls ---
  const heading = (text: string) => {
    const h = document.createElement("h3");
    h.textContent = text;
    side.appendChild(h);
  };
  const slider = (label: string, min: number, max: number, key: "cols" | "gapX" | "gapY" | "padding", show?: (n: number) => string) => {
    const row = document.createElement("label");
    row.className = "chartRow";
    const out = document.createElement("output");
    const input = document.createElement("input");
    input.type = "range"; input.min = String(min); input.max = String(max); input.step = "1"; input.value = String(state[key]);
    const text = () => (out.textContent = show ? show(state[key]) : String(state[key]));
    input.oninput = () => { state[key] = Number(input.value); text(); changed(); };
    text();
    row.append(label, out, input);
    side.appendChild(row);
  };
  const choice = <T extends string | number>(label: string, options: [T, string][], get: () => T, set: (value: T) => void, rebuild = false) => {
    const row = document.createElement("label");
    row.className = "chartRow inline";
    const select = document.createElement("select");
    options.forEach(([, text], i) => select.add(new Option(text, String(i))));
    select.value = String(Math.max(0, options.findIndex(([value]) => value === get())));
    select.onchange = () => { set(options[Number(select.value)][0]); if (rebuild) void rebuildCells(); else changed(); };
    row.append(label, select);
    side.appendChild(row);
  };
  const check = (label: string, get: () => boolean, set: (on: boolean) => void, rebuild: boolean) => {
    const row = document.createElement("label");
    row.className = "chartRow inline check";
    const box = document.createElement("input");
    box.type = "checkbox"; box.checked = get();
    box.onchange = () => { set(box.checked); if (rebuild) void rebuildCells(); else changed(); };
    row.append(box, label);
    side.appendChild(row);
  };

  heading("Paints");
  check("Unpainted first", () => state.unpainted, (on) => (state.unpainted = on), true);
  choice("Team paints", [["both", "Both teams"], ["own", `${host.team} only`]], () => state.teams, (value) => (state.teams = value), true);
  if (host.showHead) {
    host.showHead(state.head);
    check("Show the head", () => state.head, (on) => { state.head = on; host.showHead!(on); }, false);
  }
  check("Cosmetic only (no head or body)", () => state.cosmeticOnly, (on) => (state.cosmeticOnly = on), false);
  heading("Layout");
  slider("Columns", 0, 16, "cols", (n) => (n === 0 ? "Auto" : String(n)));
  slider("Gap across", 0, 200, "gapX");
  slider("Gap down", 0, 200, "gapY");
  slider("Edge margin", 0, 300, "padding");
  choice("Align", [["center", "Centre"], ["left", "Left"]], () => state.align, (value) => (state.align = value));
  choice("Cell shape", CELLS, () => state.cellAspect, (value) => (state.cellAspect = value));
  heading("Picture");
  choice("Size (16:9)", SIZES, () => state.width, (value) => (state.width = value));
  choice("Background", BACKGROUNDS.map(([id, text]) => [id, text] as [string, string]), () => state.background, (value) => (state.background = value));
  const colour = document.createElement("input");
  colour.type = "color";
  colour.className = "chartColour";
  colour.value = state.custom;
  colour.oninput = () => { state.custom = colour.value; changed(); };
  side.appendChild(colour);
  const info = document.createElement("div");
  info.className = "dim hint chartInfo";
  side.appendChild(info);
  const hint = document.createElement("div");
  hint.className = "dim hint";
  hint.textContent = "Orbit, pan and zoom the main view: the chart follows. Click a picture here to take it out.";
  side.appendChild(hint);
  const buttons = document.createElement("div");
  buttons.className = "btns";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.textContent = "Save PNG…";
  buttons.append(closeBtn, saveBtn);
  side.appendChild(buttons);

  // --- the preview: drawn from the view's camera when it moves or a setting changes; the hover outline is drawn over the last picture ---
  let layout: ChartLayout | null = null;
  let picture: ImageData | null = null;
  let hover = -1;
  let dirty = true;
  let stamp = "";
  let drawnAt = 0;

  function overlay() {
    const ctx = canvas.getContext("2d")!;
    if (picture) ctx.putImageData(picture, 0, 0);
    if (!layout || hover < 0 || !layout.rects[hover]) return;
    const r = layout.rects[hover], k = canvas.width / layout.width;
    ctx.strokeStyle = "#ffffffe6";
    ctx.lineWidth = Math.max(1, Math.round(1.5 * devicePixelRatio));
    ctx.strokeRect(r.x * k + ctx.lineWidth / 2, r.y * k + ctx.lineWidth / 2, r.w * k - ctx.lineWidth, r.h * k - ctx.lineWidth);
  }

  function draw() {
    const o = opts();
    const w = stage.clientWidth - 2, h = stage.clientHeight - 2;
    if (w <= 0 || h <= 0) return;
    const scale = Math.min(w / o.width, h / o.height);
    const cssW = Math.max(1, Math.floor(o.width * scale)), cssH = Math.max(1, Math.floor(o.height * scale));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * devicePixelRatio);
    canvas.height = Math.round(cssH * devicePixelRatio);
    layout = layoutChart(shown.length, o.cellAspect, o);
    picture = shown.length ? host.render(shown, o, canvas.width, canvas.height) : null;
    if (!picture) canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    overlay();
  }

  let raf = 0;
  /** Until when the chart is drawn again now and then with nothing changed (after that it rests, so an open window costs nothing). */
  let settleUntil = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const s = host.viewStamp();
    if (dirty || s !== stamp) settleUntil = now + SETTLE_MS;
    else if (now > settleUntil || now - drawnAt < REFRESH_MS) return;
    dirty = false;
    stamp = s;
    drawnAt = now;
    draw();
  };

  /** A setting changed: the list, the info line and the preview follow. */
  function changed() {
    shown = cells.filter((c) => !removed.has(c.label));
    hover = -1;
    const o = opts();
    colour.hidden = state.background !== "custom";
    stage.classList.toggle("clear", o.background === null);
    const l = layoutChart(shown.length, o.cellAspect, o);
    info.textContent = `${shown.length} picture${shown.length === 1 ? "" : "s"}, ${l.cols} column${l.cols === 1 ? "" : "s"} × ${l.rows} row${l.rows === 1 ? "" : "s"}, ${o.width} × ${o.height} px (16:9)`;
    saveBtn.disabled = shown.length === 0;
    removedBox.replaceChildren();
    if (removed.size) {
      const label = document.createElement("span");
      label.className = "dim";
      label.textContent = `Removed (${removed.size}), click to put back: `;
      removedBox.appendChild(label);
      for (const name of cells.map((c) => c.label).filter((l) => removed.has(l))) {
        const chip = document.createElement("button");
        chip.textContent = name;
        chip.onclick = () => { removed.delete(name); changed(); };
        removedBox.appendChild(chip);
      }
      const all = document.createElement("button");
      all.textContent = "Put all back";
      all.onclick = () => { removed.clear(); changed(); };
      removedBox.appendChild(all);
    }
    dirty = true;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not kept */ }
  }
  async function rebuildCells() {
    cells = await host.cells({ unpainted: state.unpainted, teams: state.teams });
    if (win.isConnected) changed();
  }

  const slotAt = (ev: MouseEvent) => {
    if (!layout) return -1;
    const box = canvas.getBoundingClientRect();
    const x = ((ev.clientX - box.left) / box.width) * layout.width;
    const y = ((ev.clientY - box.top) / box.height) * layout.height;
    return layout.rects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  };
  canvas.onpointermove = (ev) => {
    const slot = slotAt(ev);
    if (slot === hover) return;
    hover = slot;
    canvas.title = slot >= 0 ? `${shown[slot].label}: click to take it out` : "";
    overlay();
  };
  canvas.onpointerleave = () => { hover = -1; overlay(); };
  canvas.onclick = (ev) => {
    const slot = slotAt(ev);
    if (slot < 0) return;
    removed.add(shown[slot].label);
    changed();
  };

  // the window is moved by its title bar and resized from its corner; it stays clear of the view so the view can be turned
  head.onpointerdown = (ev) => {
    if ((ev.target as HTMLElement).closest("button")) return;
    const box = win.getBoundingClientRect();
    const dx = ev.clientX - box.left, dy = ev.clientY - box.top;
    head.setPointerCapture(ev.pointerId);
    head.onpointermove = (m) => {
      win.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, m.clientX - dx))}px`;
      win.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, m.clientY - dy))}px`;
      win.style.right = "auto";
    };
    head.onpointerup = () => { head.onpointermove = null; head.onpointerup = null; };
  };

  const close = () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    win.remove();
    closeOpen = null;
    host.closed();
  };
  (head.querySelector(".chartClose") as HTMLButtonElement).onclick = close;
  closeBtn.onclick = close;
  win.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } });
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      const o = opts();
      const full = host.render(shown, o, o.width, o.height);
      const out = document.createElement("canvas");
      out.width = full.width;
      out.height = full.height;
      out.getContext("2d")!.putImageData(full, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (blob) await host.save(blob);
    } finally {
      saveBtn.disabled = shown.length === 0;
    }
  };

  document.body.appendChild(win);
  const resize = new ResizeObserver(() => (dirty = true));
  resize.observe(stage);
  closeOpen = close;
  void rebuildCells().then(() => { raf = requestAnimationFrame(tick); });
}

/** Closes the paint chart editor if it is open. */
export function closePaintChart() {
  closeOpen?.();
}
