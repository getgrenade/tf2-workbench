/**
 * The Promo tab: the pictures of a promo set as thumbnails across the top; the one picked, large below them, where its shots are edited
 * by hand (click one to select it, drag to move it, the wheel to size it, right-drag to turn the camera round it, which takes it again
 * live in the promo scene); on the right the picked picture's settings and the selected shot's; on the left the look every picture
 * shares (the backdrop and the border stroke). Export writes the pictures at full size.
 */
import { icon } from "../icons";
import { showContextMenu } from "./contextMenu";
import { rotateLightDirection } from "./lighting";
import { shotEffectsOf, SHADOW_BLENDS, type ShadowBlend, DEFAULT_SHOT_EFFECTS, LINEUP_SPACING, PROMO_FOV, solidOf } from "./promo";
import { createBackdropPicker } from "./backdropPicker";
import { DEFAULT_STUDIO, STUDIO_LABELS, STUDIO_ROLES, flipStudio, parseStudio, randomStudio, type StudioLight } from "./studioLight";
import { createStudioSphere } from "./studioSphere";
import { defaultMask, partsOf, type KeepPart, type LayerMask } from "./promoMask";
import { DEFAULT_GROUND_SPEC, layer, LAYER_BLENDS, type GroundSpec, type LayerBlend, type OverlaySpec } from "./promo";
import { openTextureBrowser, overlayImage } from "./promoOverlay";
import { DEFAULT_CHART, DEFAULT_GLOW, DEFAULT_STROKE, DEFAULT_TEXT, TEXT_FONTS, layerPivot, layerRect, turnPoint, measureContent, opaqueRect, loadBackdropPictures, randomBackdrop, refreshText, textLayer, type ChartCellRect, renderPicture, type Backdrop, type BoardLook, type PromoLayer, type PromoPicture, type ShotSpec } from "./promo";

export interface BoardHost {
  /** Writes every picture (asks where); resolves to what to say. */
  /** Writes the pictures to a folder the user picks: as PNGs, or as layered Photoshop files. */
  exportAll(pictures: PromoPicture[], look: BoardLook, format?: "png" | "psd"): Promise<string>;
  /** Takes a layer's shot again as its spec now says (in the promo scene), replacing its image. */
  retake(layer: PromoLayer, live?: boolean): Promise<void>;
  /** A small picture through a layer's camera as its spec now says (w × h), to aim it by. */
  cameraView(layer: PromoLayer, w: number, h: number, steady?: boolean): Promise<HTMLCanvasElement>;
  /** Sets a thumbnail's framing: on the character (framed on the item, a pose rolled that shows it) or the item alone (take it again after). */
  framing(spec: ShotSpec, mode: "character" | "item"): Promise<void>;
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
  /** The classes a character can be (label, model name). */
  classes(): { label: string; cls: string }[];
  /** The board's own class (what a shot of no class of its own is). */
  boardClass(): string;
  /**
   * New characters (stock weapon, nothing worn), taken as one shot for a slot at x, y of w × h: one alone, or two to four standing in one
   * scene (a group shot, each of its own class and team).
   */
  newShot(chars: { cls: string; team: 0 | 1 }[], x: number, y: number, w: number, h: number): Promise<PromoLayer>;
  /** The name a shot of characters added by hand has: its class and team, or a group's classes left to right. */
  shotName(spec: ShotSpec): string;
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
/** The characters last added (the next window starts with them). */
let lastChars: { cls: string; team: 0 | 1 }[] = [];
/** How many steps back the board's undo keeps. */
const UNDO_STEPS = 10;
/** The wheel sizes a shot in steps of this much of its scale. */
const WHEEL_STEP = 0.05;
const corners = (r: { x: number; y: number; w: number; h: number }): [number, number][] => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];

/** Right-drag turns the camera this many degrees per pixel. */
const TURN_PER_PIXEL = 0.4;

// the icons of the layer list
const EYE_ICON = "eye", HIDDEN_ICON = "eyeOff", LINK_ICON = "link", SHOT_ICON = "userRound", TEXT_ICON = "type", CHART_ICON = "layoutGrid", BORDER_ICON = "frame", BACKDROP_ICON = "image";

/** The keys of the boards (undo and redo, copy and paste, delete), caught before the view's own; a board that is not showing lets them by. */
const boardKeys = new Set<(ev: KeyboardEvent) => void>();
window.addEventListener("keydown", (ev) => { for (const keys of boardKeys) keys(ev); }, true);

let look: BoardLook = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null");
    if (saved?.backdrop?.from && saved?.stroke) {
      const stroke = saved.stroke.mode ? { ...DEFAULT_STROKE, ...saved.stroke } : { ...DEFAULT_STROKE, width: saved.stroke.width ?? DEFAULT_STROKE.width, inset: saved.stroke.inset ?? DEFAULT_STROKE.inset };
      return { backdrop: { ...randomBackdrop(), ...saved.backdrop }, stroke, glow: { ...DEFAULT_GLOW, ...saved.glow }, effects: { ...DEFAULT_SHOT_EFFECTS, ...saved.effects, shadow: { ...DEFAULT_SHOT_EFFECTS.shadow, ...saved.effects?.shadow } }, ...(saved.studio ? { studio: parseStudio(saved.studio) } : {}) };
    }
  } catch { /* the defaults */ }
  return { backdrop: randomBackdrop(), stroke: { ...DEFAULT_STROKE }, glow: { ...DEFAULT_GLOW }, effects: structuredClone(DEFAULT_SHOT_EFFECTS) };
})();
/** The effects a new shot is taken with: the boards' (so a board just made does not take all of its shots again as it opens). */
export const boardShotEffects = () => shotEffectsOf(look.effects ?? DEFAULT_SHOT_EFFECTS);
const keepLook = () => { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* not kept */ } };

/** Shows a set's pictures as a board in `root`; what comes back lets go of what the board holds outside its root (when it is closed). */
export function showBoard(root: HTMLElement, title: string, pictures: PromoPicture[], host: BoardHost): () => void {
  root.innerHTML = `<div class="promoBoard">
    <aside class="promoSide">
      <h2 class="promoTitle"></h2>
      <p class="dim hint promoNote">The look of every picture of the set.</p>
      <h3>Backdrop <button class="promoShuffle" title="Another random neutral gradient">Shuffle</button></h3>
      <div class="promoLookBackdrop"></div>
      <h3>Glow round the characters</h3>
      <div class="promoLookGlow"></div>
      <h3>Shadows</h3>
      <div class="promoLookShadow"></div>
      <h3>3D effects in the shots</h3>
      <div class="promoLookFx"></div>
      <div class="promoSideFoot">
        <p class="chartInfo promoStatus" role="status"></p>
        <div class="btns"><button class="promoNew" title="Make the pictures of another set">New set…</button><button class="promoExportPsd" title="Every picture as a Photoshop file, each layer of it a layer (texts editable, the glow and the text outline and shadow as layer effects)">Export PSDs…</button><button class="primary promoExportAll">Export all…</button></div>
      </div>
    </aside>
    <main class="promoCenter">
      <div class="promoThumbs" role="listbox" aria-label="Pictures"></div>
      <div class="promoStage"><canvas class="promoPreview"></canvas></div>
      <p class="promoHelp dim">Click a shot to select it (Shift-click for more) · drag to move · corners or wheel to size · right-drag to turn the camera round it · click a paint of a chart to take it out · Ctrl+C, then Ctrl+V pastes a layer as a copy of its own, Ctrl+Shift+V linked (the same shot and place) · Delete takes it out · the bar under a selection fades it out (a gradient drawn by dragging, as in Photoshop) and turns its shadow on or off</p>
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
  const selectOnly = (l: PromoLayer | null) => { layerPicked = l; selection = l ? [l] : []; borderPicked = false; };
  /** The border is what the panel on the right shows (picked in the layers). */
  let borderPicked = false;
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
      // (a background overlay fills the picture: its texture is slid and sized, it has no handles)
      return { corners: turnedCorners(l), mid: piv, top: turnPoint(o.x + o.w / 2, o.y, piv, rot), rotate: turnPoint(o.x + o.w / 2, o.y - gap, piv, rot), fixed: !!l.overlay };
    }
    const pts = sel.flatMap(turnedCorners);
    const x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0])), y0 = Math.min(...pts.map((q) => q[1])), y1 = Math.max(...pts.map((q) => q[1]));
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return { corners: corners(r), mid: [x0 + r.w / 2, y0 + r.h / 2] as [number, number], top: [x0 + r.w / 2, y0] as [number, number], rotate: [x0 + r.w / 2, y0 - gap] as [number, number], fixed: sel.some((l) => l.overlay) };
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
    // a mask that is edited belongs to the one layer selected (another picked ends it)
    if (maskEdit && (selected().length !== 1 || selected()[0] !== maskEdit)) { maskEdit = null; preview.classList.remove("masking"); }
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
    syncBar();
    placeBar(box, k);
    if (maskEdit) {
      const ctx = preview.getContext("2d")!;
      ctx.save();
      ctx.setTransform(k * pr, 0, 0, k * pr, 0, 0);
      drawMaskGizmo(ctx, k);
      ctx.restore();
    } else if (box) {
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
      if (box.fixed) { ctx.restore(); return; }
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

  // --- fade masks: a gradient on a layer, drawn and shaped on the preview (as Photoshop's gradient tool on a layer mask) ---
  /** The layer whose mask is being drawn or shaped (its handles show, the transform box does not); null: none. */
  let maskEdit: PromoLayer | null = null;
  /** The kind a new mask is drawn as (the last one picked). */
  let maskKind: LayerMask["kind"] = (() => { try { return localStorage.getItem("promoMaskKind") === "radial" ? "radial" : "linear"; } catch { return "linear"; } })();
  const setMaskKind = (k: LayerMask["kind"]) => { maskKind = k; try { localStorage.setItem("promoMaskKind", k); } catch { /* not kept */ } };
  /** The handle the pointer is over (drawn larger). */
  let maskHover: MaskHandle | null = null;
  type MaskHandle = "a" | "b" | "mid" | "ratio" | "hard" | "line";
  /** A picture point in a layer's own frame (0..1 of its upright rectangle), and back. */
  const toLocal = (l: PromoLayer, x: number, y: number): [number, number] => {
    const [ux, uy] = l.rotation ? turnPoint(x, y, layerPivot(l), -l.rotation) : [x, y];
    const r = layerRect(l);
    return [(ux - r.x) / (r.w || 1), (uy - r.y) / (r.h || 1)];
  };
  const toPicture = (l: PromoLayer, u: number, v: number): [number, number] => {
    const r = layerRect(l);
    return turnPoint(r.x + u * r.w, r.y + v * r.h, layerPivot(l), l.rotation ?? 0);
  };
  /** Where a mask's handles are on the picture. */
  function maskGeometry(l: PromoLayer, m: LayerMask) {
    const A = toPicture(l, m.a[0], m.a[1]), B = toPicture(l, m.b[0], m.b[1]);
    const R = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1e-6;
    const u: [number, number] = [(B[0] - A[0]) / R, (B[1] - A[1]) / R], n: [number, number] = [-u[1], u[0]];
    const along = (t: number): [number, number] => [A[0] + u[0] * R * t, A[1] + u[1] * R * t];
    if (m.kind === "linear") return { A, B, R, u, n, mid: along(m.mid), ratio: null, hard: null };
    const midT = m.hardness + (1 - m.hardness) * m.mid;
    return { A, B, R, u, n, mid: along(midT), ratio: [A[0] + n[0] * R * m.ratio, A[1] + n[1] * R * m.ratio] as [number, number], hard: along(m.hardness) };
  }
  /** The handle of the edited mask under a picture point. */
  function maskHandleAt(x: number, y: number): MaskHandle | null {
    const l = maskEdit, m = l?.mask;
    if (!l || !m) return null;
    const g = maskGeometry(l, m), reach = 9 / previewScale;
    const near = (q: [number, number] | null) => !!q && Math.hypot(q[0] - x, q[1] - y) <= reach;
    // (the small ones first: they sit on the line between the big ones)
    if (near(g.mid)) return "mid";
    if (near(g.hard) && m.hardness > 0.02) return "hard";
    if (near(g.ratio)) return "ratio";
    if (near(g.A)) return "a";
    if (near(g.B)) return "b";
    if (near(g.hard)) return "hard";
    if (m.kind === "linear") {
      const t = ((x - g.A[0]) * g.u[0] + (y - g.A[1]) * g.u[1]) / g.R;
      const off = Math.abs((x - g.A[0]) * g.n[0] + (y - g.A[1]) * g.n[1]);
      if (t > 0 && t < 1 && off <= reach * 0.7) return "line";
    }
    return null;
  }
  /** Draws the edited mask's handles over the preview (ctx in the picture's pixels; k the preview's scale). */
  function drawMaskGizmo(ctx: CanvasRenderingContext2D, k: number) {
    const l = maskEdit, m = l?.mask;
    if (!l || !m) return;
    const g = maskGeometry(l, m);
    const px = (v: number) => v / k;
    const stroke = (path: () => void, width: number, colour: string, dash?: number[]) => {
      ctx.beginPath();
      path();
      ctx.setLineDash(dash ? dash.map(px) : []);
      ctx.lineWidth = px(width + 2);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.stroke();
      ctx.lineWidth = px(width);
      ctx.strokeStyle = colour;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const accent = "rgba(255,170,60,0.98)", white = "rgba(255,255,255,0.95)";
    const dot = (q: [number, number], r: number, fill: string, ring: string, h: MaskHandle) => {
      const big = maskHover === h ? 1.35 : 1;
      ctx.beginPath();
      ctx.arc(q[0], q[1], px(r * big), 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = px(2);
      ctx.strokeStyle = ring;
      ctx.stroke();
    };
    const diamond = (q: [number, number], r: number, h: MaskHandle, fill = accent) => {
      const s = px(r * (maskHover === h ? 1.35 : 1));
      ctx.beginPath();
      ctx.moveTo(q[0], q[1] - s); ctx.lineTo(q[0] + s, q[1]); ctx.lineTo(q[0], q[1] + s); ctx.lineTo(q[0] - s, q[1]); ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = px(1.5);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.stroke();
    };
    if (m.kind === "linear") {
      // the band the fade takes: a guide across each end, then the line between them
      const reach = Math.max(px(70), g.R * 0.6);
      for (const [q, dash] of [[g.A, [10, 6]], [g.B, [10, 6]]] as const) {
        stroke(() => { ctx.moveTo(q[0] - g.n[0] * reach, q[1] - g.n[1] * reach); ctx.lineTo(q[0] + g.n[0] * reach, q[1] + g.n[1] * reach); }, 2, "rgba(255,255,255,0.85)", [...dash]);
      }
      stroke(() => { ctx.moveTo(g.A[0], g.A[1]); ctx.lineTo(g.B[0], g.B[1]); }, maskHover === "line" ? 2.5 : 1.5, white);
    } else {
      const angle = Math.atan2(g.u[1], g.u[0]);
      const ellipse = (r: number) => () => ctx.ellipse(g.A[0], g.A[1], Math.max(1e-3, r), Math.max(1e-3, r * m.ratio), angle, 0, Math.PI * 2);
      stroke(ellipse(g.R), 1.5, white);
      if (m.hardness > 0.01) stroke(ellipse(g.R * m.hardness), 2, "rgba(255,255,255,0.85)", [10, 6]);
      stroke(() => { ctx.moveTo(g.A[0], g.A[1]); ctx.lineTo(g.B[0], g.B[1]); }, 2, "rgba(255,255,255,0.75)", [6, 5]);
      diamond(g.hard!, 5, "hard", white);
      // the short radius: a square on the ellipse
      const s = px(maskHover === "ratio" ? 6.5 : 5);
      ctx.save();
      ctx.translate(g.ratio![0], g.ratio![1]);
      ctx.rotate(angle);
      ctx.fillStyle = white;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.lineWidth = px(1.5);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeRect(-s, -s, s * 2, s * 2);
      ctx.restore();
    }
    diamond(g.mid, 5.5, "mid");
    // the shown end (or the middle) white, the gone end dark
    dot(g.A, 6.5, white, "rgba(0,0,0,0.75)", "a");
    dot(g.B, 6.5, "rgba(20,20,22,0.92)", white, "b");
  }
  /** Draws the preview again at the next frame (once however many asks come before it): a drag's steps. */
  let drawQueued = 0;
  const requestDraw = () => { if (!drawQueued) drawQueued = requestAnimationFrame(() => { drawQueued = 0; drawPreview(); }); };

  /** The edited mask's layer and its instances keep one mask (a shared shot sits the same everywhere). */
  const maskChanged = (l: PromoLayer) => {
    for (const [, x] of instancesOf(l)) x.mask = l.mask ? structuredClone(l.mask) : undefined;
  };
  /** Starts (or ends) shaping a layer's mask; a layer without one gets one drawn by its first drag. */
  function editMask(l: PromoLayer | null) {
    maskEdit = l;
    maskHover = null;
    status.textContent = l ? (l.mask ? "Drag the handles to shape the fade, or drag across the picture to draw it again (Shift: in steps of 15°). Esc when done." : "Drag across the picture to draw the fade: from where it shows to where it is gone (Shift: in steps of 15°).") : "";
    preview.classList.toggle("masking", !!l);
    preview.style.cursor = "";
    drawPreview();
  }
  /** A mask was made on a shot: its shadow goes (a character that fades out has none under it), which the toolbar can bring back. */
  function firstMask(p: PromoPicture, l: PromoLayer) {
    if (l.shot && !l.shot.noShadow) { l.shot.noShadow = true; queueRetake(p, l); }
  }
  /** Drags on the preview while a mask is edited: its handles, or a new gradient drawn from the press. */
  function maskPointerDown(ev: PointerEvent, p: PromoPicture, l: PromoLayer, x0: number, y0: number) {
    ev.preventDefault();
    preview.setPointerCapture(ev.pointerId);
    const handle = maskHandleAt(x0, y0);
    const had = !!l.mask;
    const m0 = l.mask ? structuredClone(l.mask) : null;
    const start = toLocal(l, x0, y0);
    const snap = (from: [number, number], to: [number, number], on: boolean): [number, number] => {
      if (!on) return to;
      const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy);
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
      return [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len];
    };
    let moved = false;
    preview.onpointermove = (mv) => {
      const [x, y] = pointAt(mv);
      if (!moved && Math.hypot(x - x0, y - y0) * previewScale < 3) return;
      moved = true;
      const here = toLocal(l, x, y);
      if (!handle) {
        // a new gradient, from the press to the pointer (in the picture's pixels, so that Shift snaps as it looks)
        const [sx, sy] = snap([x0, y0], [x, y], mv.shiftKey);
        const kind = m0?.kind ?? maskKind;
        l.mask = { ...(m0 ?? defaultMask(kind)), on: true, kind, a: start, b: toLocal(l, sx, sy), ...(m0 ? {} : { ratio: 1, hardness: 0 }) };
      } else {
        const m = l.mask!, g = maskGeometry(l, m0!);
        const proj = (q: [number, number]) => ((x - q[0]) * g.u[0] + (y - q[1]) * g.u[1]) / g.R;
        if (handle === "a") {
          if (m.kind === "radial") {
            // the middle carries the whole ellipse with it
            m.a = here; m.b = [m0!.b[0] + here[0] - m0!.a[0], m0!.b[1] + here[1] - m0!.a[1]];
          } else {
            const B = toPicture(l, m0!.b[0], m0!.b[1]);
            const [sx, sy] = snap(B, [x, y], mv.shiftKey);
            m.a = toLocal(l, sx, sy);
          }
        } else if (handle === "b") {
          const [sx, sy] = snap(g.A, [x, y], mv.shiftKey);
          m.b = toLocal(l, sx, sy);
        } else if (handle === "line") {
          const d = [here[0] - start[0], here[1] - start[1]];
          m.a = [m0!.a[0] + d[0], m0!.a[1] + d[1]];
          m.b = [m0!.b[0] + d[0], m0!.b[1] + d[1]];
        } else if (handle === "mid") {
          const t = proj(g.A);
          m.mid = Math.round(Math.min(0.95, Math.max(0.05, m.kind === "radial" ? (t - m.hardness) / Math.max(0.02, 1 - m.hardness) : t)) * 1000) / 1000;
        } else if (handle === "hard") {
          m.hardness = Math.round(Math.min(0.95, Math.max(0, proj(g.A))) * 1000) / 1000;
        } else if (handle === "ratio") {
          const off = Math.abs((x - g.A[0]) * g.n[0] + (y - g.A[1]) * g.n[1]) / g.R;
          m.ratio = Math.round(Math.min(20, Math.max(0.05, off)) * 1000) / 1000;
        }
      }
      maskChanged(l);
      requestDraw();
    };
    preview.onpointerup = () => {
      preview.onpointermove = maskHoverMove;
      if (!moved) {
        // a click (no drag): on another layer, that one is picked; elsewhere the mask is done
        const hit = handle ? null : layerAt(x0, y0);
        if (!handle && hit !== l) {
          editMask(null);
          if (hit) { selectOnly(hit); showInspector(); }
          drawPreview();
        }
        return;
      }
      if (!had && l.mask) firstMask(p, l);
      draw(p);
      for (const [q] of instancesOf(l)) draw(q);
      syncBar(true);
    };
  }
  /** Over the preview while a mask is edited: the handle under the pointer is shown, and the pointer says what a drag does. */
  const maskHoverMove = (mv: PointerEvent) => {
    if (!maskEdit) { hoverMove(mv); return; }
    const [x, y] = pointAt(mv);
    const h = maskHandleAt(x, y);
    preview.style.cursor = h === "line" ? "move" : h ? "pointer" : "crosshair";
    if (h !== maskHover) { maskHover = h; requestDraw(); }
  };

  // the bar under the selection: the selected layer's fade mask and its own shadow
  const bar = document.createElement("div");
  bar.className = "promoSelBar";
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
  stage.append(bar);
  let barKey = "";
  /** Builds the bar again when what it shows changed (`force`: its states too). */
  function syncBar(force = false) {
    const sel = selected();
    const l = sel.length === 1 && !sel[0].chart ? sel[0] : null;
    const key = l ? JSON.stringify([idOfLayer(l), !!l.mask, l.mask?.on, l.mask?.kind, l.mask?.invert, l.mask?.keep, maskEdit === l, !!l.shot, l.shot?.noShadow]) : "";
    if (key === barKey && !force) return;
    barKey = key;
    bar.replaceChildren();
    bar.hidden = !l;
    if (!l || !picked) return;
    const p = picked;
    // the main row (how the board's handles act, the shadow); the fade's own controls on a row under it
    const main = document.createElement("div"), extra = document.createElement("div");
    main.className = "row";
    extra.className = "row";
    bar.append(main);
    let row = main;
    const button = (name: Parameters<typeof icon>[0], title: string, on: boolean, run: () => void, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `${cls}${on ? " on" : ""}`;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.setAttribute("aria-pressed", String(on));
      b.innerHTML = icon(name);
      b.onclick = () => { run(); syncBar(true); drawPreview(); draw(p); };
      row.append(b);
      return b;
    };
    const sep = () => { const s = document.createElement("span"); s.className = "sep"; row.append(s); };
    const m = l.mask;
    button("move", "Move, size and turn it", maskEdit !== l, () => editMask(null));
    button("blend", m ? (maskEdit === l ? "Done shaping the fade (Esc)" : "Shape the fade mask") : "Add a fade mask: drag across the picture to draw it", maskEdit === l, () => editMask(maskEdit === l ? null : l));
    if (maskEdit === l) {
      // the kind: a mask that has one changes to the other, keeping where it is; without one, the kind a drag draws (or a click makes)
      const seg = document.createElement("div");
      seg.className = "seg";
      for (const k of ["linear", "radial"] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = k === "linear" ? "Linear" : "Radial";
        b.title = k === "linear" ? "A straight fade, from one line to another" : "A round fade, from the middle out (its shape and softness by its handles)";
        b.classList.toggle("on", (m?.kind ?? maskKind) === k);
        b.onclick = () => {
          setMaskKind(k);
          if (!l.mask) {
            l.mask = defaultMask(k);
            firstMask(p, l);
            if (maskEdit !== l) editMask(l);
          } else if (l.mask.kind !== k) {
            const d = defaultMask(k);
            l.mask = { ...l.mask, kind: k, ratio: d.ratio, hardness: d.hardness };
          }
          maskChanged(l);
          syncBar(true);
          drawPreview();
          draw(p);
        };
        seg.append(b);
      }
      row.append(seg);
    }
    if (l.shot) {
      sep();
      const shown = !l.shot.noShadow;
      const lab = document.createElement("label");
      lab.className = "shadowToggle";
      lab.title = shown ? "Its shadow on the ground: shown (untick to take it off this shot)" : "Its shadow on the ground: off (tick to bring it back)";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = shown;
      cb.onchange = () => {
        l.shot!.noShadow = !cb.checked || undefined;
        queueRetake(p, l);
        syncBar(true);
        drawPreview();
        draw(p);
      };
      lab.append("Shadow", cb);
      main.append(lab);
    }
    // the fade's other controls: on a row under it, while it is being shaped
    if (maskEdit !== l || !m) return;
    bar.append(extra);
    row = extra;
    if (m) {
      button("arrowDownUp", "The other way round: show where it fades, fade where it shows", m.invert, () => { m.invert = !m.invert; maskChanged(l); });
      button(m.on ? "eye" : "eyeOff", m.on ? "Hide the fade (to compare; it is kept)" : "Show the fade", !m.on, () => { m.on = !m.on; maskChanged(l); });
      if (l.shot) {
        sep();
        const keep = (part: KeepPart, name: Parameters<typeof icon>[0], label: string) =>
          button(name, `Keep ${label} whole wherever the fade falls`, m.keep.includes(part), () => {
            m.keep = m.keep.includes(part) ? m.keep.filter((x) => x !== part) : [...m.keep, part];
            maskChanged(l);
            // the parts picture comes with the shot: taken again once, when a part is first kept
            if (m.keep.length && !partsOf.has(l.image)) {
              l.shot!.parts = true;
              status.textContent = "Finding the parts of the character…";
              queueRetake(p, l);
            } else l.shot!.parts = m.keep.length > 0 || undefined;
          });
        keep("arms", "hand", "the arms and hands");
        keep("head", "scanFace", "the head");
        keep("weapon", "sword", "what it holds");
      }
      sep();
      button("trash2", "Take the fade mask off", false, () => { l.mask = undefined; maskChanged(l); if (maskEdit === l) editMask(null); });
    }
  }
  const layerIds = new WeakMap<PromoLayer, number>();
  let nextLayerId = 1;
  const idOfLayer = (l: PromoLayer) => { let i = layerIds.get(l); if (!i) layerIds.set(l, (i = nextLayerId++)); return i; };
  /** Puts the bar under the selection's box (over it when there is no room below), on the stage. */
  function placeBar(box: { corners: [number, number][] } | null, k: number) {
    if (!box || bar.hidden) { bar.style.visibility = "hidden"; return; }
    bar.style.visibility = "";
    const ox = preview.offsetLeft, oy = preview.offsetTop;
    const xs = box.corners.map((q) => q[0] * k), ys = box.corners.map((q) => q[1] * k);
    const cx = ox + (Math.min(...xs) + Math.max(...xs)) / 2;
    const bw = bar.offsetWidth, bh = bar.offsetHeight, gap = 12;
    let top = oy + Math.max(...ys) + gap;
    if (top + bh > stage.clientHeight - 4) top = Math.max(4, Math.min(stage.clientHeight - bh - 4, oy + Math.min(...ys) - bh - gap));
    const left = Math.max(4, Math.min(stage.clientWidth - bw - 4, cx - bw / 2));
    bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
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
  /** Draws a picture again: its card and, when it is the one picked, the preview (`live`: a drag's step, the preview only; the card after). */
  const draw = (p: PromoPicture, live = false) => {
    const c = thumbs.get(p);
    if (c && !live) renderPicture(c, p, look, thumbScale(p));
    if (p === picked) drawPreview();
  };
  const drawAll = () => pictures.forEach((p) => draw(p));
  // the pictures behind the pictures (a backdrop of a picture) are loaded before they are drawn, then it is drawn again
  void loadBackdropPictures([look.backdrop, ...pictures.map((x) => x.backdrop)]).then(() => drawAll());
  const resizer = new ResizeObserver(() => drawPreview());
  resizer.observe(stage);

  // --- taking shots again, live: one at a time, always the latest change ---
  /** The other layers that share a layer's shot (none when it is not shared). */
  let wheelTimer = 0;
  /** The wheel's travel not yet taken as a step of size. */
  let wheelSum = 0;
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
      x.dx = l.dx; x.dy = l.dy; x.scale = l.scale; x.hidden = l.hidden; x.rotation = l.rotation; x.mask = l.mask ? structuredClone(l.mask) : undefined; x.opacity = l.opacity; x.blend = l.blend;
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
    wheeling = false;
    clearTimeout(wheelSettle);
    if (panelLater) { panelLater = false; if (layerPicked) showLayer(); }
    // let go: what was taken live (quick, at half size) is taken again in full; what waits to be taken live, in full
    for (const job of waiting.values()) job.live = false;
    for (const [l, p] of takenLive) if (!waiting.has(l)) queueRetake(p, l);
    takenLive.clear();
  };
  window.addEventListener("pointerup", released);
  // the wheel over a slider (or the board) is a drag too: quick shots while it turns, taken in full once it has stopped a moment
  let wheeling = false, wheelSettle = 0;
  root.addEventListener("wheel", () => {
    wheeling = true;
    clearTimeout(wheelSettle);
    wheelSettle = window.setTimeout(() => { if (!pointerHeld) released(); }, 300);
  }, true);
  // what this board holds on the window goes when it is closed (or its pictures would stay alive with it)
  const dispose = () => { window.removeEventListener("pointerup", released); resizer.disconnect(); boardKeys.delete(keys); };
  /**
   * The shots waiting to be taken again; `live`: in the middle of a drag (a slider, the camera window), taken quick and at half size,
   * so that the board follows the drag without holding up the app; they are taken again in full when it is let go (`takenLive`).
   */
  const waiting = new Map<PromoLayer, { p: PromoPicture; before?: () => Promise<void>; live: boolean }>();
  const takenLive = new Map<PromoLayer, PromoPicture>();
  /** The board's other charts of the same item (its other styles), each with its picture, that keep in step with this one. */
  const chartSiblings = (l: PromoLayer) => {
    const c = l.chart;
    if (!c || c.sync === false) return [];
    return pictures.flatMap((q) => q.layers.map((x) => [q, x] as const))
      .filter(([, x]) => x !== l && x.chart && x.chart !== c && x.chart.sync !== false && x.chart.item === c.item && x.chart.role === c.role);
  };
  /** The picture's other shots of the same items in other styles (the Styles picture): linked unless one was unlinked. */
  const styleSiblings = (p: PromoPicture, l: PromoLayer) => {
    const s = l.shot;
    if (!s || s.sync === false || s.group) return [];
    const items = (x: ShotSpec) => x.loadout.map((w) => w.item).sort().join(",");
    const styles = (x: ShotSpec) => x.loadout.map((w) => `${w.item}:${w.style}`).sort().join(",");
    return p.layers.filter((x) => x !== l && x.shot && x.shot !== s && x.shot.sync !== false && !x.shot.group && x.shot.role === s.role && items(x.shot) === items(s) && styles(x.shot) !== styles(s));
  };
  function retake(p: PromoPicture, l: PromoLayer, before?: () => Promise<void>) {
    // a style shot's camera goes to the other styles' shots (each keeps its style)
    if (l.shot && !before) {
      const s = l.shot;
      const aim = (x: ShotSpec) => JSON.stringify([x.yaw, x.pitch, x.fill, x.panX, x.panY, x.light, x.particles, x.scaleDistance]);
      for (const x of styleSiblings(p, l)) {
        const o = x.shot!;
        if (aim(o) === aim(s)) continue;
        Object.assign(o, { yaw: s.yaw, pitch: s.pitch, fill: s.fill, panX: s.panX, panY: s.panY, light: s.light ? { ...s.light } : undefined, particles: s.particles ? { ...s.particles } : undefined, scaleDistance: s.scaleDistance });
        queueRetake(p, x);
      }
    }
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
  /**
   * The point of a picture its shadows fan out from or converge to, in a shot's image (see ShotSpec.spreadPoint): from the picture's floor
   * line (the middle, low on it), along the way the shadows fall on the picture (Direction: 0 is up it, back), toward them to converge or
   * against them to fan out, nearer the stronger the spread (0.6 of the picture's height off at ±1); undefined without a spread.
   */
  const spreadPointOf = (p: PromoPicture, l: PromoLayer): [number, number] | undefined => {
    const s = look.effects?.shadow;
    if (!s?.on || !s.spread) return undefined;
    const a = (s.azimuth * Math.PI) / 180, reach = (p.h * 0.6) / Math.abs(s.spread), sign = s.spread < 0 ? 1 : -1;
    const x = p.w / 2 + sign * Math.sin(a) * reach, y = p.h * 0.85 - sign * Math.cos(a) * reach;
    const r = layerRect(l);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return [round((x - r.x) / Math.max(1, r.w)), round((y - r.y) / Math.max(1, r.h))];
  };
  /** Shots moved on their picture: with spread shadows, taken again (their shadows fan out from, or converge to, a point of the picture). */
  function spreadMoved(p: PromoPicture, shots: PromoLayer[]) {
    for (const l of shots) {
      const want = l.shot ? spreadPointOf(p, l) : undefined, had = l.shot?.spreadPoint;
      if (want && (!had || Math.hypot(want[0] - had[0], want[1] - had[1]) > 0.01)) retake(p, l);
    }
  }
  function queueRetake(p: PromoPicture, l: PromoLayer, before?: () => Promise<void>) {
    const queued = waiting.get(l);
    // a change made while one waits replaces it (keeping a re-roll that was asked for)
    waiting.set(l, { p, before: before ?? queued?.before, live: (pointerHeld || wheeling) && !before && !queued?.before });
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
          if (l.shot) l.shot.spreadPoint = spreadPointOf(job.p, l);
          await host.retake(l, job.live);
          if (job.live) takenLive.set(l, job.p);
          else takenLive.delete(l);
          measureContent(l);
          host.changed();
          // a shared shot is the same picture everywhere it is used
          for (const [q, x] of instancesOf(l)) { x.image = l.image; x.content = l.content; x.opaque = l.opaque; x.cells = l.cells; draw(q); }
          draw(job.p, job.live);
          status.textContent = "";
          // (a drag's steps one a frame at most, with the app's own frames between them)
          if (job.live) await new Promise((res) => requestAnimationFrame(res));
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
      if (pointerHeld || wheeling) panelLater = true;
      else showLayer();
    }
    panelStale = false;
  }

  // --- the shared look ---
  // (the controls are the app's own: a row of a key and its control, a slider with its number, a checkbox with its name; tokens.css)
  /** The number box beside each slider made by `range`. */
  const numbers = new WeakMap<HTMLInputElement, HTMLInputElement>();
  /** A row of a key and its control (a slider gets its number box beside it). */
  const field = (box: HTMLElement, label: string, input: HTMLElement, title?: string) => {
    const row = document.createElement("div");
    row.className = "ui-prop";
    const key = document.createElement("span");
    key.className = "ui-key";
    key.textContent = label;
    key.title = title ?? (input.dataset.live ? label : input.title || label);
    const val = document.createElement("div");
    const num = input instanceof HTMLInputElement ? numbers.get(input) : undefined;
    val.className = num ? "ui-val" : "ui-val single";
    val.append(input, ...(num ? [num] : []));
    row.append(key, val);
    box.appendChild(row);
    return row;
  };
  /** A slider, with a box beside it to read or type its number in (see `field`); with `show`, the value is its tooltip as well. */
  const range = (min: number, max: number, step: number, value: number, onInput: (v: number) => void, show?: (v: number) => string) => {
    const decimals = (String(step).split(".")[1] ?? "").length;
    const i = document.createElement("input");
    i.type = "range";
    i.className = "ui-range";
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(value);
    const num = document.createElement("input");
    num.type = "number";
    num.className = "ui-num";
    num.min = String(min); num.max = String(max); num.step = String(step);
    num.value = value.toFixed(decimals);
    if (show) { i.title = show(value); i.dataset.live = "1"; }
    i.oninput = () => { num.value = Number(i.value).toFixed(decimals); if (show) i.title = show(Number(i.value)); onInput(Number(i.value)); };
    num.onfocus = () => num.select();
    num.onchange = () => {
      const typed = Number(num.value);
      const v = Number.isFinite(typed) ? Math.min(max, Math.max(min, typed)) : Number(i.value);
      num.value = v.toFixed(decimals);
      i.value = String(v);
      if (show) i.title = show(v);
      onInput(v);
      i.dispatchEvent(new Event("change"));
    };
    numbers.set(i, num);
    return i;
  };
  const colour = (value: string, onInput: (v: string) => void) => {
    const i = document.createElement("input");
    i.type = "color";
    i.value = value;
    i.oninput = () => onInput(i.value);
    return i;
  };
  /** The wheel over a list steps through its choices (down: the next one), as a pick of it would. */
  const wheelSelect = (sel: HTMLSelectElement) => {
    sel.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (sel.disabled || !e.deltaY) return;
      const i = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + Math.sign(e.deltaY)));
      if (i === sel.selectedIndex) return;
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, { passive: false });
    return sel;
  };
  /** A checkbox with its name after it (the app's switches); in a row of them when they follow one another. */
  const check = (box: HTMLElement, label: string, on: boolean, change: (v: boolean) => void, title = "") => {
    let row = box.lastElementChild as HTMLElement | null;
    if (!row?.classList.contains("promoChecks")) {
      row = document.createElement("div");
      row.className = "promoChecks";
      box.appendChild(row);
    }
    const name = document.createElement("label");
    name.title = title;
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = on;
    c.onchange = () => change(c.checked);
    name.append(c, ` ${label}`);
    row.appendChild(name);
    return c;
  };
  /** A row of buttons; the one marked primary is the main thing to do. */
  const buttons = (box: HTMLElement, list: { label: string; title?: string; run: () => void; primary?: boolean }[]) => {
    const row = document.createElement("div");
    row.className = "btns";
    for (const b of list) {
      const el = document.createElement("button");
      el.textContent = b.label;
      if (b.title) el.title = b.title;
      if (b.primary) el.className = "primary";
      el.onclick = b.run;
      row.appendChild(el);
    }
    box.appendChild(row);
    return row;
  };
  /** A heading of the panel; with `tools`, buttons at its right (what the section does, kept out of its rows). */
  const heading = (box: HTMLElement, text: string, title?: string, tools: { label: string; title?: string; run: () => void; primary?: boolean }[] = []) => {
    const h = document.createElement("h3");
    h.textContent = text;
    if (title) h.title = title;
    if (tools.length) {
      const span = document.createElement("span");
      span.className = "promoHeadBtns";
      for (const b of tools) {
        const el = document.createElement("button");
        el.textContent = b.label;
        if (b.title) el.title = b.title;
        if (b.primary) el.className = "primary";
        el.onclick = (e) => { e.stopPropagation(); b.run(); };
        span.appendChild(el);
      }
      h.appendChild(span);
    }
    box.appendChild(h);
    return h;
  };
  function changedLook() {
    keepLook();
    drawAll();
  }
  const lookBackdrop = $(".promoLookBackdrop");
  // the backdrop of every picture: a category and thumbnails to pick from (a step of a fade only draws, the last one is kept)
  const lookPicker = createBackdropPicker({ get: () => look.backdrop, set: (b, live) => { look.backdrop = b; if (live) drawAll(); else changedLook(); }, picture: true });
  lookBackdrop.append(lookPicker.el);
  const showLookBackdrop = () => lookPicker.refresh();
  $(".promoShuffle").onclick = () => { look.backdrop = randomBackdrop(); showLookBackdrop(); changedLook(); };
  // (the border's settings show on the right, when Border is picked in the layers)
  const strokeBox = document.createElement("div");
  function showLookStroke() {
    strokeBox.innerHTML = "";
    check(strokeBox, "Border", look.stroke.on, (v) => { look.stroke.on = v; changedLook(); }, "A line round every picture, inside its edge");
    field(strokeBox, "Width", range(0, 16, 0.5, look.stroke.width, (v) => { look.stroke.width = v; changedLook(); }));
    field(strokeBox, "Inset", range(0, 120, 1, look.stroke.inset, (v) => { look.stroke.inset = v; changedLook(); }));
    field(strokeBox, "Corners", range(0, 200, 1, look.stroke.radius, (v) => { const was = look.stroke.radius; look.stroke.radius = v; changedLook(); if ((was > 0) !== (v > 0)) showLookStroke(); }), "How round the corners are (0: square)");
    if (look.stroke.radius > 0) check(strokeBox, "Cut the corners", look.stroke.cut, (v) => { look.stroke.cut = v; changedLook(); }, "The picture cut round the border's corners (transparent outside them), not square behind them");
    // its colour: the backdrop's, made lighter (a brighter band of the same gradient), or one of its own
    const mode = document.createElement("select");
    mode.add(new Option("The backdrop's", "backdrop"));
    mode.add(new Option("Its own", "colour"));
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
    check(glowBox, "Glow", g.on, (v) => { g.on = v; changedLook(); }, "A dark glow round the characters, so they stand out from the backdrop");
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
      const wanted = shotEffectsOf(look.effects!), fx = JSON.stringify(wanted);
      for (const p of pictures) for (const l of p.layers) {
        if (!l.shot || JSON.stringify(l.shot.effects ?? DEFAULT_SHOT_EFFECTS) === fx) continue;
        l.shot.effects = structuredClone(wanted);
        retake(p, l);
      }
    };
    if (now) go();
    else fxTimer = window.setTimeout(go, 250);
  }
  function showLookFx() {
    fxBox.innerHTML = "";
    const fx = (look.effects ??= structuredClone(DEFAULT_SHOT_EFFECTS));
    const box = (label: string, get: () => boolean, set: (v: boolean) => void, title: string) =>
      check(fxBox, label, get(), (v) => { set(v); changedEffects(true); showLookFx(); }, title);
    box("The 3D view's look", () => fx.look, (v) => (fx.look = v), "The post-processing of the 3D view (its colour grade, bloom, ambient occlusion, depth of field, and so on) in every shot, as the view has it now");
  }
  showLookFx();
  // the shadows: each character's, cast in its 3D scene onto the floor from one light for every shot (the characters are turned, the
  // cameras all at the front, so it falls the same way in every picture). Their shape is taken again when it changes (after a moment, not
  // at every step of a slider); their opacity is the board's, at once.
  const shadowBox = $(".promoLookShadow");
  function showLookShadow() {
    shadowBox.innerHTML = "";
    const s = (look.effects ??= structuredClone(DEFAULT_SHOT_EFFECTS)).shadow;
    check(shadowBox, "Shadows", s.on, (v) => { s.on = v; changedEffects(true); showLookShadow(); }, "The shadow each character casts on the floor (the items shown alone cast none)");
    if (!s.on) return;
    const shape = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, title: string, show?: (v: number) => string) =>
      field(shadowBox, label, range(min, max, step, get(), (v) => { set(v); changedEffects(); }, show), title);
    shape("Direction", -180, 180, 1, () => (((s.azimuth + 180) % 360) + 360) % 360 - 180, (v) => (s.azimuth = v), "Which way the shadows fall (0: straight back, behind the characters)", (v) => `${v}°`);
    shape("Spread", -1, 1, 0.01, () => s.spread ?? 0, (v) => (s.spread = v), "0: the shadows are parallel; above, they fan out (a light near them); below, they converge (toward a point beyond them)");
    shape("Length", 0.05, 2, 0.01, () => s.length, (v) => (s.length = v), "How long a shadow is for the height of what casts it");
    shape("Softness", 0, 4, 0.01, () => s.blur, (v) => (s.blur = v), "How blurred the shadows are");
    shape("Taper", 0, 1, 0.01, () => s.taper ?? 0, (v) => (s.taper = v), "How much lighter the shadows get the farther they reach from the feet (dark at the feet)");
    field(shadowBox, "Colour", colour(s.color ?? "#000000", (v) => { s.color = v; changedLook(); }), "The shadows' colour: black, or a hue of the backdrop's (a deep blue or purple looks softer than black; at once)");
    const blend = document.createElement("select");
    for (const [value, label] of SHADOW_BLENDS) blend.add(new Option(label, value));
    blend.value = s.blend ?? "source-over";
    blend.onchange = () => { s.blend = blend.value as ShadowBlend; changedLook(); };
    wheelSelect(blend);
    field(shadowBox, "Blend", blend, "How the shadows are laid on the backdrop: Multiply darkens it by their colour (the best with a colour), Colour burn deepens and saturates it, Soft light and Overlay are gentler (at once)");
    field(shadowBox, "Opacity", range(0, 1, 0.01, s.opacity, (v) => { s.opacity = v; changedLook(); if (look.effects?.look) changedEffects(); }), "How dark the shadows are (at once: the shots are not taken again)");
  }
  showLookShadow();
  // (with spread shadows, the shots that do not know where their picture's middle is yet, such as a set's just made, are taken again)
  for (const p of pictures) spreadMoved(p, p.layers);
  // shots made before the board had these settings take them on
  if (pictures.some((p) => p.layers.some((l) => l.shot && JSON.stringify(l.shot.effects ?? DEFAULT_SHOT_EFFECTS) !== JSON.stringify(shotEffectsOf(look.effects ?? DEFAULT_SHOT_EFFECTS))))) changedEffects(true);
  // the thumbnails' studio light is the board's (the one kept from before, else the first linked thumbnail's): those that differ take it
  // (`studioTimer`: the moment the others are taken again after a change of it, see syncStudio)
  let studioTimer = 0;
  {
    const first = thumbnailShots().find(([, l]) => !l.shot!.studioOwn);
    if (first) {
      look.studio ??= parseStudio(first[1].shot!.studio ?? DEFAULT_STUDIO);
      syncStudio(null, true);
    }
  }

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
  function showThumbs() {
  thumbsBox.replaceChildren();
  thumbs.clear();
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
      card.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: "New page after it", run: () => addPage(p) },
          { label: "Delete this page", disabled: pictures.length < 2, run: () => deletePage(p) },
        ]);
      };
    }
    box.appendChild(cards);
    thumbsBox.appendChild(box);
  }
  // a new blank page, the size of the one shown
  const add = document.createElement("button");
  add.className = "promoThumbAdd";
  add.title = "A new blank page (the size of the one shown)";
  add.setAttribute("aria-label", "New page");
  add.innerHTML = icon("plus");
  add.style.height = `${THUMB_H}px`;
  add.onclick = () => addPage(picked);
  thumbsBox.appendChild(add);
  for (const p of pictures) if (picked === p) thumbs.get(p)?.parentElement?.classList.add("on");
  }
  showThumbs();
  /** A blank page after `after` (the last when absent), in its group, the size of it; it is shown. */
  function addPage(after: PromoPicture | null) {
    const like = after ?? pictures.at(-1);
    const taken = new Set(pictures.map((q) => q.name));
    let n = pictures.length + 1;
    while (taken.has(`Page_${n}`)) n++;
    const p: PromoPicture = { name: `Page_${n}`, item: like?.item, kind: `Page ${n}`, w: like?.w ?? 1920, h: like?.h ?? 1080, layers: [], texts: [], backdrop: null };
    const at = like ? pictures.indexOf(like) + 1 : pictures.length;
    pictures.splice(at, 0, p);
    showThumbs();
    drawAll();
    pick(p);
    host.changed();
    thumbs.get(p)?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function deletePage(p: PromoPicture) {
    if (pictures.length < 2) return;
    const at = pictures.indexOf(p);
    if (at < 0) return;
    pictures.splice(at, 1);
    // its steps of undo would bring back layers of a page that is gone
    undoStack.length = 0;
    redoStack.length = 0;
    showHistory();
    showThumbs();
    drawAll();
    pick(pictures[Math.min(at, pictures.length - 1)]);
    host.changed();
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
  const pointAt = (e: MouseEvent) => {
    const r = preview.getBoundingClientRect();
    const k = picked ? picked.w / r.width : 1;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k] as const;
  };
  /** The shot under a point: the topmost whose picture is not see-through there (its margin is empty, the shot under it shows). */
  const layerAt = (px0: number, py0: number) =>
    picked ? [...picked.layers].reverse().find((l) => {
      if (l.hidden || l.overlay) return false; // (a background overlay is picked in the layers: it would catch every click)
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
  // a double click on a character (a shot, or a line-up) opens it in 3D, as the Edit in 3D button does
  preview.ondblclick = (ev) => {
    const p = picked;
    if (!p || ev.shiftKey || ev.button !== 0) return;
    const [x, y] = pointAt(ev);
    const hit = layerAt(x, y);
    if (!hit?.shot) return;
    selectOnly(hit);
    showInspector();
    drawPreview();
    void editIn3D(p, hit);
  };
  preview.onpointerdown = (ev) => {
    const p = picked;
    if (!p) return;
    const [x0, y0] = pointAt(ev);
    // shaping a mask: its handles, or a new gradient (the right button still opens the menu)
    if (maskEdit && p.layers.includes(maskEdit) && ev.button === 0) { maskPointerDown(ev, p, maskEdit, x0, y0); return; }
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
        preview.onpointermove = maskHoverMove;
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
    const box = (() => { const b = transformBox(); return b?.fixed ? null : b; })();
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
      preview.onpointerup = () => { preview.onpointermove = maskHoverMove; draw(p); shots.forEach(placeShared); showLayer(); spreadMoved(p, shots); };
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
        preview.onpointerup = () => { preview.onpointermove = maskHoverMove; draw(p); shots.forEach(placeShared); showLayer(); sharpen(p, shots); spreadMoved(p, shots); };
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
    // nothing else under it, and a background overlay picked: its texture slides with the drag
    const overlay = !hit && ev.button === 0 ? selected().find((x) => x.overlay) : undefined;
    if (overlay?.overlay) {
      ev.preventDefault();
      preview.setPointerCapture(ev.pointerId);
      const o = overlay.overlay, sx = o.ox ?? 0, sy = o.oy ?? 0, g = o.ground, gx = g?.cx ?? 0, gy = g?.cy ?? 0;
      let frame = 0;
      preview.onpointermove = (m) => {
        const [x, y] = pointAt(m);
        // (a ground is moved about the picture; the tiling of a background overlay slides)
        if (g) { g.cx = Math.round((gx + (x - x0) / p.w) * 1000) / 1000; g.cy = Math.round((gy + (y - y0) / p.h) * 1000) / 1000; }
        else { o.ox = Math.round(sx + x - x0); o.oy = Math.round(sy + y - y0); }
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => void retile(p, overlay));
      };
      preview.onpointerup = () => { preview.onpointermove = maskHoverMove; void retile(p, overlay).then(() => showLayer()); };
      return;
    }
    // a click on nothing keeps what is selected (another character clicked is what changes it)
    if (!hit) return;
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
      preview.onpointermove = maskHoverMove;
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
  preview.onpointermove = maskHoverMove;
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
    // nothing under it, and a background overlay picked: its tiles grow or shrink about the pointer, in steps of 0.05
    const overlay = !l ? selected().find((s) => s.overlay) : undefined;
    if (overlay?.overlay) {
      ev.preventDefault();
      wheelSum += ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
      const steps = Math.trunc(wheelSum / 100);
      if (!steps) return;
      wheelSum -= steps * 100;
      const o = overlay.overlay, was = o.tile;
      if (o.ground) {
        // (a ground is sized, as wide and as deep in the same proportion)
        o.ground.width = Math.max(0.1, Math.min(4, Math.round((Math.round(o.ground.width / WHEEL_STEP) - steps) * WHEEL_STEP * 100) / 100));
        void retile(p, overlay).then(() => showLayer());
        return;
      }
      o.tile = Math.max(0.1, Math.min(4, Math.round((Math.round(was / WHEEL_STEP) - steps) * WHEEL_STEP * 100) / 100));
      // (the point of the texture under the pointer stays under it)
      o.ox = Math.round(x - (x - (o.ox ?? 0)) * (o.tile / was));
      o.oy = Math.round(y - (y - (o.oy ?? 0)) * (o.tile / was));
      void retile(p, overlay).then(() => showLayer());
      return;
    }
    if (!l || l.chart) return;
    ev.preventDefault();
    if (!selection.includes(l)) { selectOnly(l); showInspector(); }
    const all = selectionRect();
    if (!all) return;
    // a notch of the wheel is a step of 0.05 of the scale, on the 0.05s (a trackpad's small steps add up to one)
    wheelSum += ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
    const steps = Math.trunc(wheelSum / 100);
    if (!steps) return;
    wheelSum -= steps * 100;
    for (const x of selected()) {
      const to = Math.round((Math.round(x.scale / WHEEL_STEP) - steps) * WHEEL_STEP * 100) / 100;
      sizeAbout(x, Math.max(0.2, Math.min(3, to)), [all.x + all.w / 2, all.y + all.h / 2]);
    }
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
  /** The selected layer's actions (copy, duplicate, its link, delete): in the Layers section, over the list. */
  const actionsBox = document.createElement("div");
  actionsBox.className = "promoLayerActions";
  /** What the selected layer's link is (under the row of the layers' buttons). */
  const linkNote = document.createElement("p");
  linkNote.className = "dim hint promoLinkNote";
  const layerBox = document.createElement("div");
  function showInspector() {
    const p = picked;
    inspector.innerHTML = "";
    if (!p) {
      inspector.innerHTML = `<p class="dim">Pick a picture above.</p>`;
      return;
    }
    pictureBox.innerHTML = "";
    heading(pictureBox, `${p.kind} picture`, cardTitle(p)).classList.add("first");
    const name = document.createElement("input");
    name.type = "text";
    name.value = p.name;
    name.setAttribute("aria-label", "File name");
    name.oninput = () => {
      p.name = name.value.replace(/[\\/:*?"<>|]+/g, "").trim() || p.name;
      thumbs.get(p)!.parentElement!.title = cardTitle(p);
    };
    field(pictureBox, "File name", name);
    const ownBox = document.createElement("div");
    const showOwn = () => {
      ownBox.innerHTML = "";
      if (!p.backdrop) return;
      const ownPicker = createBackdropPicker({ get: () => p.backdrop!, set: (b) => { p.backdrop = b; draw(p); }, picture: true });
      ownBox.appendChild(ownPicker.el);
      buttons(ownBox, [{ label: "Shuffle", title: "Another random neutral gradient", run: () => { p.backdrop = randomBackdrop(); showOwn(); draw(p); } }]);
    };
    check(pictureBox, "A backdrop of its own", !!p.backdrop, (v) => { p.backdrop = v ? { ...look.backdrop } : null; draw(p); showInspector(); },
      "This picture's own backdrop, in place of the one every picture has");
    pictureBox.appendChild(ownBox);
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
      row.className = "hierRow fixed";
      row.innerHTML = `<span class="hierIcon">${icon(BACKDROP_ICON)}</span><span class="hierLabel"></span><span class="hierCount"></span>`;
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
        row.className = "hierRow border hierObject";
        row.classList.toggle("selected", borderPicked);
        row.classList.toggle("primary", borderPicked);
        row.title = "Click for its settings · drag up or down: the layers above it are drawn over the border";
        row.onclick = () => { selectOnly(null); borderPicked = true; showInspector(); drawPreview(); };
        row.innerHTML = `<span class="hierIcon">${icon(BORDER_ICON)}</span><span class="hierLabel">Border</span>`;
        dragRow(row, BORDER, "Border");
        stack.appendChild(row);
        continue;
      }
      const l = entry;
      const row = document.createElement("div");
      row.className = "hierRow hierObject";
      row.classList.toggle("selected", selection.includes(l));
      row.classList.toggle("primary", l === layerPicked);
      row.classList.toggle("dimmed", l.hidden);
      row.title = "Drag up or down to put it over or under the others (and the border) · Shift-click to select more";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(selection.includes(l)));
      const kind = document.createElement("span");
      kind.className = "hierIcon";
      kind.innerHTML = icon(l.text ? TEXT_ICON : l.chart ? CHART_ICON : l.overlay?.ground ? "ground" : l.overlay ? "grid3x3" : l.shot ? SHOT_ICON : "image");
      const name = document.createElement("span");
      name.className = "hierLabel";
      name.textContent = l.name;
      row.append(kind, name);
      const linked = linkedWith(l).length;
      if (linked) {
        const chain = document.createElement("span");
        chain.className = "hierIcon promoChain";
        chain.innerHTML = icon(LINK_ICON);
        chain.title = `Linked: the same shot and place in ${linked} other picture${linked === 1 ? "" : "s"}`;
        row.appendChild(chain);
      }
      const eye = document.createElement("button");
      eye.className = "hierEye";
      eye.innerHTML = icon(l.hidden ? HIDDEN_ICON : EYE_ICON);
      eye.title = l.hidden ? "Show" : "Hide";
      eye.setAttribute("aria-pressed", String(l.hidden));
      eye.onclick = (e) => { e.stopPropagation(); l.hidden = !l.hidden; draw(p); placeShared(l); showInspector(); };
      row.appendChild(eye);
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
    pictureBox.append(lh, stack);
    // what can be added to the picture, and what the selected layer can do (copied, duplicated, deleted), in one row under the layers
    const addRow = buttons(pictureBox, [{ label: "+ Add", title: "Add a text, a character or an image to this picture", run: () => {
      const r = addRow.querySelector("button")!.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 4, [
        { label: "Text", run: () => void addLayer(p, async () => textLayer("Text", { ...DEFAULT_TEXT }, p.w / 2, p.h / 2)) },
        "-",
        { label: "Characters…", run: () => charactersPopup(p, r.left, r.bottom + 4) },
        "-",
        { label: "Image from a file…", run: () => void addImage(p) },
        { label: "Background overlay…", run: () => openTextureBrowser((tex) => void addOverlay(p, tex)) },
        { label: "Ground", run: () => void addGround(p) },
      ]);
    } }]);
    addRow.classList.add("promoLayerTools");
    addRow.append(actionsBox);
    pictureBox.append(linkNote);
    inspector.append(pictureBox, layerBox);
    showLayer();
  }

  /** Puts a new layer on top of a picture (one step of undo) and selects it. */
  async function addLayer(p: PromoPicture, make: () => Promise<PromoLayer>) {
    const was = snapshot();
    let l: PromoLayer;
    try {
      l = await make();
    } catch (err) {
      status.textContent = `Could not add it: ${String(err)}`;
      return;
    }
    measureContent(l);
    p.layers.push(l);
    pushUndo(was);
    if (picked === p) selectOnly(l);
    draw(p);
    drawPreview();
    showInspector();
  }
  /** New characters in the middle of a picture, as tall as it: one alone, or a group in one scene (its look is changed in 3D). */
  function addCharacters(p: PromoPicture, chars: { cls: string; team: 0 | 1 }[]) {
    status.textContent = chars.length > 1 ? "Taking the group shot…" : "Taking the character…";
    const h = Math.round(p.h * 0.98);
    const w = Math.round(Math.min(p.w - 20, chars.length > 1 ? h * (0.42 * chars.length + 0.15) : h * 0.66));
    return addLayer(p, async () => {
      const l = await host.newShot(chars, (p.w - w) / 2, (p.h - h) / 2, w, h);
      status.textContent = "Added. Edit in 3D (or right-click it) to dress, pose or change a class.";
      return l;
    });
  }
  /** The window that picks new characters: each one's class and team; two or more stand together in one scene. */
  function charactersPopup(p: PromoPicture, x: number, y: number) {
    document.querySelector(".promoCharsPop")?.remove();
    const classes = host.classes();
    if (!lastChars.length || !lastChars.every((c) => classes.some((k) => k.cls === c.cls))) lastChars = [{ cls: host.boardClass(), team: 0 }];
    const rows = lastChars.map((c) => ({ ...c }));
    const pop = document.createElement("div");
    pop.className = "promoCharsPop";
    pop.style.left = `${Math.round(Math.min(x, window.innerWidth - 300))}px`;
    pop.style.top = `${Math.round(y)}px`;
    const close = () => { pop.remove(); window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", esc, true); };
    const outside = (e: PointerEvent) => { if (!pop.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const render = () => {
      pop.replaceChildren();
      const list = document.createElement("div");
      list.className = "list";
      rows.forEach((c, i) => {
        const row = document.createElement("div");
        row.className = "row";
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", `Character ${i + 1}: class`);
        for (const k of classes) sel.add(new Option(k.label, k.cls, false, k.cls === c.cls));
        sel.onchange = () => { c.cls = sel.value; };
        const seg = document.createElement("div");
        seg.className = "seg";
        for (const [t, label] of [[0, "RED"], [1, "BLU"]] as const) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = label;
          b.className = c.team === t ? `on t${t}` : "";
          b.onclick = () => { c.team = t; render(); };
          seg.append(b);
        }
        const del = document.createElement("button");
        del.type = "button";
        del.className = "del";
        del.title = "Take this one out";
        del.innerHTML = icon("x");
        del.disabled = rows.length < 2;
        del.onclick = () => { rows.splice(i, 1); render(); };
        row.append(sel, seg, del);
        list.append(row);
      });
      const more = document.createElement("button");
      more.type = "button";
      more.className = "more";
      more.textContent = "+ Another character";
      more.disabled = rows.length >= 4;
      more.onclick = () => { const last = rows.at(-1)!; rows.push({ cls: last.cls, team: last.team }); render(); };
      const hint = document.createElement("p");
      hint.className = "dim hint";
      hint.textContent = rows.length > 1 ? `${rows.length} characters together in one scene (a group shot).` : "One character alone. Add more to put them together in one scene.";
      const go = document.createElement("button");
      go.type = "button";
      go.className = "primary";
      go.textContent = "Add";
      go.onclick = () => { lastChars = rows.map((c) => ({ ...c })); close(); void addCharacters(p, rows); };
      pop.append(list, more, hint, go);
    };
    render();
    document.body.append(pop);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", esc, true);
  }
  /** A background overlay: a game texture tiled over the whole picture, faint, under everything but the backdrop. */
  async function addOverlay(p: PromoPicture, texture: string) {
    status.textContent = "Reading the texture…";
    const was = snapshot();
    const spec: OverlaySpec = { texture, tile: 1, grey: true };
    let l: PromoLayer;
    try {
      l = { ...layer(texture.split("/").pop() || "Overlay", await overlayImage(spec, p.w, p.h), 0, 0, p.w, p.h), overlay: spec, opacity: 0.35, blend: "overlay" };
    } catch (err) {
      status.textContent = `Could not read the texture: ${String(err)}`;
      return;
    }
    l.opaque = { x0: 0, y0: 0, x1: l.image.width, y1: l.image.height };
    p.layers.unshift(l);
    if (p.strokeAt !== undefined) p.strokeAt++;
    pushUndo(was);
    status.textContent = "";
    if (picked === p) selectOnly(l);
    draw(p);
    drawPreview();
    showInspector();
  }
  /**
   * A ground: a floor under the characters (as the 3D view's ground plane), an ellipse that fades out at its edge, laid on the backdrop as a
   * shade of it; a texture can be put on it in its settings. It goes over the background overlays and under everything else.
   */
  async function addGround(p: PromoPicture) {
    const was = snapshot();
    const spec: OverlaySpec = { texture: "", tile: 1, grey: true, ground: { ...DEFAULT_GROUND_SPEC } };
    const l: PromoLayer = { ...layer("Ground", await overlayImage(spec, p.w, p.h), 0, 0, p.w, p.h), overlay: spec, blend: "multiply" };
    l.opaque = { x0: 0, y0: 0, x1: l.image.width, y1: l.image.height };
    let at = 0;
    while (at < p.layers.length && p.layers[at].overlay && !p.layers[at].overlay!.ground) at++;
    p.layers.splice(at, 0, l);
    if (p.strokeAt !== undefined && p.strokeAt >= at) p.strokeAt++;
    pushUndo(was);
    if (picked === p) selectOnly(l);
    draw(p);
    drawPreview();
    showInspector();
  }
  /** An overlay's image made again from its texture, as its settings now say (at once when the texture is read already). */
  let retileRun = 0;
  async function retile(p: PromoPicture, l: PromoLayer) {
    if (!l.overlay) return;
    const run = ++retileRun;
    const image = await overlayImage(l.overlay, p.w, p.h).catch(() => null);
    if (!image || run !== retileRun) return;
    l.image = image;
    draw(p);
    drawPreview();
    host.changed();
  }
  /** The settings of a background overlay: its texture, its tiles, how it is laid over the backdrop. */
  function overlayFields(p: PromoPicture, l: PromoLayer, o: OverlaySpec) {
    if (o.ground) return groundFields(p, l, o, o.ground);
    heading(layerBox, "Texture", o.texture, [{ label: "Change…", title: "Another texture from the game", run: () => openTextureBrowser((tex) => { o.texture = tex; l.name = tex.split("/").pop() || l.name; void retile(p, l).then(() => { host.changed(); showInspector(); }); }, o.texture) }]);
    field(layerBox, "Tile size", range(0.1, 4, 0.05, o.tile, (v) => { o.tile = v; void retile(p, l); }, (v) => `${v.toFixed(2)}×`), "How large the texture's tiles are (1: as the game has them)");
    field(layerBox, "Rotation", range(-180, 180, 1, o.rot ?? 0, (v) => { o.rot = v || undefined; void retile(p, l); }, (v) => `${v}°`), "How far the texture is turned");
    check(layerBox, "Grey", o.grey, (v) => { o.grey = v; void retile(p, l); }, "Without its colours: only its light and shade show over the backdrop");
    blendFields(p, l);
  }
  /** The settings of a ground: its size and look, then its texture (none at first: one is picked from the game's). */
  function groundFields(p: PromoPicture, l: PromoLayer, o: OverlaySpec, g: GroundSpec) {
    const again = () => void retile(p, l);
    field(layerBox, "Width", range(0.1, 4, 0.01, g.width, (v) => { g.width = v; again(); }, (v) => `${Math.round(v * 100)}%`), "How wide it is, of the picture's width (the wheel over the board sizes it too)");
    field(layerBox, "Depth", range(0.05, 1, 0.01, g.depth, (v) => { g.depth = v; again(); }), "How deep it is for its width: low for a floor seen from the side, high for one seen from above");
    field(layerBox, "Softness", range(0, 1, 0.01, g.softness, (v) => { g.softness = v; again(); }), "How much of it fades out towards its edge (0: a hard edge)");
    field(layerBox, "Colour", colour(g.color, (v) => { g.color = v; again(); }), "Its colour (with Multiply, it shades the backdrop: white leaves it as it is)");
    blendFields(p, l);
    heading(layerBox, "Texture", o.texture || "No texture on it", o.texture
      ? [{ label: "Change…", title: "Another texture from the game", run: () => openTextureBrowser((tex) => { o.texture = tex; void retile(p, l).then(() => { host.changed(); showInspector(); }); }, o.texture) },
         { label: "Remove", title: "The ground without a texture", run: () => { o.texture = ""; void retile(p, l).then(() => { host.changed(); showInspector(); }); } }]
      : [{ label: "Add…", title: "Lay a texture from the game on the ground", run: () => openTextureBrowser((tex) => { o.texture = tex; void retile(p, l).then(() => { host.changed(); showInspector(); }); }) }]);
    if (!o.texture) return;
    field(layerBox, "Strength", range(0, 1, 0.01, g.texStrength, (v) => { g.texStrength = v; again(); }), "How strongly the texture shows over the ground's colour");
    field(layerBox, "Tile size", range(0.1, 4, 0.05, o.tile, (v) => { o.tile = v; again(); }, (v) => `${v.toFixed(2)}×`), "How large the texture's tiles are (1: as the game has them)");
    field(layerBox, "Rotation", range(-180, 180, 1, o.rot ?? 0, (v) => { o.rot = v || undefined; again(); }, (v) => `${v}°`), "How far the texture is turned on the floor");
    check(layerBox, "Grey", o.grey, (v) => { o.grey = v; again(); }, "Without its colours: only its light and shade");
  }
  /** How a layer is laid over what is under it: how much of it shows, and its blend. */
  function blendFields(p: PromoPicture, l: PromoLayer) {
    field(layerBox, "Opacity", range(0, 1, 0.01, l.opacity ?? 1, (v) => { l.opacity = v >= 1 ? undefined : v; draw(p); placeShared(l); }), "How much of it shows");
    const blend = document.createElement("select");
    for (const [value, label] of LAYER_BLENDS) blend.add(new Option(label, value));
    blend.value = l.blend ?? "source-over";
    blend.onchange = () => { l.blend = blend.value === "source-over" ? undefined : (blend.value as LayerBlend); draw(p); placeShared(l); };
    wheelSelect(blend);
    field(layerBox, "Blend", blend, "How it is laid over what is under it (as Photoshop's blend modes)");
  }

  /** An image from a file, fitted in the middle of a picture. */
  function addImage(p: PromoPicture) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void addLayer(p, async () => {
        const bitmap = await createImageBitmap(file);
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext("2d")!.drawImage(bitmap, 0, 0);
        bitmap.close();
        // fitted in 80% of the picture (no larger than it is)
        const k = Math.min(1, (p.w * 0.8) / c.width, (p.h * 0.8) / c.height);
        const w = c.width * k, h = c.height * k;
        return layer(file.name.replace(/\.[^.]+$/, "") || "Image", c, (p.w - w) / 2, (p.h - h) / 2, w, h);
      });
    };
    input.click();
  }

  /**
   * A small live view through a layer's camera: drag to turn round the subject, right-drag (or Shift-drag) to slide the framing, the
   * wheel to zoom (a chart's: a shot is sized by its Image scale). It is drawn again as it is moved (small and quick, the newest look winning); the layer is taken again on letting go.
   */
  function cameraWindow(p: PromoPicture, l: PromoLayer, aim: NonNullable<PromoLayer["shot"] | PromoLayer["chart"]>): HTMLElement {
    const box = document.createElement("div");
    box.className = "promoCamera";
    const canvas = document.createElement("canvas");
    // the window is 16:9 whatever the shot (it does not jump in size from one layer to the next); what the camera frames, the shot's slot
    // or one picture of a chart, is fitted in the middle of it
    const aspect = l.shot ? l.shot.w / l.shot.h : l.chart?.options?.cellAspect ?? 1;
    const W = 260, H = Math.round((W * 9) / 16);
    const w = Math.round(Math.min(W, H * aspect)), h = Math.round(Math.min(H, W / aspect));
    const pr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * pr);
    canvas.height = Math.round(H * pr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const vx = Math.round(((W - w) / 2) * pr), vy = Math.round(((H - h) / 2) * pr), vw = Math.round(w * pr), vh = Math.round(h * pr);
    /** Held steady while the camera is dragged or zoomed from here: the framing stays, the camera goes round (fitted again on letting go). */
    let steady = false;
    const hint = document.createElement("p");
    hint.className = "dim hint";
    hint.textContent = l.chart ? "Drag to turn · right-drag to slide · Ctrl-drag to turn the light · wheel to zoom" : "Drag to turn · right-drag to slide · Ctrl-drag to turn the light";
    box.append(canvas, hint);
    const ctx = canvas.getContext("2d")!;
    let busy = false, again = false;
    const peek = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        do {
          again = false;
          const view = await host.cameraView(l, vw, vh, steady);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // (the frame: what is outside the shot is the window's dark, the shot's own in the checkers)
          ctx.fillStyle = "rgba(255,255,255,0.03)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.clearRect(vx, vy, vw, vh);
          ctx.drawImage(view, vx, vy, vw, vh);
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.lineWidth = 1;
          ctx.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
        } while (again);
      } catch (err) {
        status.textContent = `Could not look through the camera: ${String(err)}`;
      } finally {
        busy = false;
      }
    };
    void peek();
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onpointerdown = (ev) => {
      ev.preventDefault();
      canvas.setPointerCapture(ev.pointerId);
      steady = true;
      // Ctrl: the light, as in the view (and hlmv): the shot gets a light of its own, from where the view's is now
      const lighting = ev.ctrlKey && ev.button === 0;
      // (a thumbnail with its studio light on: Ctrl-drag turns the rig's pivot, the three lights together)
      // (the rig it turns: the board's, which every linked thumbnail shares, or this one's own)
      const shared = !!l.shot && !l.shot.studioOwn && !!look.studio && p.kind === "Thumbnail";
      const studio = lighting && l.shot?.studio?.on ? (shared ? look.studio! : l.shot.studio) : null;
      const pivot = studio ? { yaw: studio.yaw, pitch: studio.pitch } : null;
      if (lighting && !studio) aim.light ??= host.lightDirection();
      const sliding = !lighting && (ev.button === 2 || ev.button === 1 || ev.shiftKey);
      const start = { x: ev.clientX, y: ev.clientY, yaw: aim.yaw, pitch: aim.pitch, panX: aim.panX ?? 0, panY: aim.panY ?? 0, light: aim.light ? { ...aim.light } : null };
      canvas.onpointermove = (m) => {
        const dx = m.clientX - start.x, dy = m.clientY - start.y;
        if (studio && pivot) {
          studio.yaw = Math.round((((pivot.yaw + dx * 0.5 + 180) % 360) + 360) % 360 - 180);
          studio.pitch = Math.round(Math.max(-80, Math.min(80, pivot.pitch - dy * 0.5)));
          if (shared) l.shot!.studio = structuredClone(look.studio);
          studioMoved?.();
        } else if (lighting && start.light) {
          const [azimuth, elevation] = rotateLightDirection(start.light.azimuth, start.light.elevation, -dx * 0.5, dy * 0.5);
          aim.light = { azimuth: Math.round(azimuth * 10) / 10, elevation: Math.round(elevation * 10) / 10 };
        } else if (sliding) {
          // the subject follows the pointer: the pan is a share of half the frame
          aim.panX = Math.round((start.panX + (dx / (w / 2)) * (1 / aim.fill)) * 1000) / 1000;
          aim.panY = Math.round((start.panY - (dy / (h / 2)) * (1 / aim.fill)) * 1000) / 1000;
        } else {
          aim.yaw = Math.round(start.yaw + dx * TURN_PER_PIXEL);
          aim.pitch = Math.round(Math.max(-30, Math.min(70, start.pitch + dy * TURN_PER_PIXEL)));
        }
        cameraSync?.();
        void peek();
      };
      canvas.onpointerup = () => {
        canvas.onpointermove = null;
        // (let go: framed again, as the shot will be)
        steady = false;
        void peek();
        retake(p, l);
        if (studio && shared) syncStudio(l);
        if (lighting && !studio && !start.light) panelStale = true; // (the panel shows its Reset light once the shot is taken)
      };
    };
    let wheelTake = 0;
    canvas.onwheel = (ev) => {
      // (only a chart's camera zooms: a shot is sized by its Image scale, on the picture)
      if (!l.chart) return;
      ev.preventDefault();
      aim.fill = Math.max(0.4, Math.min(l.chart ? CHART_ZOOM : 1.5, aim.fill * Math.exp(-ev.deltaY * 0.0012)));
      cameraSync?.();
      steady = true;
      void peek();
      clearTimeout(wheelTake);
      wheelTake = window.setTimeout(() => { steady = false; void peek(); retake(p, l); }, 300);
    };
    return box;
  }

  /** A text layer's controls: what it says, its font and look; it is drawn again as they change (its middle stays put). */
  function textFields(p: PromoPicture, l: PromoLayer, t: NonNullable<PromoLayer["text"]>) {
    // (under the layer's heading, "Text": with more texts selected, it says how many)
    const th = layerBox.querySelector("h3") as HTMLElement;
    // the texts selected with it change together (all but what each says)
    const together = selection.filter((x) => x.text && p.layers.includes(x));
    const targets = together.includes(l) ? together : [l];
    if (targets.length > 1) { th.textContent = `Text · ${targets.length} selected`; th.title = "Their look changes together (each keeps what it says)"; }
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
    field(layerBox, "Font size", range(12, 300, 1, t.size, (v) => { setAll((x) => (x.size = v)); changed(); }));
    field(layerBox, "Colour", colour(t.color.slice(0, 7), (v) => { setAll((x) => (x.color = v)); changed(); }));
    const align = document.createElement("select");
    for (const [a, label] of [["left", "Left"], ["center", "Centre"], ["right", "Right"]] as const) align.add(new Option(label, a));
    align.value = t.align;
    align.onchange = () => { setAll((x) => (x.align = align.value as typeof t.align)); changed(); };
    field(layerBox, "Lines", align);
    check(layerBox, "Outline", t.outline, (v) => { setAll((x) => (x.outline = v)); changed(); });
    check(layerBox, "Shadow", t.shadow, (v) => { setAll((x) => (x.shadow = v)); changed(); });
    // the same look on every text of the board (what each says stays)
    buttons(layerBox, [{ label: "Apply to every text", title: "Give every text of every picture this font, weight, size, colour, outline and shadow", run: () => {
      const was = snapshot();
      for (const q of pictures) for (const x of q.layers) {
        if (!x.text || x === l) continue;
        Object.assign(x.text, { font: t.font, weight: t.weight, size: t.size, color: t.color, outline: t.outline, shadow: t.shadow });
        redraw(x, q);
      }
      void redraws.then(() => pushUndo(was));
      status.textContent = "Every text has this look now.";
    } }]);
  }

  // --- layers as such: copied into other pictures (linked, or as copies of their own), duplicated, taken out ---
  /** The layers of the other pictures linked with a layer (the same shot and place). */
  const linkedWith = (l: PromoLayer) => (l.link && l.shared ? pictures.flatMap((q) => q.layers).filter((x) => x !== l && x.link === l.link && x.shared) : []);
  let nextLink = 1;
  const newLink = () => {
    while (pictures.some((q) => q.layers.some((x) => x.link === `link${nextLink}`))) nextLink++;
    return `link${nextLink++}`;
  };
  /** What was copied (Ctrl+C): the layers themselves, to be put into a picture as copies of their own (Ctrl+V) or linked (Ctrl+Shift+V). */
  let clipboard: PromoLayer[] = [];
  const picks = () => (picked ? selection.filter((l) => picked!.layers.includes(l)) : []);
  const some = (ls: PromoLayer[]) => (ls.length === 1 ? `“${ls[0].name}”` : `${ls.length} layers`);
  function copyLayers() {
    const sel = picks();
    if (!sel.length) return;
    clipboard = [...sel];
    status.textContent = `Copied ${some(sel)}. Ctrl+V in a picture puts it there as a copy of its own; Ctrl+Shift+V linked (the same shot and place).`;
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
      const l: PromoLayer = { ...src, box: { ...src.box }, hidden: false, mask: src.mask ? structuredClone(src.mask) : undefined, overlay: src.overlay ? structuredClone(src.overlay) : undefined };
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
    // a name that says who it is (as a character added by hand is named) follows what was changed in 3D: its class, its team
    const auto = host.shotName(l.shot);
    try {
      if (await host.editIn3D(l)) {
        const named = host.shotName(l.shot);
        if (l.name === auto && named !== auto) {
          for (const x of [l, ...instancesOf(l).map(([, x]) => x)]) x.name = named;
          showInspector();
        }
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
      ...(spec?.randomPose ? [{ label: spec.group ? "New poses" : "New pose", run: () => retake(p, l, () => host.repose(spec)) }] : []),
      ...(spec?.reroll ? [{ label: spec.group ? "New outfits" : "New outfit", run: () => retake(p, l, () => host.reroll(spec)) }] : []),
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
  function layerActions(p: PromoPicture | null, l: PromoLayer | null) {
    actionsBox.replaceChildren();
    linkNote.textContent = "";
    const linked = l ? linkedWith(l) : [];
    const others = l?.link ? pictures.flatMap((q) => q.layers).filter((x) => x !== l && x.link === l.link) : [];
    if (linked.length) linkNote.textContent = `Linked: the same shot and place in ${linked.length} other picture${linked.length === 1 ? "" : "s"}. A change here changes it there too.`;
    else if (others.length) linkNote.textContent = `A copy of its own; ${others.length} other picture${others.length === 1 ? " has" : "s have"} the shot it was copied from.`;
    const add = (label: string, title: string, run: () => void, iconName?: Parameters<typeof icon>[0]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = l ? title : "Select a layer first";
      if (iconName) { b.innerHTML = icon(iconName); b.className = "iconBtn"; b.setAttribute("aria-label", label); }
      else b.textContent = label;
      b.disabled = !l || !p;
      b.onclick = run;
      actionsBox.append(b);
    };
    const sep = document.createElement("span");
    sep.className = "sep";
    actionsBox.append(sep);
    add("Copy", "Copy it (Ctrl+C): Ctrl+V in a picture puts it there as a copy of its own, Ctrl+Shift+V linked", () => { if (l) { selectOnly(l); copyLayers(); } });
    add("Duplicate", "A copy of its own in this picture, beside it", () => { if (l) pasteLayers("copy", [l]); });
    if (l && p && linked.length) add("Unlink", "Make this picture's own copy: it keeps a copy of the shot, changed on its own from now on", () => unlinkLayer(p, l));
    else if (l && p && others.length) add("Link back", "Link it to the others again: it takes their shot and place, and changes with them", () => relinkLayer(p, l));
    add("Delete", "Take it out of this picture (Delete)", () => { if (l) { selectOnly(l); deleteLayers(); } }, "trash2");
  }

  /** Every thumbnail's shot layer, with its picture. */
  function thumbnailShots(): [PromoPicture, PromoLayer][] {
    return pictures.filter((q) => q.kind === "Thumbnail").flatMap((q) => q.layers.filter((x) => x.shot && !x.shot.group).map((x): [PromoPicture, PromoLayer] => [q, x]));
  }
  /**
   * Gives every thumbnail linked to the board's studio light a copy of it, and takes again those that change: `now`, or after a moment (a
   * slider is not retaken on every thumbnail at every step; `except`, the one being changed, is retaken by its caller).
   */
  function syncStudio(except: PromoLayer | null, now = false) {
    keepLook();
    clearTimeout(studioTimer);
    const go = () => {
      const rig = JSON.stringify(look.studio);
      for (const [q, x] of thumbnailShots()) {
        if (x === except || x.shot!.studioOwn || JSON.stringify(x.shot!.studio) === rig) continue;
        x.shot!.studio = structuredClone(look.studio);
        retake(q, x);
      }
    };
    if (now) go();
    else studioTimer = window.setTimeout(go, 300);
  }

  /** Shows the camera moved from the camera window (a drag, the wheel) in the Camera's sliders, as it goes. */
  let cameraSync: (() => void) | null = null;

  /** Shows the studio light's pivot moved from elsewhere (Ctrl-drag in the camera window): the ball and the pivot's sliders. */
  let studioMoved: (() => void) | null = null;

  /**
   * A thumbnail's studio light: three-point lighting (key, fill, rim) that the pivot turns as one, the three lights' strengths and
   * colours, the ambient under them, and ambient occlusion. The shot is taken again as they change.
   */
  function studioFields(p: PromoPicture, l: PromoLayer, spec: ShotSpec) {
    // the rig it shows: the board's, shared by every thumbnail (a copy on this one, kept in step), or one of its own
    const own = !!spec.studioOwn;
    const st: StudioLight = own ? (spec.studio = parseStudio(spec.studio ?? DEFAULT_STUDIO)) : (look.studio = parseStudio(look.studio ?? spec.studio ?? DEFAULT_STUDIO));
    if (!own) spec.studio = structuredClone(st);
    /** This one taken again with the rig as it is now, and (a shared one) every other linked thumbnail after it. */
    const again = () => {
      if (!own) { spec.studio = structuredClone(look.studio); syncStudio(l); }
      retake(p, l);
    };
    /** The rig replaced (by Reset, Randomize or Flip). */
    const replace = (s: StudioLight) => {
      if (own) spec.studio = s;
      else look.studio = s;
      again();
      showLayer();
    };
    const h = heading(layerBox, "Studio light");
    const reset = document.createElement("button");
    reset.textContent = "Reset";
    reset.title = "The classic rig again: a warm key high on the right, a cool fill low on the left, a rim behind";
    reset.onclick = () => replace({ ...structuredClone(DEFAULT_STUDIO), on: st.on });
    const shuffle = document.createElement("button");
    shuffle.textContent = "Randomize";
    shuffle.title = "Another three-point setup: the key on one side and above, the fill on the other and dimmer, the rim behind, in colours that go together";
    shuffle.onclick = () => replace({ ...randomStudio(), on: true, ao: st.ao, aoStrength: st.aoStrength });
    const tools = document.createElement("span");
    tools.className = "promoHeadBtns";
    const flip = document.createElement("button");
    flip.textContent = "Flip";
    flip.title = "Mirror the rig left to right: the key, the fill and the rim each to the other side (the pivot too)";
    flip.onclick = () => replace(flipStudio(st));
    tools.append(flip, shuffle, reset);
    h.appendChild(tools);
    check(layerBox, "Three-point light", st.on, (v) => { st.on = v; again(); showLayer(); }, "Light the thumbnail with a studio rig of three lights (key, fill, rim) in place of the scene's light");
    check(layerBox, "Own light setup", own, (v) => {
      spec.studioOwn = v || undefined;
      // (linked again: it takes the board's rig; unlinked: it keeps a copy of it, changed on its own from now on)
      if (!v) { spec.studio = structuredClone(look.studio); retake(p, l); }
      showLayer();
    }, "Off: the same studio light as every other thumbnail of the set (a change here changes them all) · On: this thumbnail's own");
    if (!st.on) { studioMoved = null; return; }
    // the pivot: the ball, and its two angles as sliders (kept in step with each other)
    // (each step of a drag takes the shot again: the newest wins, as with the camera's sliders)
    const sphere = createStudioSphere(() => st, (s) => { Object.assign(st, s); setSlider(round, st.yaw); setSlider(over, st.pitch); again(); });
    const box = document.createElement("div");
    box.className = "promoStudio";
    const hint = document.createElement("p");
    hint.className = "dim hint";
    hint.textContent = "Drag the ball: all three lights · drag K, F, R: one light · Ctrl-drag in the camera window: the pivot";
    box.append(sphere.element, hint);
    layerBox.appendChild(box);
    const lit = () => { sphere.draw(); again(); };
    const round = range(-180, 180, 1, st.yaw, (v) => { st.yaw = v; lit(); }, (v) => `${v}°`);
    const over = range(-80, 80, 1, st.pitch, (v) => { st.pitch = v; lit(); }, (v) => `${v}°`);
    field(layerBox, "Pivot round", round, "Turns the three lights together round the subject");
    field(layerBox, "Pivot over", over, "Turns the three lights together over the subject");
    studioMoved = () => { sphere.draw(); setSlider(round, st.yaw); setSlider(over, st.pitch); };
    field(layerBox, "Brightness", range(0, 3, 0.01, st.brightness, (v) => { st.brightness = v; lit(); }), "All three lights at once");
    for (const role of STUDIO_ROLES) {
      const lamp = st[role];
      field(layerBox, STUDIO_LABELS[role], range(0, 4, 0.01, lamp.intensity, (v) => { lamp.intensity = v; lit(); }), `How bright the ${STUDIO_LABELS[role].toLowerCase()} light is`);
    }
    // the three colours in one row
    const swatches = document.createElement("div");
    swatches.className = "promoSwatches";
    for (const role of STUDIO_ROLES) {
      const c = colour(st[role].color, (v) => { st[role].color = v; lit(); });
      c.title = `The ${STUDIO_LABELS[role].toLowerCase()} light's colour`;
      swatches.appendChild(c);
    }
    field(layerBox, "Key · fill · rim", swatches, "The colours of the key, the fill and the rim");
    field(layerBox, "Ambient", range(0, 1, 0.01, st.ambient, (v) => { st.ambient = v; lit(); }), "The light from everywhere under the rig: low lets the rig shape the subject");
    check(layerBox, "Ambient occlusion", st.ao, (v) => { st.ao = v; again(); showLayer(); }, "Darkens the creases and where parts meet, as a close shot shows them");
    if (st.ao) field(layerBox, "AO strength", range(0, 1, 0.01, st.aoStrength, (v) => { st.aoStrength = v; again(); }));
    sphere.draw();
  }

  /** Sets a slider made by `range` (and its number box) without it reporting a change. */
  const setSlider = (i: HTMLInputElement, v: number) => {
    i.value = String(v);
    const num = numbers.get(i);
    if (num) num.value = Number(i.value).toFixed((String(i.step).split(".")[1] ?? "").length);
  };

  /** A shot's pose: the taunt or animation it is from (a list), and where in it (a timeline, the shot taken again as it is dragged). */
  function poseFields(p: PromoPicture, l: PromoLayer, spec: ShotSpec) {
    const list = document.createElement("select");
    list.add(new Option("Loading the poses…", ""));
    list.disabled = true;
    field(layerBox, "Pose", list);
    const time = document.createElement("input");
    time.type = "range";
    time.className = "ui-range";
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
    heading(layerBox, "Bodygroups");
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
          check(box, label + (mine !== undefined ? " •" : ""), now === 0, (on) => set(bp.name, on === ((bp.byItems ?? 0) === 0) ? null : on ? 0 : 1), `Shown or hidden (${why})`);
        } else {
          const sel = document.createElement("select");
          for (let i = 0; i < bp.count; i++) sel.add(new Option(i === 0 ? "0 (its own)" : String(i), String(i)));
          sel.value = String(now);
          sel.title = `Which model it shows (${why})`;
          sel.onchange = () => set(bp.name, Number(sel.value) === (bp.byItems ?? 0) ? null : Number(sel.value));
          field(box, label + (mine !== undefined ? " •" : ""), sel);
        }
      }
      if (spec.bodygroups) buttons(box, [{ label: "Reset", title: "Back to what the cosmetics set (• marks a part set by hand)", run: () => { spec.bodygroups = undefined; retake(p, l); showLayer(); } }]);
    });
  }

  /** The selected shot's controls. */
  function showLayer() {
    const p = picked, l = layerPicked;
    layerBox.innerHTML = "";
    cameraSync = null;
    layerActions(p, p && l && p.layers.includes(l) ? l : null);
    if (p && borderPicked) {
      heading(layerBox, "Border", "Every picture's: a line round it, inside its edge");
      showLookStroke();
      layerBox.append(strokeBox);
      return;
    }
    if (!p || !l || !p.layers.includes(l)) {
      if (p && p.layers.length > 1) layerBox.innerHTML = `<p class="dim">Click a shot in the picture to change it.</p>`;
      return;
    }
    const spec = l.shot;
    heading(layerBox, l.chart ? "Paint chart" : l.text ? "Text" : l.name, undefined, spec
      ? [{ label: "Edit in 3D…", primary: true, title: "Open this character in the 3D view as the shot has it: change its weapon, pose, cosmetics or anything else, then come back", run: () => editIn3D(p, l) }]
      : []);
    if (l.overlay) {
      overlayFields(p, l, l.overlay);
    } else if (!l.chart) {
      if (spec && p.kind === "Thumbnail") {
        const framing = document.createElement("select");
        framing.add(new Option("On the character", "character"));
        framing.add(new Option("Item alone", "item"));
        framing.value = spec.focus !== undefined ? "character" : "item";
        framing.onchange = () => { const mode = framing.value as "character" | "item"; retake(p, l, () => host.framing(spec, mode)); panelStale = true; };
        field(layerBox, "Framing", framing, "On the character: the whole character, framed on the item, in a pose that shows it · Item alone: the item by itself, as the icons are");
      }
      // the image as it is placed on the picture (the camera's framing is the Camera's): its scale and its turn, about its middle
      heading(layerBox, "Image", undefined, [{ label: "Reset", title: "Put it back where it was: its scale, place and turn as it was taken", run: () => { l.scale = 1; l.dx = 0; l.dy = 0; l.rotation = 0; draw(p); placeShared(l); showLayer(); } }]);
      const size = range(0.2, 3, 0.01, l.scale, (v) => { const r = opaqueRect(l); sizeAbout(l, v, [r.x + r.w / 2, r.y + r.h / 2]); draw(p); placeShared(l); });
      size.onchange = () => sharpen(p, [l]);
      field(layerBox, "Image scale", size, "How big the image is on the picture (it is taken again sharper when let go); the camera's Zoom frames the shot itself");
      field(layerBox, "Image rotation", range(-180, 180, 1, l.rotation ?? 0, (v) => { l.rotation = v || undefined; draw(p); placeShared(l); }, (v) => `${v}°`), "How far the image is turned on the picture, about its middle");
      blendFields(p, l);
    } else {
      const hint = document.createElement("p");
      hint.className = "dim hint";
      hint.textContent = "Click a paint in the picture to take it out · right-drag to turn the camera round the item · wheel to zoom.";
      layerBox.appendChild(hint);
    }

    if (l.text) textFields(p, l, l.text);
    const aim = l.shot ?? l.chart;
    if (aim) {
      heading(layerBox, "Camera", undefined, aim.light ? [{ label: "Reset light", title: `This shot has a light of its own (${aim.light.azimuth}°, ${aim.light.elevation}°; Ctrl-drag in the camera window turns it). Back to the view's light as it is.`,
        run: () => { aim.light = undefined; retake(p, l); showLayer(); } }] : []);
      layerBox.appendChild(cameraWindow(p, l, aim));
      const turn = range(-180, 180, 1, aim.yaw, (v) => { aim.yaw = v; retake(p, l); }, (v) => `${v}°`);
      const tilt = range(-30, 70, 1, aim.pitch, (v) => { aim.pitch = v; retake(p, l); }, (v) => `${v}°`);
      field(layerBox, "Turn", turn);
      field(layerBox, "Tilt", tilt);
      // (a chart's zoom crops each of its pictures into a detail of the item; a shot's would be its Image scale over again, so it has none)
      const zoom = l.chart ? range(0.4, CHART_ZOOM, 0.01, aim.fill, (v) => { aim.fill = v; retake(p, l); }, (v) => `${Math.round(v * 100)}%`) : null;
      if (zoom) field(layerBox, "Zoom", zoom, "How near the camera comes to the item in each picture of the chart: in, it frames a detail of it");
      // (the field of view of a shot's lens: wide is near and deep, narrow is far and flat; the framing keeps what it frames the same size)
      if (spec) field(layerBox, "Field of view", range(10, 90, 1, spec.fov ?? PROMO_FOV, (v) => {
        // (a shot at a distance shared with others, RED's and BLU's: the distance goes with the lens, so the character keeps its size)
        const half = (deg: number) => Math.tan((deg * Math.PI) / 360);
        if (spec.scaleDistance) spec.scaleDistance *= half(spec.fov ?? PROMO_FOV) / half(v);
        spec.fov = v;
        retake(p, l);
      }, (v) => `${v}°`), "The camera's lens, as a vertical angle: wide (high) is near the subject and deep, narrow (low) far and flat");
      check(layerBox, "Auto framing", !aim.holdFrame, (v) => {
        // off: the framing it has now stays (taken from the shot as it is); on: fitted again
        aim.holdFrame = v ? undefined : true;
        aim.frame = undefined;
        retake(p, l);
      }, "On: the camera fits the subject again each time the shot is taken (a turn or tilt reframes it). Off: the framing stays where it is and the camera only goes round it");
      cameraSync = () => { setSlider(turn, aim.yaw); setSlider(tilt, aim.pitch); if (zoom) setSlider(zoom, aim.fill); };
      // the picture's shots of the item's other styles: linked (camera, light, effects and scale) unless unlinked here
      if (spec) {
        const others = styleSiblings(p, { ...l, shot: { ...spec, sync: true } });
        if (others.length || spec.sync === false) {
          check(layerBox, "Linked styles", spec.sync !== false, (v) => {
            spec.sync = v;
            if (v) retake(p, l); // linked again: the others take this one's camera
          }, "Camera, light, effects and scale shared with this picture's shots of the other styles");
        }
      }
      // charts of this item's other styles: kept in step (on unless taken out of step)
      const chart = l.chart;
      if (chart && pictures.some((q) => q.layers.some((x) => x !== l && x.chart && x.chart.item === chart.item && x.chart.role === chart.role))) {
        check(layerBox, "Linked charts", chart.sync !== false, (v) => {
          chart.sync = v;
          if (v) retake(p, l); // linked again: the others take this one's settings
        }, "Camera, paints and layout shared with the charts of the other styles");
      }
    }
    if (spec && p.kind === "Thumbnail") studioFields(p, l, spec);
    if (spec) {
      // where the pose is from (a taunt or an animation, and where in it), and another roll of it or of the outfit
      const rolls: { label: string; title: string; run: () => void }[] = [];
      if (spec.randomPose) rolls.push({ label: spec.group ? "New poses" : "New pose", title: "A random taunt or animation again, stopped on a frame that frames well" + (spec.group ? " (for every character)" : ""), run: () => retake(p, l, () => host.repose(spec)) });
      if (spec.reroll) rolls.push({ label: spec.group ? "New outfits" : "New outfit", title: spec.group ? "Roll every character's loadout again (the item stays)" : "Roll this character's loadout again (the item stays)", run: () => retake(p, l, () => host.reroll(spec)) });
      heading(layerBox, spec.group ? "Line-up" : "Pose", undefined, rolls);
      if (spec.group) {
        // (characters placed by hand in 3D move apart from the middle of the row, their places kept as they are otherwise)
        const placed = spec.group.every((c) => c.place);
        const xs = placed ? spec.group.map((c) => c.place!.x) : [];
        const sorted = [...xs].sort((a, b) => a - b);
        const measured = sorted.length > 1 ? (sorted.at(-1)! - sorted[0]) / (sorted.length - 1) : LINEUP_SPACING;
        let was = spec.spacing ?? (placed ? Math.round(measured) : LINEUP_SPACING);
        const spacing = range(10, 120, 1, was, (v) => {
          if (placed && was > 0) {
            const mid = xs.reduce((a, b) => a + b, 0) / xs.length;
            for (const c of spec.group!) c.place = { ...c.place!, x: mid + (c.place!.x - mid) * (v / was) };
            xs.splice(0, xs.length, ...spec.group!.map((c) => c.place!.x));
          }
          spec.spacing = v;
          was = v;
          retake(p, l);
        });
        field(layerBox, "Spacing", spacing, "How far apart the characters stand, middle to middle");
      }
      if (!spec.group) poseFields(p, l, spec);
      // the particle effects in the shot: how far in they are, and another roll of their chances
      heading(layerBox, "Particle effects", undefined, [{ label: "Reroll", title: "Another seed for the effects' chances: where each particle is, which way it went", run: () => { const s = l.shot!.particles!; s.seed = Math.floor(Math.random() * 0x7fffffff); retake(p, l); } }]);
      const particles = (spec.particles ??= { seed: Math.floor(Math.random() * 0x7fffffff), time: 2 });
      const when = range(0, 10, 0.1, particles.time, (v) => { particles.time = v; retake(p, l); });
      when.title = "How far into their run the particle effects are in the shot (seconds): they are started from the same seed and run this long each time the shot is taken";
      field(layerBox, "Time", when);
    }
    // a paint chart: the live chart editor's settings, drawn again at once
    const chart = l.chart;
    if (chart) {
      const o = (chart.options ??= structuredClone(DEFAULT_CHART));
      const again = () => retake(p, l);
      heading(layerBox, "Paints");
      const choose = <T extends string | number>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
        const sel = document.createElement("select");
        options.forEach(([, text], i) => sel.add(new Option(text, String(i))));
        sel.value = String(Math.max(0, options.findIndex(([v]) => v === get())));
        sel.onchange = () => { set(options[Number(sel.value)][0]); again(); };
        field(layerBox, label, sel);
      };
      choose("Unpainted first", [["none", "Not shown"], ["red", "RED"], ["both", "RED and BLU"]], () => (o.unpainted === true ? "red" : o.unpainted === false ? "none" : o.unpainted), (v) => (o.unpainted = v));
      choose("Team paints", [["both", "Both teams"], ["own", "RED only"]], () => o.teams, (v) => (o.teams = v));
      check(layerBox, "Cosmetic only", o.cosmeticOnly, (v) => { o.cosmeticOnly = v; again(); });
      heading(layerBox, "Layout");
      const cols = range(0, 16, 1, o.cols, (v) => { o.cols = v; again(); });
      cols.title = "How many across (0: as many as fit)";
      field(layerBox, "Columns", cols);
      field(layerBox, "Gap across", range(0, 200, 1, o.gapX, (v) => { o.gapX = v; again(); }));
      field(layerBox, "Gap down", range(0, 200, 1, o.gapY, (v) => { o.gapY = v; again(); }));
      field(layerBox, "Edge margin", range(0, 300, 1, o.padding, (v) => { o.padding = v; again(); }));
      choose("Align", [["center", "Centre"], ["left", "Left"]], () => o.align, (v) => (o.align = v));
      choose("Cell shape", [[1, "Square"], [4 / 3, "4:3"], [3 / 4, "3:4 (tall)"], [16 / 9, "16:9"]], () => o.cellAspect, (v) => (o.cellAspect = v));
      // the paints taken out (click one in the picture to take it out; click its chip to put it back)
      const rh = heading(layerBox, o.removed.length ? `Taken out · ${o.removed.length}` : "Taken out");
      if (o.removed.length) {
        const all = document.createElement("button");
        all.textContent = "Put all back";
        all.onclick = () => { o.removed = []; again(); showLayer(); };
        rh.appendChild(all);
      }
      const chips = document.createElement("div");
      chips.className = "ui-chips promoChips";
      if (!o.removed.length) chips.innerHTML = `<span class="dim hint">Click a paint in the picture to take it out.</span>`;
      for (const label of o.removed) {
        const b = document.createElement("span");
        b.className = "ui-chip";
        b.textContent = `${label} ×`;
        b.title = "Put it back";
        b.onclick = () => { o.removed = o.removed.filter((x) => x !== label); again(); showLayer(); };
        chips.appendChild(b);
      }
      layerBox.appendChild(chips);
    }
    const paintable = spec?.loadout.filter((w) => w.paintable) ?? [];
    if (paintable.length) {
      heading(layerBox, "Paint");
      for (const worn of paintable) {
        const sel = document.createElement("select");
        sel.add(new Option("No paint", ""));
        for (const paint of paintList) sel.add(new Option(paint.name, String(paint.id)));
        sel.value = worn.paint === null ? "" : String(worn.paint);
        sel.onchange = () => { worn.paint = sel.value ? Number(sel.value) : null; retake(p, l); };
        field(layerBox, worn.name, sel);
      }
    }
    if (spec && !spec.group) bodygroupFields(p, l, spec);
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
        return { l, state: { dx: l.dx, dy: l.dy, scale: l.scale, hidden: l.hidden, shared: l.shared, shot: l.shot, chart: l.chart, image: l.image, content: l.content, opaque: l.opaque, cells: l.cells, box: { ...l.box }, name: l.name, rotation: l.rotation, mask: l.mask ? structuredClone(l.mask) : undefined, opacity: l.opacity, blend: l.blend, overlay: l.overlay ? structuredClone(l.overlay) : undefined } };
      }),
    }));
    const key = JSON.stringify([look, pics.map((x) => [x.name, x.backdrop, x.texts, x.layers.map(({ l, state: s }) => [idOf(l), s.dx, s.dy, s.scale, s.hidden, s.shared, idOf(s.shot), idOf(s.chart), idOf(s.image), s.box, s.rotation, s.mask, s.opacity, s.blend, s.overlay]), x.strokeAt]), [...specs.values()]]);
    return { key, look: structuredClone(look), pics, specs };
  }
  function restore(s: Snap) {
    look.backdrop = { ...s.look.backdrop };
    look.stroke = { ...s.look.stroke };
    look.glow = s.look.glow ? { ...s.look.glow } : undefined;
    look.effects = s.look.effects ? structuredClone(s.look.effects) : undefined;
    look.studio = s.look.studio ? structuredClone(s.look.studio) : undefined;
    keepLook();
    for (const x of s.pics) {
      x.p.name = x.name;
      x.p.strokeAt = x.strokeAt;
      x.p.backdrop = x.backdrop ? { ...x.backdrop } : null;
      x.p.texts = x.texts.map((t) => ({ ...t }));
      x.p.layers = x.layers.map(({ l, state }) => Object.assign(l, { ...state, mask: state.mask ? structuredClone(state.mask) : undefined, overlay: state.overlay ? structuredClone(state.overlay) : undefined }));
    }
    for (const [spec, json] of s.specs) Object.assign(spec, JSON.parse(json));
  }
  const undoStack: Snap[] = [], redoStack: Snap[] = [];
  let pending: Snap | null = null;
  let commitAfterShots = false;
  function pushUndo(s: Snap) {
    undoStack.push(s);
    if (undoStack.length > UNDO_STEPS) undoStack.shift();
    redoStack.length = 0;
    host.changed();
    showHistory();
  }
  // the undo and redo buttons, over the corner of the stage
  const history = document.createElement("div");
  history.className = "promoHistory";
  history.addEventListener("pointerdown", (e) => e.stopPropagation());
  const historyButton = (name: "undo2" | "redo2", run: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = icon(name);
    b.onclick = run;
    history.append(b);
    return b;
  };
  const undoButton = historyButton("undo2", () => step(undoStack, redoStack));
  const redoButton = historyButton("redo2", () => step(redoStack, undoStack));
  stage.append(history);
  function showHistory() {
    undoButton.disabled = !undoStack.length;
    redoButton.disabled = !redoStack.length;
    undoButton.title = `Undo (Ctrl+Z): ${undoStack.length} of ${UNDO_STEPS} steps kept`;
    redoButton.title = `Redo (Ctrl+Shift+Z): ${redoStack.length} step${redoStack.length === 1 ? "" : "s"}`;
    undoButton.setAttribute("aria-label", "Undo");
    redoButton.setAttribute("aria-label", "Redo");
  }
  showHistory();
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
    if (to.length > UNDO_STEPS) to.shift();
    restore(s);
    showLookBackdrop();
    showLookStroke();
    showLookGlow();
    showLookFx();
    showLookShadow();
    for (const [q, c] of thumbs) c.parentElement!.title = cardTitle(q);
    selection = selection.filter((l) => picked?.layers.includes(l));
    if (layerPicked && !selection.includes(layerPicked)) layerPicked = selection.at(-1) ?? null;
    drawAll();
    showInspector();
    host.changed();
    status.textContent = from === undoStack ? "Undone." : "Redone.";
    showHistory();
  }
  const keys = (ev: KeyboardEvent) => {
    if (root.offsetParent === null) return; // this board is not showing
    const t = ev.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && (t.type === "text" || t.type === "search"))) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    // shaping a mask: Esc or Enter is done; Delete takes the mask off (not the layer)
    if (maskEdit && !ctrl && (ev.key === "Escape" || ev.key === "Enter")) editMask(null);
    else if (maskEdit && !ctrl && (ev.key === "Delete" || ev.key === "Backspace") && !t.matches("input, select, textarea")) {
      begin();
      maskEdit.mask = undefined;
      maskChanged(maskEdit);
      editMask(null);
      if (picked) draw(picked);
      commitSoon();
    } else if (ctrl && (k === "z" || k === "y")) {
      if (k === "y" || ev.shiftKey) step(redoStack, undoStack);
      else step(undoStack, redoStack);
    } else if (ctrl && k === "c") copyLayers();
    else if (ctrl && k === "v") pasteLayers(ev.shiftKey ? "instance" : "copy");
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
