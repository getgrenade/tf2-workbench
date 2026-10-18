/**
 * The Promo tab: the pictures of a promo set as thumbnails across the top; the one picked, large below them, where its shots are edited
 * by hand (click one to select it, drag to move it, the wheel to size it, right-drag to turn the camera round it, which takes it again
 * live in the promo scene); on the right the picked picture's settings and the selected shot's; on the left the look every picture
 * shares (the backdrop and the border stroke). Export writes the pictures at full size.
 */
import { showContextMenu } from "./contextMenu";
import { rotateLightDirection } from "./lighting";
import { DEFAULT_SHOT_EFFECTS, solidOf } from "./promo";
import { DEFAULT_CHART, DEFAULT_GLOW, DEFAULT_STROKE, DEFAULT_TEXT, TEXT_FONTS, layerPivot, layerRect, turnPoint, measureContent, opaqueRect, randomBackdrop, refreshText, textLayer, type ChartCellRect, renderPicture, type Backdrop, type BoardLook, type PromoLayer, type PromoPicture, type ShotSpec } from "./promo";

export interface BoardHost {
  /** Writes every picture (asks where); resolves to what to say. */
  /** Writes the pictures to a folder the user picks: as PNGs, or as layered Photoshop files. */
  exportAll(pictures: PromoPicture[], look: BoardLook, format?: "png" | "psd"): Promise<string>;
  /** Takes a layer's shot again as its spec now says (in the promo scene), replacing its image. */
  retake(layer: PromoLayer): Promise<void>;
  /** A small picture through a layer's camera as its spec now says (w × h), to aim it by. */
  cameraView(layer: PromoLayer, w: number, h: number): Promise<HTMLCanvasElement>;
  /** Rolls a shot's pose again (a random taunt or animation; its spec changes; take it again after). */
  repose(spec: ShotSpec): Promise<void>;
  /** The taunts and animations a shot's character can be posed from (ids as `ShotSpec.poseOf`). */
  poses(spec: ShotSpec): Promise<{ taunts: { id: string; label: string }[]; sequences: { id: string; label: string }[] }>;
  /** Poses a shot's character from a taunt or an animation, at a point of it (0..1). */
  setPose(spec: ShotSpec, id: string, at: number): Promise<void>;
  /** The bodygroups of a shot's character (the class model's parts that can switch): how many models each has, and what the cosmetics set. */
  bodygroups(spec: ShotSpec): Promise<{ name: string; count: number; byItems: number | null }[]>;
  /**
   * Opens a shot's character in the 3D view, as the shot has it, to change anything about it there; resolves when the board is shown
   * again: true when the shot was set from it (take it again), false when that was cancelled.
   */
  editIn3D(layer: PromoLayer): Promise<boolean>;
  /** Rolls a line-up shot's loadout again (its spec changes; take it again after). */
  reroll(spec: ShotSpec): Promise<void>;
  /** The paints, for the choice of a worn item's paint. */
  paints(): Promise<{ id: number; name: string }[]>;
  /** Where the view's directional light comes from now (degrees): what a shot's own light starts from. */
  lightDirection(): { azimuth: number; elevation: number };
  /** The board changed (a layer moved, a shot taken again, a text edited): what keeps it between runs writes it again. */
  changed(): void;
  /** Opens the window that makes a new set. */
  newSet(): void;
}

/** The thumbnails are this tall (CSS pixels; drawn at twice that for sharpness). */
const THUMB_H = 120;
/** (the looks of earlier versions are not carried over: a radial light and slanted gradients, then a thin border inset from the edge) */
const LOOK_KEY = "promoLook3";
/** How far a paint chart's camera zooms in: past filling each picture (2.5 times), cropping the item to a detail. */
const CHART_ZOOM = 2.5;
/** The corner handles of the selected shot are this big (CSS pixels). */
const HANDLE = 10;
/** The turning handle stands this far above the top of the transform box (CSS pixels). */
const ROTATE_GAP = 28;
/** Shift snaps a turn to this many degrees. */
const ROTATE_SNAP = 15;
const corners = (r: { x: number; y: number; w: number; h: number }): [number, number][] => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];

/** Right-drag turns the camera this many degrees per pixel. */
const TURN_PER_PIXEL = 0.4;

/** The keys of the boards (undo and redo, copy and paste, delete), caught before the view's own; a board that is not showing lets them by. */
const boardKeys = new Set<(ev: KeyboardEvent) => void>();
window.addEventListener("keydown", (ev) => { for (const keys of boardKeys) keys(ev); }, true);

let look: BoardLook = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null");
    if (saved?.backdrop?.from && saved?.stroke) {
      const stroke = saved.stroke.mode ? { ...DEFAULT_STROKE, ...saved.stroke } : { ...DEFAULT_STROKE, width: saved.stroke.width ?? DEFAULT_STROKE.width, inset: saved.stroke.inset ?? DEFAULT_STROKE.inset };
      return { backdrop: { ...randomBackdrop(), ...saved.backdrop }, stroke, glow: { ...DEFAULT_GLOW, ...saved.glow }, effects: { ...DEFAULT_SHOT_EFFECTS, ...saved.effects, shadow: { ...DEFAULT_SHOT_EFFECTS.shadow, ...saved.effects?.shadow } } };
    }
  } catch { /* the defaults */ }
  return { backdrop: randomBackdrop(), stroke: { ...DEFAULT_STROKE }, glow: { ...DEFAULT_GLOW }, effects: structuredClone(DEFAULT_SHOT_EFFECTS) };
})();
const keepLook = () => { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* not kept */ } };

/** Shows a set's pictures as a board in `root`; what comes back lets go of what the board holds outside its root (when it is closed). */
export function showBoard(root: HTMLElement, title: string, pictures: PromoPicture[], host: BoardHost): () => void {
  root.innerHTML = `<div class="promoBoard">
    <aside class="promoSide">
      <h2 class="promoTitle"></h2>
      <h3>Backdrop of every picture</h3>
      <div class="promoLookBackdrop"></div>
      <div class="btns"><button class="promoShuffle" title="Another random neutral gradient">Shuffle</button></div>
      <h3>Border of every picture</h3>
      <div class="promoLookStroke"></div>
      <h3>Dark glow round the characters</h3>
      <div class="promoLookGlow"></div>
      <h3>3D effects in the shots</h3>
      <div class="promoLookFx"></div>
      <div class="btns promoSideBtns"><button class="promoNew" title="Make the pictures of another set">New set…</button><button class="promoExportPsd" title="Every picture as a Photoshop file, each layer of it a layer (texts editable, the glow and the text outline and shadow as layer effects)">Export PSDs…</button><button class="primary promoExportAll">Export all…</button></div>
      <p class="chartInfo promoStatus" role="status"></p>
    </aside>
    <main class="promoCenter">
      <div class="promoThumbs" role="listbox" aria-label="Pictures"></div>
      <div class="promoStage"><canvas class="promoPreview"></canvas></div>
      <p class="promoHelp dim">Click a shot to select it (Shift-click for more) · drag to move · corners or wheel to size · right-drag to turn the camera round it · click a paint of a chart to take it out · Ctrl+C, Ctrl+V puts a layer into another picture, linked (Ctrl+Shift+V: a copy) · Delete takes it out</p>
    </main>
    <aside class="promoInspector"></aside>
  </div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  $(".promoTitle").textContent = title;
  const thumbsBox = $(".promoThumbs"), stage = $(".promoStage"), preview = $<HTMLCanvasElement>(".promoPreview");
  const inspector = $(".promoInspector"), status = $(".promoStatus");
  const thumbs = new Map<PromoPicture, HTMLCanvasElement>();
  let picked: PromoPicture | null = null;
  /** The shot whose controls the panel shows (the last one clicked), and every shot selected with it (Shift-click adds one). */
  let layerPicked: PromoLayer | null = null;
  let selection: PromoLayer[] = [];
  /** The selected shots that show (the ones moved and sized together). */
  const selected = () => (picked ? selection.filter((l) => picked!.layers.includes(l) && !l.hidden && !l.chart) : []);
  /** The box round what is visible of the selected shots. */
  const selectionRect = () => {
    const rs = selected().map(opaqueRect);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
  };
  const selectOnly = (l: PromoLayer | null) => { layerPicked = l; selection = l ? [l] : []; };
  /** The corners of what is visible of a layer, turned as it is (top left, top right, bottom left, bottom right). */
  const turnedCorners = (l: PromoLayer): [number, number][] => {
    const piv = layerPivot(l);
    return corners(opaqueRect(l)).map(([x, y]) => turnPoint(x, y, piv, l.rotation ?? 0));
  };
  /**
   * The transform box of the selection: its corners (the handles that size it), its middle, the turning handle above its top and the
   * point of the top it hangs from. A lone shot's box turns with it; several shots have the upright box round all of them.
   */
  const transformBox = () => {
    const sel = selected();
    if (!sel.length) return null;
    const gap = ROTATE_GAP / previewScale;
    if (sel.length === 1) {
      const l = sel[0], o = opaqueRect(l), piv = layerPivot(l), rot = l.rotation ?? 0;
      return { corners: turnedCorners(l), mid: piv, top: turnPoint(o.x + o.w / 2, o.y, piv, rot), rotate: turnPoint(o.x + o.w / 2, o.y - gap, piv, rot) };
    }
    const pts = sel.flatMap(turnedCorners);
    const x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0])), y0 = Math.min(...pts.map((q) => q[1])), y1 = Math.max(...pts.map((q) => q[1]));
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return { corners: corners(r), mid: [x0 + r.w / 2, y0 + r.h / 2] as [number, number], top: [x0 + r.w / 2, y0] as [number, number], rotate: [x0 + r.w / 2, y0 - gap] as [number, number] };
  };

  // --- drawing ---
  const thumbScale = (p: PromoPicture) => (THUMB_H * 2) / p.h;
  /** Draws the large preview of the picked picture, fitted to the stage, with the selected shot outlined (the outline is not exported). */
  function drawPreview() {
    const p = picked;
    if (!p) return;
    const pr = window.devicePixelRatio || 1;
    // the stage's room inside its padding: a preview bigger than that would be centred off its top
    const cs = getComputedStyle(stage);
    const roomW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const roomH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    // one scale for every picture, the largest of them fitted: a 512 × 512 thumbnail shows at its size beside a 1920 × 1080 one
    const maxW = Math.max(...pictures.map((q) => q.w)), maxH = Math.max(...pictures.map((q) => q.h));
    const k = Math.max(0.01, Math.min(roomW / maxW, roomH / maxH));
    renderPicture(preview, p, look, k * pr);
    preview.style.width = `${p.w * k}px`;
    preview.style.height = `${p.h * k}px`;
    previewScale = k;
    if (hovered) {
      // the paint the pointer is on: a click takes it out of the chart
      const ctx = preview.getContext("2d")!;
      ctx.save();
      ctx.setTransform(k * pr, 0, 0, k * pr, 0, 0);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 2 / k;
      ctx.strokeRect(hovered.x, hovered.y, hovered.w, hovered.h);
      ctx.restore();
    }
    const box = transformBox();
    if (box) {
      // the selected shots: an outline round what is visible of each (turned with it), and the transform box: a handle at each corner
      // to size them by, and one above to turn them
      const ctx = preview.getContext("2d")!;
      ctx.save();
      ctx.setTransform(k * pr, 0, 0, k * pr, 0, 0);
      const poly = (pts: [number, number][]) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const i of [1, 3, 2]) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.stroke();
      };
      ctx.strokeStyle = "rgba(255,170,60,0.95)";
      ctx.lineWidth = 2 / k;
      ctx.setLineDash([8 / k, 6 / k]);
      for (const l of selected()) poly(turnedCorners(l));
      ctx.setLineDash([]);
      if (selected().length > 1) {
        ctx.strokeStyle = "rgba(255,170,60,0.5)";
        poly(box.corners);
      }
      ctx.strokeStyle = "rgba(255,170,60,0.95)";
      ctx.beginPath();
      ctx.moveTo(box.top[0], box.top[1]);
      ctx.lineTo(box.rotate[0], box.rotate[1]);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,170,60,0.95)";
      const hs = HANDLE / k;
      for (const [hx, hy] of box.corners) ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.beginPath();
      ctx.arc(box.rotate[0], box.rotate[1], hs * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  /** The size of the preview over the picture's, as last drawn. */
  let previewScale = 1;
  /** The paint of a chart under the pointer (in the picture's pixels), outlined. */
  let hovered: { x: number; y: number; w: number; h: number } | null = null;
  /** The paint of a chart layer under a point: its label and where it is drawn. */
  function cellAt(x: number, y: number): { layer: PromoLayer; cell: ChartCellRect; rect: { x: number; y: number; w: number; h: number } } | null {
    for (const l of [...(picked?.layers ?? [])].reverse()) {
      if (l.hidden || !l.chart || !l.cells) continue;
      const r = layerRect(l);
      for (const c of l.cells) {
        const rect = { x: r.x + c.x * r.w, y: r.y + c.y * r.h, w: c.w * r.w, h: c.h * r.h };
        if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return { layer: l, cell: c, rect };
      }
    }
    return null;
  }
  const draw = (p: PromoPicture) => {
    const c = thumbs.get(p);
    if (c) renderPicture(c, p, look, thumbScale(p));
    if (p === picked) drawPreview();
  };
  const drawAll = () => pictures.forEach(draw);
  const resizer = new ResizeObserver(() => drawPreview());
  resizer.observe(stage);

  // --- taking shots again, live: one at a time, always the latest change ---
  /** The other layers that share a layer's shot (none when it is not shared). */
  let wheelTimer = 0;
  /**
   * Shots that were sized up are taken again in 3D at their new size (sized down, the larger rendering they have is kept): drawn
   * larger from the same rendering they would blur.
   */
  function sharpen(p: PromoPicture, shots: PromoLayer[]) {
    for (const l of shots) {
      if (l.text) {
        void refreshText(l).then(() => { measureContent(l); draw(p); });
        continue;
      }
      const spec = l.shot ?? l.chart;
      if (!spec) continue;
      const want = Math.min(3, Math.max(1, l.scale));
      if (Math.abs(want - (spec.resolution ?? 1)) < 0.05) continue;
      spec.resolution = want;
      retake(p, l);
    }
  }
  /** Sizes a shot so that the point `mid` of what is visible of it stays where it is. */
  const sizeAbout = (l: PromoLayer, scale: number, mid: readonly [number, number]) => {
    const before = opaqueRect(l);
    const fx = (mid[0] - before.x) / (before.w || 1), fy = (mid[1] - before.y) / (before.h || 1);
    l.scale = scale;
    const after = opaqueRect(l);
    l.dx += Math.round(mid[0] - (after.x + fx * after.w));
    l.dy += Math.round(mid[1] - (after.y + fy * after.h));
  };
  /** A shared shot sits the same in every picture that shares it: its place, size and showing go to the others (redrawn). */
  const placeShared = (l: PromoLayer) => {
    for (const [q, x] of instancesOf(l)) {
      x.dx = l.dx; x.dy = l.dy; x.scale = l.scale; x.hidden = l.hidden; x.rotation = l.rotation;
      draw(q);
    }
  };
  const instancesOf = (l: PromoLayer) => (l.link && l.shared ? pictures.flatMap((p) => p.layers.map((x) => [p, x] as const)).filter(([, x]) => x !== l && x.link === l.link && x.shared) : []);
  let running = false;
  /** Whether a shot taken again changed what the panel shows; whether a button is held (a slider dragged), and the panel waits. */
  let panelStale = false, pointerHeld = false, panelLater = false;
  root.addEventListener("pointerdown", () => (pointerHeld = true), true);
  const released = () => {
    pointerHeld = false;
    if (panelLater) { panelLater = false; if (layerPicked) showLayer(); }
  };
  window.addEventListener("pointerup", released);
  // what this board holds on the window goes when it is closed (or its pictures would stay alive with it)
  const dispose = () => { window.removeEventListener("pointerup", released); resizer.disconnect(); boardKeys.delete(keys); };
  const waiting = new Map<PromoLayer, { p: PromoPicture; before?: () => Promise<void> }>();
  /** The board's other charts of the same item (its other styles), each with its picture, that keep in step with this one. */
  const chartSiblings = (l: PromoLayer) => {
    const c = l.chart;
    if (!c || c.sync === false) return [];
    return pictures.flatMap((q) => q.layers.map((x) => [q, x] as const))
      .filter(([, x]) => x !== l && x.chart && x.chart !== c && x.chart.sync !== false && x.chart.item === c.item && x.chart.role === c.role);
  };
  function retake(p: PromoPicture, l: PromoLayer, before?: () => Promise<void>) {
    // a chart's change goes to its other styles' charts too (the camera, the paints, the layout; each keeps its style)
    if (l.chart && !before) {
      const c = l.chart;
      for (const [q, x] of chartSiblings(l)) {
        const s = x.chart!;
        if (JSON.stringify([s.yaw, s.pitch, s.fill, s.panX, s.panY, s.light, s.options]) === JSON.stringify([c.yaw, c.pitch, c.fill, c.panX, c.panY, c.light, c.options])) continue;
        Object.assign(s, { yaw: c.yaw, pitch: c.pitch, fill: c.fill, panX: c.panX, panY: c.panY, light: c.light ? { ...c.light } : undefined, options: structuredClone(c.options) });
        queueRetake(q, x);
      }
    }
    queueRetake(p, l, before);
  }
  function queueRetake(p: PromoPicture, l: PromoLayer, before?: () => Promise<void>) {
    const queued = waiting.get(l);
    // a change made while one waits replaces it (keeping a re-roll that was asked for)
    waiting.set(l, { p, before: before ?? queued?.before });
    void pump();
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (waiting.size) {
        const [l, job] = waiting.entries().next().value!;
        waiting.delete(l);
        status.textContent = "Taking the shot again…";
        try {
          if (job.before) {
            const was = snapshot();
            await job.before();
            // in a press or a drag, the whole of it is one step (the press's own, committed once the shots are taken)
            if (was.key !== snapshot().key && !pending) pushUndo(was);
            panelStale = true; // a new outfit: the panel lists what it wears
          }
          await host.retake(l);
          measureContent(l);
          host.changed();
          // a shared shot is the same picture everywhere it is used
          for (const [q, x] of instancesOf(l)) { x.image = l.image; x.content = l.content; x.opaque = l.opaque; x.cells = l.cells; draw(q); }
          draw(job.p);
          status.textContent = "";
        } catch (err) {
          status.textContent = `Could not take it again: ${String(err)}`;
        }
      }
    } finally {
      running = false;
    }
    // a press that ended while its shots were being taken: its step, now that they are
    if (commitAfterShots && !waiting.size && !pointerHeld) { commitAfterShots = false; commit(); }
    // the panel is drawn again only when what it shows changed, and not under a control being dragged (that would drop the drag)
    if (panelStale && layerPicked) {
      if (pointerHeld) panelLater = true;
      else showLayer();
    }
    panelStale = false;
  }

  // --- the shared look ---
  const field = (box: HTMLElement, label: string, input: HTMLElement) => {
    const row = document.createElement("label");
    row.className = "chartRow inline promoField";
    row.append(label, input);
    box.appendChild(row);
    return row;
  };
  const range = (min: number, max: number, step: number, value: number, onInput: (v: number) => void) => {
    const i = document.createElement("input");
    i.type = "range";
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(value);
    i.oninput = () => onInput(Number(i.value));
    return i;
  };
  const colour = (value: string, onInput: (v: string) => void) => {
    const i = document.createElement("input");
    i.type = "color";
    i.value = value;
    i.oninput = () => onInput(i.value);
    return i;
  };
  function changedLook() {
    keepLook();
    drawAll();
  }
  /** The backdrop controls, for the shared one or a picture's own. */
  function backdropFields(box: HTMLElement, b: () => Backdrop, changed: () => void) {
    box.innerHTML = "";
    const set = (f: (x: Backdrop) => void) => { f(b()); changed(); };
    field(box, "From", colour(b().from, (v) => set((x) => (x.from = v))));
    field(box, "To", colour(b().to, (v) => set((x) => (x.to = v))));
    field(box, "Angle", range(0, 360, 1, b().angle, (v) => set((x) => (x.angle = v))));
    field(box, "Light", colour(b().glow, (v) => set((x) => (x.glow = v))));
    field(box, "Light amount", range(0, 0.8, 0.01, b().glowAmount, (v) => set((x) => (x.glowAmount = v))));
    field(box, "Dark corners", range(0, 0.8, 0.01, b().vignette, (v) => set((x) => (x.vignette = v))));
  }
  const lookBackdrop = $(".promoLookBackdrop");
  const showLookBackdrop = () => backdropFields(lookBackdrop, () => look.backdrop, changedLook);
  showLookBackdrop();
  $(".promoShuffle").onclick = () => { look.backdrop = randomBackdrop(); showLookBackdrop(); changedLook(); };
  const strokeBox = $(".promoLookStroke");
  function showLookStroke() {
    strokeBox.innerHTML = "";
    const show = document.createElement("input");
    show.type = "checkbox";
    show.checked = look.stroke.on;
    show.onchange = () => { look.stroke.on = show.checked; changedLook(); };
    field(strokeBox, "Show", show);
    field(strokeBox, "Width", range(0, 16, 0.5, look.stroke.width, (v) => { look.stroke.width = v; changedLook(); }));
    field(strokeBox, "Inset", range(0, 120, 1, look.stroke.inset, (v) => { look.stroke.inset = v; changedLook(); }));
    // its colour: the backdrop's, made lighter (a brighter band of the same gradient), or one of its own
    const mode = document.createElement("select");
    mode.add(new Option("From the backdrop", "backdrop"));
    mode.add(new Option("A colour of its own", "colour"));
    mode.value = look.stroke.mode;
    mode.onchange = () => { look.stroke.mode = mode.value as "backdrop" | "colour"; changedLook(); showLookStroke(); };
    field(strokeBox, "Colour", mode);
    if (look.stroke.mode === "backdrop") field(strokeBox, "Lighter", range(0, 1, 0.01, look.stroke.lighten, (v) => { look.stroke.lighten = v; changedLook(); }));
    else field(strokeBox, "Its colour", colour(look.stroke.color, (v) => { look.stroke.color = v; changedLook(); }));
    field(strokeBox, "Opacity", range(0, 1, 0.01, look.stroke.opacity, (v) => { look.stroke.opacity = v; changedLook(); }));
  }
  showLookStroke();
  const glowBox = $(".promoLookGlow");
  function showLookGlow() {
    glowBox.innerHTML = "";
    const g = (look.glow ??= { ...DEFAULT_GLOW });
    const on = document.createElement("input");
    on.type = "checkbox";
    on.checked = g.on;
    on.onchange = () => { g.on = on.checked; changedLook(); };
    field(glowBox, "Show", on);
    field(glowBox, "Size", range(2, 80, 1, g.size, (v) => { g.size = v; changedLook(); }));
    field(glowBox, "Strength", range(0.05, 1, 0.01, g.strength, (v) => { g.strength = v; changedLook(); }));
  }
  showLookGlow();
  // the 3D view's effects in the shots: they are taken again with them (a shot's shadow is not part of it for the handles and clicks)
  const fxBox = $(".promoLookFx");
  let fxTimer = 0;
  /** Gives every shot the board's effects, and takes again the ones that change (after a moment: a slider is not retaken per step). */
  function changedEffects(now = false) {
    keepLook();
    clearTimeout(fxTimer);
    const go = () => {
      const fx = JSON.stringify(look.effects);
      for (const p of pictures) for (const l of p.layers) {
        if (!l.shot || JSON.stringify(l.shot.effects ?? DEFAULT_SHOT_EFFECTS) === fx) continue;
        l.shot.effects = structuredClone(look.effects!);
        retake(p, l);
      }
    };
    if (now) go();
    else fxTimer = window.setTimeout(go, 250);
  }
  function showLookFx() {
    fxBox.innerHTML = "";
    const fx = (look.effects ??= structuredClone(DEFAULT_SHOT_EFFECTS));
    const box = (label: string, get: () => boolean, set: (v: boolean) => void, title: string) => {
      const c = document.createElement("input");
      c.type = "checkbox";
      c.checked = get();
      c.title = title;
      c.onchange = () => { set(c.checked); changedEffects(true); showLookFx(); };
      field(fxBox, label, c);
    };
    box("Ground shadow", () => fx.shadow.on, (v) => (fx.shadow.on = v), "The shadow each character casts on the ground (the items shown alone cast none)");
    if (fx.shadow.on) {
      field(fxBox, "Direction", range(0, 360, 1, fx.shadow.azimuth, (v) => { fx.shadow.azimuth = v; changedEffects(); }));
      field(fxBox, "Length", range(0, 1.5, 0.01, fx.shadow.length, (v) => { fx.shadow.length = v; changedEffects(); }));
      field(fxBox, "Softness", range(0, 2, 0.01, fx.shadow.blur, (v) => { fx.shadow.blur = v; changedEffects(); }));
      field(fxBox, "Strength", range(0, 1, 0.01, fx.shadow.opacity, (v) => { fx.shadow.opacity = v; changedEffects(); }));
    }
    box("The 3D view's look", () => fx.look, (v) => (fx.look = v), "The post-processing of the 3D view (its colour grade, bloom, ambient occlusion, depth of field, and so on) in every shot, as the view has it now");
  }
  showLookFx();
  // shots made before the board had these settings take them on
  if (pictures.some((p) => p.layers.some((l) => l.shot && JSON.stringify(l.shot.effects ?? DEFAULT_SHOT_EFFECTS) !== JSON.stringify(look.effects)))) changedEffects(true);

  // --- the thumbnails ---
  // captions of a board made before text was layers become text layers, on top
  for (const p of pictures) {
    const old = p.texts;
    if (!old.length) continue;
    p.texts = [];
    void Promise.all(old.map((t) => textLayer(t.text, { ...DEFAULT_TEXT, text: t.text, font: "", weight: 600, size: t.size, shadow: false, color: "#ffffffd9" }, t.x, t.y - t.size * 0.35)))
      .then((layers) => { for (const l of layers) { l.hidden = false; measureContent(l); p.layers.push(l); } draw(p); });
  }
  // what is visible of each shot (outlined, grabbed)
  for (const p of pictures) for (const l of p.layers) if (!l.opaque) measureContent(l);
  /** A picture's name on a card and in its tooltip: its item and what it is. */
  const cardTitle = (p: PromoPicture) => `${p.item ? `${p.item} · ` : ""}${p.kind} · ${p.name}`;
  // the cards, grouped by item (the item's name over its pictures); pictures of no item come first, ungrouped
  const groups = new Map<string, PromoPicture[]>();
  for (const p of pictures) groups.set(p.item ?? "", [...(groups.get(p.item ?? "") ?? []), p]);
  for (const [item, group] of [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0))) {
    const box = document.createElement("div");
    box.className = "promoThumbGroup";
    box.setAttribute("role", "group");
    if (item) {
      box.setAttribute("aria-label", item);
      const head = document.createElement("div");
      head.className = "promoThumbGroupName";
      head.textContent = item;
      head.title = item;
      box.appendChild(head);
    }
    const cards = document.createElement("div");
    cards.className = "promoThumbCards";
    for (const p of group) {
      const card = document.createElement("button");
      card.className = "promoThumb";
      card.setAttribute("role", "option");
      card.title = cardTitle(p);
      const canvas = document.createElement("canvas");
      canvas.style.height = `${THUMB_H}px`;
      const caption = document.createElement("span");
      caption.textContent = p.kind;
      card.append(canvas, caption);
      cards.appendChild(card);
      thumbs.set(p, canvas);
      card.onclick = () => pick(p);
    }
    box.appendChild(cards);
    thumbsBox.appendChild(box);
  }
  // the strip runs sideways: the wheel (up and down, as a mouse has it) scrolls it along
  thumbsBox.addEventListener("wheel", (ev) => {
    if (ev.deltaX || thumbsBox.scrollWidth <= thumbsBox.clientWidth) return; // a sideways wheel or a trackpad scrolls it by itself
    ev.preventDefault();
    thumbsBox.scrollLeft += ev.deltaY;
  }, { passive: false });
  drawAll();

  // --- editing in the large preview ---
  /** The picture point (in its pixels) under a pointer event on the preview. */
  const pointAt = (e: PointerEvent | WheelEvent) => {
    const r = preview.getBoundingClientRect();
    const k = picked ? picked.w / r.width : 1;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k] as const;
  };
  /** The shot under a point: the topmost whose picture is not see-through there (its margin is empty, the shot under it shows). */
  const layerAt = (px0: number, py0: number) =>
    picked ? [...picked.layers].reverse().find((l) => {
      if (l.hidden) return false;
      // the point in the layer's own upright frame
      const [x, y] = l.rotation ? turnPoint(px0, py0, layerPivot(l), -l.rotation) : [px0, py0];
      const o = opaqueRect(l);
      if (x < o.x || x > o.x + o.w || y < o.y || y > o.y + o.h) return false;
      if (l.text) return true;
      const b = layerRect(l);
      const px = Math.floor(((x - b.x) / b.w) * l.image.width), py = Math.floor(((y - b.y) / b.h) * l.image.height);
      // a few pixels round the point, so a thin part can be caught
      // (on the shot without its shadow and glow: those are not the character)
      const r = 4, ctx = (solidOf.get(l.image) ?? l.image).getContext("2d", { willReadFrequently: true });
      if (!ctx) return true;
      const data = ctx.getImageData(Math.max(0, px - r), Math.max(0, py - r), r * 2 + 1, r * 2 + 1).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 24) return true;
      return false;
    }) ?? null : null;
  preview.oncontextmenu = (e) => e.preventDefault();
  preview.onpointerdown = (ev) => {
    const p = picked;
    if (!p) return;
    const [x0, y0] = pointAt(ev);
    // a paint chart is a picture of its own kind: click a paint to take it out, right-drag to turn the camera round the item
    const chartHit = cellAt(x0, y0);
    const chartLayer = chartHit?.layer ?? (p.layers.length === 1 && p.layers[0].chart ? p.layers[0] : null);
    if (chartLayer?.chart && !ev.shiftKey) {
      ev.preventDefault();
      if (layerPicked !== chartLayer) { selectOnly(chartLayer); showInspector(); }
      preview.setPointerCapture(ev.pointerId);
      const aim = chartLayer.chart;
      const start = { yaw: aim.yaw, pitch: aim.pitch, cx: ev.clientX, cy: ev.clientY };
      const turning = ev.button === 2;
      preview.onpointermove = (m) => {
        if (!turning) return;
        aim.yaw = Math.round(start.yaw + (m.clientX - start.cx) * TURN_PER_PIXEL);
        aim.pitch = Math.round(Math.max(-30, Math.min(70, start.pitch + (m.clientY - start.cy) * TURN_PER_PIXEL)));
        retake(p, chartLayer);
      };
      preview.onpointerup = (up) => {
        preview.onpointermove = hoverMove;
        if (turning) {
          // a right-click that did not move: the chart's menu
          if (Math.hypot(up.clientX - start.cx, up.clientY - start.cy) < 4) layerMenu(p, chartLayer, up.clientX, up.clientY);
          else showLayer();
          return;
        }
        if (Math.hypot(up.clientX - start.cx, up.clientY - start.cy) >= 4) return;
        const [ux, uy] = pointAt(up);
        const c = cellAt(ux, uy);
        if (!c?.layer.chart) return;
        c.layer.chart.options.removed = [...c.layer.chart.options.removed, c.cell.label];
        hovered = null;
        retake(p, c.layer);
        showLayer();
      };
      return;
    }
    const box = transformBox();
    const grab = (HANDLE * 1.5) / previewScale;
    // the turning handle: dragged round, it turns the selected shots about the middle of the box (Shift: in steps of 15°)
    if (box && ev.button === 0 && Math.hypot(box.rotate[0] - x0, box.rotate[1] - y0) <= grab) {
      ev.preventDefault();
      preview.setPointerCapture(ev.pointerId);
      const mid = box.mid;
      const a0 = Math.atan2(y0 - mid[1], x0 - mid[0]);
      const shots = selected(), start = shots.map((l) => ({ l, rotation: l.rotation ?? 0, dx: l.dx, dy: l.dy, pivot: layerPivot(l) }));
      preview.onpointermove = (m) => {
        const [x, y] = pointAt(m);
        let turn = ((Math.atan2(y - mid[1], x - mid[0]) - a0) * 180) / Math.PI;
        if (m.shiftKey) turn = Math.round((start.length === 1 ? start[0].rotation + turn : turn) / ROTATE_SNAP) * ROTATE_SNAP - (start.length === 1 ? start[0].rotation : 0);
        for (const s0 of start) {
          s0.l.rotation = Math.round((s0.rotation + turn) * 10) / 10;
          // several turn about the middle of all of them: each one's own middle goes round it too
          if (start.length > 1) {
            const [nx, ny] = turnPoint(s0.pivot[0], s0.pivot[1], mid, turn);
            s0.l.dx = Math.round(s0.dx + nx - s0.pivot[0]);
            s0.l.dy = Math.round(s0.dy + ny - s0.pivot[1]);
          }
        }
        drawPreview();
      };
      preview.onpointerup = () => { preview.onpointermove = hoverMove; draw(p); shots.forEach(placeShared); showLayer(); };
      return;
    }
    // a corner handle of the selection: dragged, it sizes the selected shots together, about the middle of all of them
    if (box && ev.button === 0 && !ev.shiftKey) {
      if (box.corners.some(([hx, hy]) => Math.abs(hx - x0) <= grab && Math.abs(hy - y0) <= grab)) {
        ev.preventDefault();
        preview.setPointerCapture(ev.pointerId);
        const mid = box.mid;
        const d0 = Math.hypot(x0 - mid[0], y0 - mid[1]) || 1;
        const shots = selected(), start = shots.map((l) => ({ l, scale: l.scale, dx: l.dx, dy: l.dy }));
        preview.onpointermove = (m) => {
          const [x, y] = pointAt(m);
          const k = Math.hypot(x - mid[0], y - mid[1]) / d0;
          for (const s0 of start) {
            s0.l.scale = s0.scale; s0.l.dx = s0.dx; s0.l.dy = s0.dy;
            sizeAbout(s0.l, Math.max(0.2, Math.min(3, s0.scale * k)), mid);
          }
          drawPreview();
        };
        preview.onpointerup = () => { preview.onpointermove = hoverMove; draw(p); shots.forEach(placeShared); showLayer(); sharpen(p, shots); };
        return;
      }
    }
    // a chart is hit anywhere on one of its paints (between the item's pixels too)
    const hit = layerAt(x0, y0) ?? cellAt(x0, y0)?.layer ?? null;
    if (ev.shiftKey && ev.button === 0) {
      // Shift-click: the shot joins the selection, or leaves it
      if (hit) {
        if (selection.includes(hit)) {
          selection = selection.filter((x) => x !== hit);
          layerPicked = selection.at(-1) ?? null;
        } else {
          selection = [...selection, hit];
          layerPicked = hit;
        }
        showInspector();
        drawPreview();
      }
      return;
    }
    if (!hit) {
      if (selection.length) { selectOnly(null); showInspector(); drawPreview(); }
      return;
    }
    // a click on a shot of the selection keeps the selection (to move it all); on another, that one alone
    if (!selection.includes(hit)) selectOnly(hit);
    else layerPicked = hit;
    showInspector();
    drawPreview();
    const l = hit;
    ev.preventDefault();
    preview.setPointerCapture(ev.pointerId);
    const aim = l.shot ?? l.chart;
    const moving = selected().map((x) => ({ x, dx: x.dx, dy: x.dy }));
    const start = { yaw: aim?.yaw ?? 0, pitch: aim?.pitch ?? 0, cx: ev.clientX, cy: ev.clientY };
    const turning = ev.button === 2 && !!aim;
    preview.onpointermove = (m) => {
      if (turning) {
        aim!.yaw = Math.round(start.yaw + (m.clientX - start.cx) * TURN_PER_PIXEL);
        aim!.pitch = Math.round(Math.max(-30, Math.min(70, start.pitch + (m.clientY - start.cy) * TURN_PER_PIXEL)));
        retake(p, l);
      } else {
        const [x, y] = pointAt(m);
        let mx = x - x0, my = y - y0;
        // Shift: a straight line, across or up and down (whichever it has gone further)
        if (m.shiftKey) { if (Math.abs(mx) >= Math.abs(my)) my = 0; else mx = 0; }
        for (const s0 of moving) {
          s0.x.dx = Math.round(s0.dx + mx);
          s0.x.dy = Math.round(s0.dy + my);
        }
        drawPreview();
      }
    };
    preview.onpointerup = (up) => {
      preview.onpointermove = hoverMove;
      // a click that did not move: on a paint of a chart, that paint is taken out of it
      const still = Math.hypot(up.clientX - start.cx, up.clientY - start.cy) < 4;
      // a right-click that did not move: the shot's menu
      if (still && up.button === 2) { layerMenu(p, l, up.clientX, up.clientY); return; }
      if (still && !turning) {
        for (const s0 of moving) { s0.x.dx = s0.dx; s0.x.dy = s0.dy; }
        const [ux, uy] = pointAt(up);
        const c = cellAt(ux, uy);
        if (c && c.layer.chart) {
          c.layer.chart.options.removed = [...c.layer.chart.options.removed, c.cell.label];
          hovered = null;
          retake(p, c.layer);
          showLayer();
          return;
        }
      }
      draw(p); // the thumbnail too
      moving.forEach((s0) => placeShared(s0.x));
      showLayer();
    };
  };
  /** Over the preview, not dragging: the paint under the pointer is outlined. */
  const hoverMove = (m: PointerEvent) => {
    const [x, y] = pointAt(m);
    const rect = cellAt(x, y)?.rect ?? null;
    if (rect?.x === hovered?.x && rect?.y === hovered?.y) return;
    hovered = rect;
    drawPreview();
  };
  preview.onpointermove = hoverMove;
  preview.onpointerleave = () => { if (hovered) { hovered = null; drawPreview(); } };
  preview.onwheel = (ev) => {
    const p = picked;
    if (!p) return;
    const [x, y] = pointAt(ev);
    // over a paint chart: its camera zooms (every paint at once)
    const chartLayer = cellAt(x, y)?.layer ?? (p.layers.length === 1 && p.layers[0].chart ? p.layers[0] : null);
    if (chartLayer?.chart) {
      ev.preventDefault();
      const aim = chartLayer.chart;
      aim.fill = Math.max(0.4, Math.min(CHART_ZOOM, aim.fill * Math.exp(-ev.deltaY * 0.0012)));
      retake(p, chartLayer);
      return;
    }
    // only over a shot: over one of the selection it sizes them all, about the middle of all of them; over another, that one alone
    const l = layerAt(x, y);
    if (!l || l.chart) return;
    ev.preventDefault();
    if (!selection.includes(l)) { selectOnly(l); showInspector(); }
    const all = selectionRect();
    if (!all) return;
    const k = Math.exp(-ev.deltaY * 0.0012);
    for (const x of selected()) sizeAbout(x, Math.max(0.2, Math.min(3, x.scale * k)), [all.x + all.w / 2, all.y + all.h / 2]);
    draw(p);
    selected().forEach(placeShared);
    showLayer();
    // once the wheel stops, the sized shots are taken again at their new size
    const shots = selected();
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => sharpen(p, shots), 250);
  };

  // --- the picked picture and shot ---
  function pick(p: PromoPicture) {
    picked = p;
    selectOnly(p.layers.length === 1 ? p.layers[0] : null);
    for (const [q, c] of thumbs) c.parentElement!.classList.toggle("on", q === p);
    drawPreview();
    showInspector();
  }

  const pictureBox = document.createElement("div");
  const layerBox = document.createElement("div");
  function showInspector() {
    const p = picked;
    inspector.innerHTML = "";
    if (!p) {
      inspector.innerHTML = `<p class="dim">Pick a picture above.</p>`;
      return;
    }
    pictureBox.innerHTML = "";
    const h = document.createElement("h3");
    h.textContent = `${p.item ? `${p.item}: ` : ""}${p.kind.toLowerCase()} picture`;
    h.title = cardTitle(p);
    pictureBox.appendChild(h);
    const name = document.createElement("input");
    name.type = "text";
    name.value = p.name;
    name.setAttribute("aria-label", "File name");
    name.oninput = () => {
      p.name = name.value.replace(/[\\/:*?"<>|]+/g, "").trim() || p.name;
      thumbs.get(p)!.parentElement!.title = cardTitle(p);
    };
    field(pictureBox, "File name", name);
    const own = document.createElement("input");
    own.type = "checkbox";
    own.checked = !!p.backdrop;
    field(pictureBox, "Own backdrop", own);
    const ownBox = document.createElement("div");
    pictureBox.appendChild(ownBox);
    const showOwn = () => {
      ownBox.innerHTML = "";
      if (!p.backdrop) return;
      backdropFields(ownBox, () => p.backdrop!, () => draw(p));
      const shuffle = document.createElement("button");
      shuffle.textContent = "Shuffle";
      shuffle.onclick = () => { p.backdrop = randomBackdrop(); showOwn(); draw(p); };
      ownBox.appendChild(shuffle);
    };
    own.onchange = () => { p.backdrop = own.checked ? { ...look.backdrop } : null; showOwn(); draw(p); };
    showOwn();
    // the layers, top first as in an image editor: the border over everything, the captions, the shots (drag one up or down to put
    // it over or under the others, the eye shows or hides it, Shift-click selects more), the backdrop under everything
    const lh = document.createElement("h3");
    lh.textContent = "Layers";
    const stack = document.createElement("div");
    stack.className = "promoStack";
    stack.setAttribute("role", "listbox");
    stack.setAttribute("aria-label", "Layers");
    const fixedRow = (name: string, note: string) => {
      const row = document.createElement("div");
      row.className = "promoStackRow fixed";
      row.innerHTML = `<span class="promoEye"></span><span class="promoStackName"></span><span class="dim"></span>`;
      (row.children[1] as HTMLElement).textContent = name;
      (row.children[2] as HTMLElement).textContent = note;
      stack.appendChild(row);
    };
    // the stack, top first: the layers, and the border among them (where it is drawn: what is above it is drawn over it)
    const BORDER = "border" as const;
    const strokeAt = Math.min(p.strokeAt ?? p.layers.length, p.layers.length);
    const bottomFirst: (PromoLayer | typeof BORDER)[] = [...p.layers.slice(0, strokeAt), BORDER, ...p.layers.slice(strokeAt)];
    let dragging: PromoLayer | typeof BORDER | null = null;
    /** Puts the dragged entry above or below another, and the layers and the border's place back from the new order. */
    const dropOn = (target: PromoLayer | typeof BORDER, above: boolean) => {
      const moved = dragging;
      if (!moved || moved === target) return;
      const order = bottomFirst.filter((x) => x !== moved);
      const at = order.indexOf(target);
      order.splice(above ? at + 1 : at, 0, moved);
      p.layers = order.filter((x): x is PromoLayer => x !== BORDER);
      const b = order.indexOf(BORDER);
      p.strokeAt = b >= p.layers.length ? undefined : b;
      draw(p);
      showInspector();
    };
    const dragRow = (row: HTMLElement, entry: PromoLayer | typeof BORDER, label: string) => {
      row.draggable = true;
      row.ondragstart = (e) => { dragging = entry; row.classList.add("dragging"); e.dataTransfer?.setData("text/plain", label); };
      row.ondragend = () => { dragging = null; row.classList.remove("dragging"); };
      row.ondragover = (e) => {
        if (!dragging || dragging === entry) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        row.classList.toggle("dropAbove", e.clientY < r.top + r.height / 2);
        row.classList.toggle("dropBelow", e.clientY >= r.top + r.height / 2);
      };
      row.ondragleave = () => row.classList.remove("dropAbove", "dropBelow");
      row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove("dropAbove", "dropBelow");
        const r = row.getBoundingClientRect();
        dropOn(entry, e.clientY < r.top + r.height / 2);
      };
    };
    for (const entry of [...bottomFirst].reverse()) {
      if (entry === BORDER) {
        const row = document.createElement("div");
        row.className = "promoStackRow border";
        row.innerHTML = `<span class="promoEye"></span><span class="promoStackName">Border</span><span class="promoGrip dim" title="Drag up or down: the layers above it are drawn over the border">⋮⋮</span>`;
        dragRow(row, BORDER, "Border");
        stack.appendChild(row);
        continue;
      }
      const l = entry;
      const row = document.createElement("div");
      row.className = "promoStackRow";
      row.classList.toggle("on", selection.includes(l));
      row.classList.toggle("off", l.hidden);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(selection.includes(l)));
      const eye = document.createElement("button");
      eye.className = "promoEye";
      eye.textContent = l.hidden ? "◌" : "●";
      eye.title = l.hidden ? "Show" : "Hide";
      eye.onclick = (e) => { e.stopPropagation(); l.hidden = !l.hidden; draw(p); placeShared(l); showInspector(); };
      const name = document.createElement("span");
      name.className = "promoStackName";
      name.textContent = l.name;
      const grip = document.createElement("span");
      grip.className = "promoGrip dim";
      grip.textContent = "⋮⋮";
      grip.title = "Drag up or down to put it over or under the others (and the border)";
      row.append(eye, name);
      const linked = linkedWith(l).length;
      if (linked) {
        const chain = document.createElement("span");
        chain.className = "promoChain dim";
        chain.textContent = "⛓";
        chain.title = `Linked: the same shot and place in ${linked} other picture${linked === 1 ? "" : "s"}`;
        row.appendChild(chain);
      }
      row.appendChild(grip);
      row.onclick = (e) => {
        if (e.shiftKey) {
          selection = selection.includes(l) ? selection.filter((x) => x !== l) : [...selection, l];
          layerPicked = selection.includes(l) ? l : selection.at(-1) ?? null;
        } else selectOnly(l);
        showInspector();
        drawPreview();
      };
      dragRow(row, l, l.name);
      stack.appendChild(row);
    }
    fixedRow(p.backdrop ? "Backdrop (its own)" : "Backdrop", p.backdrop ? "" : "every picture");
    // a text of one's own, in the middle of the picture
    const addText = document.createElement("button");
    addText.textContent = "+ Add text";
    addText.onclick = async () => {
      const was = snapshot();
      const l = await textLayer("Text", { ...DEFAULT_TEXT }, p.w / 2, p.h / 2);
      measureContent(l);
      p.layers.push(l);
      pushUndo(was);
      selectOnly(l);
      draw(p);
      showInspector();
    };
    const addBox = document.createElement("div");
    addBox.className = "btns";
    addBox.appendChild(addText);
    pictureBox.append(lh, stack, addBox);
    inspector.append(pictureBox, layerBox);
    showLayer();
  }

  /**
   * A small live view through a layer's camera: drag to turn round the subject, right-drag (or Shift-drag) to slide the framing, the
   * wheel to zoom. It is drawn again as it is moved (small and quick, the newest look winning); the layer is taken again on letting go.
   */
  function cameraWindow(p: PromoPicture, l: PromoLayer, aim: NonNullable<PromoLayer["shot"] | PromoLayer["chart"]>): HTMLElement {
    const box = document.createElement("div");
    box.className = "promoCamera";
    const canvas = document.createElement("canvas");
    // the shape of what the camera frames: the shot's slot, or one picture of a chart
    const aspect = l.shot ? l.shot.w / l.shot.h : l.chart?.options?.cellAspect ?? 1;
    const W = 260, H = Math.round(Math.min(300, W / aspect)), w = Math.round(Math.min(W, H * aspect));
    const pr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * pr);
    canvas.height = Math.round(H * pr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${H}px`;
    const hint = document.createElement("p");
    hint.className = "dim hint";
    hint.textContent = "Drag to turn · right-drag to slide · Ctrl-drag to turn the light · wheel to zoom";
    box.append(canvas, hint);
    const ctx = canvas.getContext("2d")!;
    let busy = false, again = false;
    const look = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        do {
          again = false;
          const view = await host.cameraView(l, canvas.width, canvas.height);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(view, 0, 0, canvas.width, canvas.height);
        } while (again);
      } catch (err) {
        status.textContent = `Could not look through the camera: ${String(err)}`;
      } finally {
        busy = false;
      }
    };
    void look();
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onpointerdown = (ev) => {
      ev.preventDefault();
      canvas.setPointerCapture(ev.pointerId);
      // Ctrl: the light, as in the view (and hlmv): the shot gets a light of its own, from where the view's is now
      const lighting = ev.ctrlKey && ev.button === 0;
      if (lighting) aim.light ??= host.lightDirection();
      const sliding = !lighting && (ev.button === 2 || ev.button === 1 || ev.shiftKey);
      const start = { x: ev.clientX, y: ev.clientY, yaw: aim.yaw, pitch: aim.pitch, panX: aim.panX ?? 0, panY: aim.panY ?? 0, light: aim.light ? { ...aim.light } : null };
      canvas.onpointermove = (m) => {
        const dx = m.clientX - start.x, dy = m.clientY - start.y;
        if (lighting && start.light) {
          const [azimuth, elevation] = rotateLightDirection(start.light.azimuth, start.light.elevation, -dx * 0.5, dy * 0.5);
          aim.light = { azimuth: Math.round(azimuth * 10) / 10, elevation: Math.round(elevation * 10) / 10 };
        } else if (sliding) {
          // the subject follows the pointer: the pan is a share of half the frame
          aim.panX = Math.round((start.panX + (dx / (w / 2)) * (1 / aim.fill)) * 1000) / 1000;
          aim.panY = Math.round((start.panY - (dy / (H / 2)) * (1 / aim.fill)) * 1000) / 1000;
        } else {
          aim.yaw = Math.round(start.yaw + dx * TURN_PER_PIXEL);
          aim.pitch = Math.round(Math.max(-30, Math.min(70, start.pitch + dy * TURN_PER_PIXEL)));
        }
        void look();
      };
      canvas.onpointerup = () => {
        canvas.onpointermove = null;
        retake(p, l);
      };
    };
    let wheelTake = 0;
    canvas.onwheel = (ev) => {
      ev.preventDefault();
      aim.fill = Math.max(0.4, Math.min(l.chart ? CHART_ZOOM : 1.5, aim.fill * Math.exp(-ev.deltaY * 0.0012)));
      void look();
      clearTimeout(wheelTake);
      wheelTake = window.setTimeout(() => retake(p, l), 300);
    };
    return box;
  }

  /** A text layer's controls: what it says, its font and look; it is drawn again as they change (its middle stays put). */
  function textFields(p: PromoPicture, l: PromoLayer, t: NonNullable<PromoLayer["text"]>) {
    const th = document.createElement("h3");
    th.textContent = "Text";
    layerBox.appendChild(th);
    // the texts selected with it change together (all but what each says)
    const together = selection.filter((x) => x.text && p.layers.includes(x));
    const targets = together.includes(l) ? together : [l];
    if (targets.length > 1) th.textContent = `Text (${targets.length} selected: their look changes together)`;
    let redraws = Promise.resolve();
    const redraw = (x: PromoLayer, q: PromoPicture) => {
      x.name = x.text!.text.split("\n")[0] || "Text";
      redraws = redraws.then(() => refreshText(x)).then(() => { measureContent(x); draw(q); });
    };
    const changed = () => { for (const x of targets) redraw(x, p); };
    /** Sets a look of the texts this edits: the one, or the ones selected with it. */
    const setAll = (f: (x: NonNullable<PromoLayer["text"]>) => void) => { for (const x of targets) f(x.text!); };
    const area = document.createElement("textarea");
    area.className = "promoTextArea";
    area.value = t.text;
    area.rows = 2;
    area.oninput = () => { t.text = area.value; changed(); };
    field(layerBox, "Says", area);
    const font = document.createElement("select");
    for (const [path, label] of TEXT_FONTS) font.add(new Option(label, path));
    font.value = t.font;
    font.onchange = () => { setAll((x) => (x.font = font.value)); changed(); };
    field(layerBox, "Font", font);
    const weight = document.createElement("select");
    for (const [w, label] of [[400, "Regular"], [600, "Semibold"], [800, "Bold"]] as const) weight.add(new Option(label, String(w)));
    weight.value = String(t.weight);
    weight.onchange = () => { setAll((x) => (x.weight = Number(weight.value))); changed(); };
    field(layerBox, "Weight", weight);
    field(layerBox, "Size", range(12, 300, 1, t.size, (v) => { setAll((x) => (x.size = v)); changed(); }));
    field(layerBox, "Colour", colour(t.color.slice(0, 7), (v) => { setAll((x) => (x.color = v)); changed(); }));
    const align = document.createElement("select");
    for (const [a, label] of [["left", "Left"], ["center", "Centre"], ["right", "Right"]] as const) align.add(new Option(label, a));
    align.value = t.align;
    align.onchange = () => { setAll((x) => (x.align = align.value as typeof t.align)); changed(); };
    field(layerBox, "Lines", align);
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = get();
      box.onchange = () => { set(box.checked); changed(); };
      field(layerBox, label, box);
    };
    check("Outline", () => t.outline, (v) => setAll((x) => (x.outline = v)));
    check("Shadow", () => t.shadow, (v) => setAll((x) => (x.shadow = v)));
    // the same look on every text of the board (what each says stays)
    const every = document.createElement("button");
    every.textContent = "Apply to every text";
    every.title = "Give every text of every picture this font, weight, size, colour, outline and shadow";
    every.onclick = () => {
      const was = snapshot();
      for (const q of pictures) for (const x of q.layers) {
        if (!x.text || x === l) continue;
        Object.assign(x.text, { font: t.font, weight: t.weight, size: t.size, color: t.color, outline: t.outline, shadow: t.shadow });
        redraw(x, q);
      }
      void redraws.then(() => pushUndo(was));
      status.textContent = "Every text has this look now.";
    };
    layerBox.appendChild(every);
  }

  // --- layers as such: copied into other pictures (linked, or as copies of their own), duplicated, taken out ---
  /** The layers of the other pictures linked with a layer (the same shot and place). */
  const linkedWith = (l: PromoLayer) => (l.link && l.shared ? pictures.flatMap((q) => q.layers).filter((x) => x !== l && x.link === l.link && x.shared) : []);
  let nextLink = 1;
  const newLink = () => {
    while (pictures.some((q) => q.layers.some((x) => x.link === `link${nextLink}`))) nextLink++;
    return `link${nextLink++}`;
  };
  /** What was copied (Ctrl+C): the layers themselves, to be put into a picture linked (Ctrl+V) or as copies of their own (Ctrl+Shift+V). */
  let clipboard: PromoLayer[] = [];
  const picks = () => (picked ? selection.filter((l) => picked!.layers.includes(l)) : []);
  const some = (ls: PromoLayer[]) => (ls.length === 1 ? `“${ls[0].name}”` : `${ls.length} layers`);
  function copyLayers() {
    const sel = picks();
    if (!sel.length) return;
    clipboard = [...sel];
    status.textContent = `Copied ${some(sel)}. Ctrl+V in a picture puts it there linked (the same shot and place); Ctrl+Shift+V as a copy of its own.`;
  }
  /** Puts the copied layers into the picked picture: linked with what they were copied from, or as copies of their own. */
  function pasteLayers(how: "instance" | "copy", from = clipboard) {
    const p = picked;
    if (!p || !from.length) return;
    const was = snapshot();
    const added: PromoLayer[] = [];
    for (const src of from) {
      // the same shot twice in one picture is a copy (offset, so it can be seen); a text is always its own
      const here = p.layers.includes(src) || (!!src.link && !!src.shared && p.layers.some((x) => x.link === src.link && x.shared));
      const own = how === "copy" || !!src.text || here;
      const l: PromoLayer = { ...src, box: { ...src.box }, hidden: false };
      if (own) {
        l.shot = src.shot ? structuredClone(src.shot) : undefined;
        l.chart = src.chart ? structuredClone(src.chart) : undefined;
        l.text = src.text ? { ...src.text } : undefined;
        l.link = src.text ? undefined : newLink();
        l.shared = undefined;
        if (here) { l.dx += 24; l.dy += 24; }
      } else {
        src.link ??= newLink();
        src.shared = true;
        l.link = src.link;
        l.shared = true;
      }
      p.layers.push(l);
      added.push(l);
    }
    pushUndo(was);
    layerPicked = added.at(-1) ?? null;
    selection = added;
    draw(p);
    showInspector();
    status.textContent = `${how === "instance" && !added.every((l) => l.shared === undefined) ? "Linked" : "Copied"} ${some(added)} into this picture.`;
  }
  function deleteLayers() {
    const p = picked;
    const sel = picks();
    if (!p || !sel.length) return;
    const was = snapshot();
    const strokeAt = p.strokeAt ?? p.layers.length;
    const below = sel.filter((l) => p.layers.indexOf(l) < strokeAt).length;
    p.layers = p.layers.filter((l) => !sel.includes(l));
    if (p.strokeAt !== undefined) p.strokeAt = Math.max(0, p.strokeAt - below);
    pushUndo(was);
    selectOnly(null);
    draw(p);
    showInspector();
    status.textContent = `Took ${some(sel)} out of this picture${sel.some((l) => l.shared) ? " (the other pictures keep theirs)" : ""}.`;
  }
  /** Opens a shot's character in the 3D view (see BoardHost.editIn3D); the shot is taken again when it is set from there. */
  async function editIn3D(p: PromoPicture, l: PromoLayer) {
    if (!l.shot) return;
    const was = snapshot();
    try {
      if (await host.editIn3D(l)) {
        pushUndo(was);
        // the panel shows the shot as it now is (its camera view and sliders, what it wears) once it is taken again
        panelStale = true;
        retake(p, l);
      }
    } catch (err) {
      status.textContent = `Could not open it in 3D: ${String(err)}`;
    }
  }

  /** Unlinks a layer: this picture keeps a copy of the shot, changed on its own from now on. */
  function unlinkLayer(p: PromoPicture, l: PromoLayer) {
    const was = snapshot();
    l.shared = false;
    if (l.shot) l.shot = structuredClone(l.shot);
    if (l.chart) l.chart = structuredClone(l.chart);
    pushUndo(was);
    draw(p);
    showInspector();
  }

  /** Links a layer back to the others of its link: it takes their shot and place, and changes with them. */
  function relinkLayer(p: PromoPicture, l: PromoLayer) {
    const others = l.link ? pictures.flatMap((q) => q.layers).filter((x) => x !== l && x.link === l.link) : [];
    const was = snapshot();
    const lead = others.find((x) => x.shared);
    if (lead) { l.shot = lead.shot; l.chart = lead.chart; l.image = lead.image; l.content = lead.content; l.opaque = lead.opaque; l.cells = lead.cells; l.dx = lead.dx; l.dy = lead.dy; l.scale = lead.scale; l.hidden = lead.hidden; l.rotation = lead.rotation; }
    l.shared = true;
    pushUndo(was);
    draw(p);
    showInspector();
  }

  /** Moves a layer to the top or the bottom of the stack (over or under every other). */
  function restack(p: PromoPicture, l: PromoLayer, top: boolean) {
    const was = snapshot();
    p.layers = p.layers.filter((x) => x !== l);
    if (top) p.layers.push(l);
    else { p.layers.unshift(l); if (p.strokeAt !== undefined) p.strokeAt++; }
    pushUndo(was);
    draw(p);
    showInspector();
  }

  /** A menu on a layer (right-click in the picture): what the panel offers, nearer to hand. The app's own right-click menu. */
  function layerMenu(p: PromoPicture, l: PromoLayer, x: number, y: number) {
    const linked = linkedWith(l).length;
    const others = l.link ? pictures.flatMap((q) => q.layers).filter((x) => x !== l && x.link === l.link) : [];
    const spec = l.shot;
    showContextMenu(x, y, [
      ...(spec ? [{ label: "Edit in 3D…", run: () => void editIn3D(p, l) }] : []),
      ...(spec?.randomPose ? [{ label: "New pose", run: () => retake(p, l, () => host.repose(spec)) }] : []),
      ...(spec?.reroll ? [{ label: "New outfit", run: () => retake(p, l, () => host.reroll(spec)) }] : []),
      "-",
      { label: l.hidden ? "Show" : "Hide", run: () => { l.hidden = !l.hidden; draw(p); placeShared(l); showInspector(); } },
      ...(l.chart ? [] : [{ label: "Put it back where it was", run: () => { l.scale = 1; l.dx = 0; l.dy = 0; l.rotation = 0; draw(p); placeShared(l); showLayer(); } }]),
      { label: "Bring to front", run: () => restack(p, l, true), disabled: p.layers.at(-1) === l },
      { label: "Send to back", run: () => restack(p, l, false), disabled: p.layers[0] === l },
      "-",
      { label: "Copy", run: () => { selectOnly(l); copyLayers(); } },
      { label: "Duplicate", run: () => pasteLayers("copy", [l]) },
      ...(linked ? [{ label: `Make this picture's own copy (linked in ${linked} other${linked === 1 ? "" : "s"})`, run: () => unlinkLayer(p, l) }]
        : others.length ? [{ label: "Link back to the others", run: () => relinkLayer(p, l) }] : []),
      "-",
      { label: "Delete", run: () => { selectOnly(l); deleteLayers(); } },
    ]);
  }

  /** The buttons every layer has: copy, duplicate, delete, and its link with the other pictures. */
  function layerActions(p: PromoPicture, l: PromoLayer) {
    const h = document.createElement("h3");
    h.textContent = "Layer";
    layerBox.appendChild(h);
    const linked = linkedWith(l);
    const others = l.link ? pictures.flatMap((q) => q.layers).filter((x) => x !== l && x.link === l.link) : [];
    const note = document.createElement("p");
    note.className = "dim hint";
    if (linked.length) note.textContent = `Linked: the same shot and place in ${linked.length} other picture${linked.length === 1 ? "" : "s"}. A change here changes it there too.`;
    else if (others.length) note.textContent = `A copy of its own; ${others.length} other picture${others.length === 1 ? " has" : "s have"} the shot it was copied from.`;
    else note.textContent = "Only in this picture. Ctrl+C, then Ctrl+V in another picture, puts it there linked.";
    layerBox.appendChild(note);
    const btns = document.createElement("div");
    btns.className = "btns";
    const button = (label: string, title: string, go: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.onclick = go;
      btns.appendChild(b);
    };
    button("Copy", "Copy it (Ctrl+C): Ctrl+V in another picture puts it there linked, Ctrl+Shift+V as a copy of its own", () => { selectOnly(l); copyLayers(); });
    button("Duplicate", "A copy of its own in this picture, beside it", () => { pasteLayers("copy", [l]); });
    if (linked.length) button("Make this picture's own copy", "Unlink it: this picture keeps a copy of the shot, changed on its own from now on", () => unlinkLayer(p, l));
    else if (others.length) button("Link back to the others", "Link it again: it takes the others' shot and place, and changes with them", () => relinkLayer(p, l));
    button("Delete", "Take it out of this picture (Delete)", () => { selectOnly(l); deleteLayers(); });
    layerBox.appendChild(btns);
  }

  /** A shot's pose: the taunt or animation it is from (a list), and where in it (a timeline, the shot taken again as it is dragged). */
  function poseFields(p: PromoPicture, l: PromoLayer, spec: ShotSpec) {
    const list = document.createElement("select");
    list.add(new Option("Loading the poses…", ""));
    list.disabled = true;
    field(layerBox, "Pose", list);
    const time = document.createElement("input");
    time.type = "range";
    time.min = "0";
    time.max = "1";
    time.step = "0.002";
    time.value = String(spec.poseOf?.at ?? 0);
    time.disabled = !spec.poseOf;
    time.title = "Where in the taunt or animation the pose is taken";
    time.oninput = () => {
      if (!spec.poseOf) return;
      const id = spec.poseOf.id, at = Number(time.value);
      spec.poseOf.at = at;
      retake(p, l, () => host.setPose(spec, id, at));
    };
    field(layerBox, "Timeline", time);
    void host.poses(spec).then(({ taunts, sequences }) => {
      list.innerHTML = "";
      if (!spec.poseOf) list.add(new Option("(its own: pick one)", ""));
      const group = (label: string, items: { id: string; label: string }[]) => {
        if (!items.length) return;
        const g = document.createElement("optgroup");
        g.label = label;
        for (const x of items) g.appendChild(new Option(x.label, x.id));
        list.appendChild(g);
      };
      // the animations first: a weapon's stance is what a promo shot mostly wants, a taunt the odd one
      group("Animations", sequences);
      group("Taunts", taunts);
      list.value = spec.poseOf?.id ?? "";
      list.disabled = false;
      list.onchange = () => {
        if (!list.value) return;
        // a pose newly picked starts on a frame that frames well (the timeline then moves it)
        const id = list.value;
        retake(p, l, () => host.setPose(spec, id, -1));
      };
    });
  }

  /** A shot's bodygroups: each part of the class model that can switch, on or off (or which model) in this shot, over the cosmetics' choice. */
  function bodygroupFields(p: PromoPicture, l: PromoLayer, spec: ShotSpec) {
    const bh = document.createElement("h3");
    bh.textContent = "Bodygroups";
    layerBox.appendChild(bh);
    const box = document.createElement("div");
    box.innerHTML = `<p class="dim hint">Loading…</p>`;
    layerBox.appendChild(box);
    void host.bodygroups(spec).then((parts) => {
      box.innerHTML = "";
      if (!parts.length) { box.innerHTML = `<p class="dim hint">This class has no bodygroups.</p>`; return; }
      const set = (name: string, v: number | null) => {
        const own = { ...spec.bodygroups };
        if (v === null) delete own[name];
        else own[name] = v;
        spec.bodygroups = Object.keys(own).length ? own : undefined;
        retake(p, l);
        showLayer();
      };
      for (const bp of parts) {
        const mine = spec.bodygroups?.[bp.name];
        const now = mine ?? bp.byItems ?? 0;
        const why = mine !== undefined ? "set by hand in this shot" : bp.byItems !== null ? "as a cosmetic it wears sets it" : "the default";
        const label = bp.name.replace(/_/g, " ");
        if (bp.count === 2) {
          const c = document.createElement("input");
          c.type = "checkbox";
          c.checked = now === 0;
          c.title = `Shown or hidden (${why})`;
          c.onchange = () => set(bp.name, c.checked === ((bp.byItems ?? 0) === 0) ? null : c.checked ? 0 : 1);
          field(box, label + (mine !== undefined ? " •" : ""), c);
        } else {
          const sel = document.createElement("select");
          for (let i = 0; i < bp.count; i++) sel.add(new Option(i === 0 ? "0 (its own)" : String(i), String(i)));
          sel.value = String(now);
          sel.title = `Which model it shows (${why})`;
          sel.onchange = () => set(bp.name, Number(sel.value) === (bp.byItems ?? 0) ? null : Number(sel.value));
          field(box, label + (mine !== undefined ? " •" : ""), sel);
        }
      }
      if (spec.bodygroups) {
        const reset = document.createElement("button");
        reset.textContent = "Back to what the cosmetics set";
        reset.onclick = () => { spec.bodygroups = undefined; retake(p, l); showLayer(); };
        box.appendChild(reset);
      }
    });
  }

  /** The selected shot's controls. */
  function showLayer() {
    const p = picked, l = layerPicked;
    layerBox.innerHTML = "";
    if (!p || !l || !p.layers.includes(l)) {
      if (p && p.layers.length > 1) layerBox.innerHTML = `<p class="dim">Click a shot in the picture to change it.</p>`;
      return;
    }
    const h = document.createElement("h3");
    h.textContent = l.chart ? "Paint chart" : l.name;
    layerBox.appendChild(h);
    if (!l.chart) {
      const show = document.createElement("input");
      show.type = "checkbox";
      show.checked = !l.hidden;
      show.onchange = () => { l.hidden = !show.checked; draw(p); placeShared(l); showInspector(); };
      field(layerBox, "Show", show);
      const size = range(0.2, 3, 0.01, l.scale, (v) => { const r = opaqueRect(l); sizeAbout(l, v, [r.x + r.w / 2, r.y + r.h / 2]); draw(p); placeShared(l); });
      size.onchange = () => sharpen(p, [l]);
      field(layerBox, "Size", size);
      const reset = document.createElement("button");
      reset.textContent = "Put it back where it was";
      reset.onclick = () => { l.scale = 1; l.dx = 0; l.dy = 0; l.rotation = 0; draw(p); placeShared(l); showLayer(); };
      layerBox.appendChild(reset);
    } else {
      const hint = document.createElement("p");
      hint.className = "dim hint";
      hint.textContent = "Click a paint in the picture to take it out · right-drag to turn the camera round the item · wheel to zoom.";
      layerBox.appendChild(hint);
    }

    if (l.text) textFields(p, l, l.text);
    const aim = l.shot ?? l.chart;
    if (aim) {
      const ch = document.createElement("h3");
      ch.textContent = "Camera";
      layerBox.appendChild(ch);
      layerBox.appendChild(cameraWindow(p, l, aim));
      field(layerBox, "Turn", range(-180, 180, 1, aim.yaw, (v) => { aim.yaw = v; retake(p, l); }));
      field(layerBox, "Tilt", range(-30, 70, 1, aim.pitch, (v) => { aim.pitch = v; retake(p, l); }));
      field(layerBox, "Zoom", range(0.4, l.chart ? CHART_ZOOM : 1.5, 0.01, aim.fill, (v) => { aim.fill = v; retake(p, l); }));
      if (l.shot) {
        // the particle effects in the shot: how far in they are, and another roll of their chances
        const spec = l.shot;
        const particles = (spec.particles ??= { seed: Math.floor(Math.random() * 0x7fffffff), time: 2 });
        const when = range(0, 10, 0.1, particles.time, (v) => { particles.time = v; retake(p, l); });
        when.title = "How far into their run the particle effects are in the shot (seconds): they are started from the same seed and run this long each time the shot is taken";
        field(layerBox, "Effects at", when);
        const reseed = document.createElement("button");
        reseed.textContent = "Other particles";
        reseed.title = "Another seed for the effects' chances: where each particle is, which way it went";
        reseed.onclick = () => { particles.seed = Math.floor(Math.random() * 0x7fffffff); retake(p, l); };
        layerBox.appendChild(reseed);
      }
      if (aim.light) {
        const back = document.createElement("button");
        back.textContent = "Light back to the view's";
        back.title = `This shot has a light of its own (${aim.light.azimuth}°, ${aim.light.elevation}°; Ctrl-drag in the camera window turns it). Back to the view's light as it is.`;
        back.onclick = () => { aim.light = undefined; retake(p, l); showLayer(); };
        layerBox.appendChild(back);
      }
    }
    // a paint chart: the live chart editor's settings, drawn again at once
    const chart = l.chart;
    if (chart) {
      const o = (chart.options ??= structuredClone(DEFAULT_CHART));
      const again = () => retake(p, l);
      // charts of this item's other styles: kept in step (on unless taken out of step)
      const others = pictures.flatMap((q) => q.layers).filter((x) => x !== l && x.chart && x.chart.item === chart.item && x.chart.role === chart.role);
      if (others.length) {
        const sync = document.createElement("input");
        sync.type = "checkbox";
        sync.checked = chart.sync !== false;
        sync.title = "Its camera, paints and layout are the same as the charts of this item's other styles: a change here changes them too";
        sync.onchange = () => {
          chart.sync = sync.checked;
          // put back in step: the others take this one's settings
          if (sync.checked) retake(p, l);
        };
        field(layerBox, `In step with ${others.length === 1 ? "the other style's chart" : `the ${others.length} other styles' charts`}`, sync);
      }
      const ph = document.createElement("h3");
      ph.textContent = "Paints";
      layerBox.appendChild(ph);
      const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = get();
        box.onchange = () => { set(box.checked); again(); };
        field(layerBox, label, box);
      };
      const choose = <T extends string | number>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
        const sel = document.createElement("select");
        options.forEach(([, text], i) => sel.add(new Option(text, String(i))));
        sel.value = String(Math.max(0, options.findIndex(([v]) => v === get())));
        sel.onchange = () => { set(options[Number(sel.value)][0]); again(); };
        field(layerBox, label, sel);
      };
      choose("Unpainted first", [["none", "Not shown"], ["red", "RED"], ["both", "RED and BLU"]], () => (o.unpainted === true ? "red" : o.unpainted === false ? "none" : o.unpainted), (v) => (o.unpainted = v));
      choose("Team paints", [["both", "Both teams"], ["own", "RED only"]], () => o.teams, (v) => (o.teams = v));
      check("Cosmetic only", () => o.cosmeticOnly, (v) => (o.cosmeticOnly = v));
      const lh2 = document.createElement("h3");
      lh2.textContent = "Layout";
      layerBox.appendChild(lh2);
      const cols = range(0, 16, 1, o.cols, (v) => { o.cols = v; colsOut.textContent = v === 0 ? "Auto" : String(v); again(); });
      const colsOut = document.createElement("span");
      colsOut.className = "dim";
      colsOut.textContent = o.cols === 0 ? "Auto" : String(o.cols);
      field(layerBox, "Columns", cols).appendChild(colsOut);
      field(layerBox, "Gap across", range(0, 200, 1, o.gapX, (v) => { o.gapX = v; again(); }));
      field(layerBox, "Gap down", range(0, 200, 1, o.gapY, (v) => { o.gapY = v; again(); }));
      field(layerBox, "Edge margin", range(0, 300, 1, o.padding, (v) => { o.padding = v; again(); }));
      choose("Align", [["center", "Centre"], ["left", "Left"]], () => o.align, (v) => (o.align = v));
      choose("Cell shape", [[1, "Square"], [4 / 3, "4:3"], [3 / 4, "3:4 (tall)"], [16 / 9, "16:9"]], () => o.cellAspect, (v) => (o.cellAspect = v));
      // the paints taken out (click one in the picture to take it out)
      const rh = document.createElement("h3");
      rh.textContent = o.removed.length ? `Taken out (${o.removed.length})` : "Taken out";
      layerBox.appendChild(rh);
      const chips = document.createElement("div");
      chips.className = "promoChips";
      if (!o.removed.length) chips.innerHTML = `<span class="dim">Click a paint in the picture to take it out.</span>`;
      for (const label of o.removed) {
        const b = document.createElement("button");
        b.textContent = label;
        b.title = "Put it back";
        b.onclick = () => { o.removed = o.removed.filter((x) => x !== label); again(); showLayer(); };
        chips.appendChild(b);
      }
      layerBox.appendChild(chips);
      if (o.removed.length) {
        const all = document.createElement("button");
        all.textContent = "Put all back";
        all.onclick = () => { o.removed = []; again(); showLayer(); };
        layerBox.appendChild(all);
      }
    }
    const spec = l.shot;
    const paintable = spec?.loadout.filter((w) => w.paintable) ?? [];
    if (paintable.length) {
      const ph = document.createElement("h3");
      ph.textContent = "Paint";
      layerBox.appendChild(ph);
      for (const worn of paintable) {
        const sel = document.createElement("select");
        sel.add(new Option("No paint", ""));
        for (const paint of paintList) sel.add(new Option(paint.name, String(paint.id)));
        sel.value = worn.paint === null ? "" : String(worn.paint);
        sel.onchange = () => { worn.paint = sel.value ? Number(sel.value) : null; retake(p, l); };
        field(layerBox, worn.name, sel);
      }
    }
    if (spec?.reroll || spec?.randomPose) {
      const btns = document.createElement("div");
      btns.className = "btns";
      if (spec.reroll) {
        const roll = document.createElement("button");
        roll.textContent = "New outfit";
        roll.title = "Roll this character's loadout again (the item stays)";
        roll.onclick = () => retake(p, l, () => host.reroll(spec));
        btns.appendChild(roll);
      }
      if (spec.randomPose) {
        const pose = document.createElement("button");
        pose.textContent = "New pose";
        pose.title = "A random taunt or animation again, stopped on a frame that frames well";
        pose.onclick = () => retake(p, l, () => host.repose(spec));
        btns.appendChild(pose);
      }
      layerBox.appendChild(btns);
    }
    // every character shot: its pose from a taunt or an animation, and where in it
    if (spec) poseFields(p, l, spec);
    if (spec) bodygroupFields(p, l, spec);
    if (spec) {
      const edit = document.createElement("button");
      edit.className = "primary";
      edit.textContent = "Edit in 3D…";
      edit.title = "Open this character in the 3D view as the shot has it: change its weapon, pose, cosmetics or anything else, then come back";
      edit.onclick = () => editIn3D(p, l);
      layerBox.appendChild(edit);
    }
    layerActions(p, l);
  }

  let paintList: { id: number; name: string }[] = [];
  void host.paints().then((list) => { paintList = list.sort((a, b) => a.name.localeCompare(b.name)); if (layerPicked) showLayer(); });

  // --- undo and redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y): what a change was made from is kept as it starts (a press, a focus, the wheel)
  // and kept as a step when it ends, if anything changed; the images go with it, so undoing never takes a shot again
  interface Snap {
    key: string;
    look: BoardLook;
    pics: { p: PromoPicture; name: string; strokeAt?: number; backdrop: Backdrop | null; texts: PromoPicture["texts"]; layers: { l: PromoLayer; state: Partial<PromoLayer> }[] }[];
    specs: Map<object, string>;
  }
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  const idOf = (o: object | undefined) => { if (!o) return 0; let i = ids.get(o); if (!i) ids.set(o, (i = nextId++)); return i; };
  function snapshot(): Snap {
    const specs = new Map<object, string>();
    const pics = pictures.map((p) => ({
      p, name: p.name, backdrop: p.backdrop ? { ...p.backdrop } : null, texts: p.texts.map((t) => ({ ...t })), strokeAt: p.strokeAt,
      layers: p.layers.map((l) => {
        if (l.shot) specs.set(l.shot, JSON.stringify(l.shot));
        if (l.chart) specs.set(l.chart, JSON.stringify(l.chart));
        if (l.text) specs.set(l.text, JSON.stringify(l.text));
        return { l, state: { dx: l.dx, dy: l.dy, scale: l.scale, hidden: l.hidden, shared: l.shared, shot: l.shot, chart: l.chart, image: l.image, content: l.content, opaque: l.opaque, cells: l.cells, box: { ...l.box }, name: l.name, rotation: l.rotation } };
      }),
    }));
    const key = JSON.stringify([look, pics.map((x) => [x.name, x.backdrop, x.texts, x.layers.map(({ l, state: s }) => [idOf(l), s.dx, s.dy, s.scale, s.hidden, s.shared, idOf(s.shot), idOf(s.chart), idOf(s.image), s.box, s.rotation]), x.strokeAt]), [...specs.values()]]);
    return { key, look: structuredClone(look), pics, specs };
  }
  function restore(s: Snap) {
    look.backdrop = { ...s.look.backdrop };
    look.stroke = { ...s.look.stroke };
    look.glow = s.look.glow ? { ...s.look.glow } : undefined;
    look.effects = s.look.effects ? structuredClone(s.look.effects) : undefined;
    keepLook();
    for (const x of s.pics) {
      x.p.name = x.name;
      x.p.strokeAt = x.strokeAt;
      x.p.backdrop = x.backdrop ? { ...x.backdrop } : null;
      x.p.texts = x.texts.map((t) => ({ ...t }));
      x.p.layers = x.layers.map(({ l, state }) => Object.assign(l, state));
    }
    for (const [spec, json] of s.specs) Object.assign(spec, JSON.parse(json));
  }
  const undoStack: Snap[] = [], redoStack: Snap[] = [];
  let pending: Snap | null = null;
  let commitAfterShots = false;
  function pushUndo(s: Snap) {
    undoStack.push(s);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    host.changed();
  }
  const begin = () => { pending ??= snapshot(); };
  const commit = () => {
    if (!pending) return;
    // shots still being taken for it: the step waits for them, to hold all of what the press changed
    if (running || waiting.size) { commitAfterShots = true; return; }
    if (pending.key !== snapshot().key) pushUndo(pending);
    pending = null;
  };
  // (after the click and change events of the press: what they changed is in the step)
  const commitSoon = () => window.setTimeout(commit, 0);
  let wheelCommit = 0;
  root.addEventListener("pointerdown", begin, true);
  root.addEventListener("pointerup", commitSoon, true);
  root.addEventListener("focusin", begin, true);
  root.addEventListener("change", commitSoon, true);
  root.addEventListener("wheel", () => { begin(); clearTimeout(wheelCommit); wheelCommit = window.setTimeout(commit, 400); }, true);
  function step(from: Snap[], to: Snap[]) {
    commit();
    const s = from.pop();
    if (!s) return;
    to.push(snapshot());
    restore(s);
    showLookBackdrop();
    showLookStroke();
    showLookGlow();
    showLookFx();
    for (const [q, c] of thumbs) c.parentElement!.title = cardTitle(q);
    selection = selection.filter((l) => picked?.layers.includes(l));
    if (layerPicked && !selection.includes(layerPicked)) layerPicked = selection.at(-1) ?? null;
    drawAll();
    showInspector();
    host.changed();
    status.textContent = from === undoStack ? "Undone." : "Redone.";
  }
  const keys = (ev: KeyboardEvent) => {
    if (root.offsetParent === null) return; // this board is not showing
    const t = ev.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && (t.type === "text" || t.type === "search"))) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (ctrl && (k === "z" || k === "y")) {
      if (k === "y" || ev.shiftKey) step(redoStack, undoStack);
      else step(undoStack, redoStack);
    } else if (ctrl && k === "c") copyLayers();
    else if (ctrl && k === "v") pasteLayers(ev.shiftKey ? "copy" : "instance");
    // Delete on a control (a slider, a list) is the control's own
    else if (!ctrl && (ev.key === "Delete" || ev.key === "Backspace") && !t.matches("input, select, textarea, button")) deleteLayers();
    else return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };

  $(".promoExportPsd").onclick = async () => {
    status.textContent = "Exporting the Photoshop files…";
    status.textContent = await host.exportAll(pictures, look, "psd").catch((err) => `Could not export: ${String(err)}`);
  };
  $(".promoExportAll").onclick = async () => {
    status.textContent = "Exporting…";
    status.textContent = await host.exportAll(pictures, look).catch((err) => `Could not export: ${String(err)}`);
  };
  boardKeys.add(keys);
  $(".promoNew").onclick = () => host.newSet();
  if (pictures[0]) pick(pictures[0]);
  else showInspector();
  // the stage has its size only once the board shows
  requestAnimationFrame(() => drawPreview());
  return dispose;
}
