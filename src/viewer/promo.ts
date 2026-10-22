/**
 * Promo images for a set of cosmetics (one or more): the window that picks the set, and how a promo picture is put together. A picture is a
 * backdrop (a gradient with a soft light), its layers (transparent shots of the characters and items, each fitted into a box, then
 * moved and scaled as the board says) and captions, then a light stroke around the border. The board (promoBoard.ts) shows and edits
 * them; the shots themselves are taken by the host (see tab.ts).
 */
import { ensureOverlayFont, overlayFontFamily } from "./overlayFonts";
import type { ItemInfo } from "./payload";

/** A backdrop: a linear gradient between two colours at an angle, a soft light behind the middle and darker corners. */
export interface Backdrop {
  /** "#rrggbb". */
  from: string;
  to: string;
  /** Degrees: the direction the gradient runs (0: left to right, 90: top to bottom). */
  angle: number;
  glow: string;
  /** 0..1. */
  glowAmount: number;
  /** 0..1: how much darker the corners are. */
  vignette: number;
}

/**
 * The stroke around the border; sizes are pixels of a 1080-high picture (scaled with the picture). Its colour is the backdrop's own,
 * mixed toward white by `lighten` (a brighter band of the same gradient), or one colour of its own.
 */
export interface Stroke {
  on: boolean;
  width: number;
  inset: number;
  mode: "backdrop" | "colour";
  /** 0..1: how far the backdrop's colours are mixed toward white. */
  lighten: number;
  color: string;
  opacity: number;
}

export const DEFAULT_STROKE: Stroke = { on: true, width: 10, inset: 0, mode: "backdrop", lighten: 0.6, color: "#ffffff", opacity: 1 };

/** A "#rrggbb" mixed toward white by `t` (0..1), as "#rrggbb". */
export function lighter(color: string, t: number): string {
  const n = parseInt(color.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, "0");
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

/** How the camera looks at a shot: turned about the vertical (degrees, 0 from the front, either way round), tilted down onto it
 * (degrees), and how much of its slot the subject fills (0..1). */
export interface ShotAim {
  yaw: number;
  pitch: number;
  fill: number;
  /** The framing slid sideways and up (shares of half the frame's width and height; 0, 0 is centred on the subject). */
  panX?: number;
  panY?: number;
  /**
   * Where the directional light comes from while the shot is taken (degrees, as the light panel has them; the light follows the camera,
   * so it is relative to the shot's own view). Absent: the view's light as it is.
   */
  light?: { azimuth: number; elevation: number };
  /**
   * The particle effects in the shot (a hat's unusual effect, an item's own smoke) as they are `time` seconds in, started from `seed`:
   * the shot comes out the same each time it is taken. Absent: as they happen to be.
   */
  particles?: { seed: number; time: number };
}

/** The direction a shot is taken from, for its aim. */
export function aimDirection(a: { yaw: number; pitch: number }): [number, number, number] {
  const y = (a.yaw * Math.PI) / 180, p = (a.pitch * Math.PI) / 180;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
}

/** How a shot of a character was taken, kept so it can be taken again with changes (on the promo scene's character `role`). */
export interface ShotSpec extends ShotAim {
  role: number;
  /** What it wears: item ids, paint ids (null: unpainted), styles; `name` and `paintable` for the board. */
  loadout: { item: number; name: string; paintable: boolean; paint: number | null; style: number }[];
  weapon: number | null;
  /** The team it is on (0 RED, 1 BLU); absent: RED, or BLU for the BLU role. */
  team?: number;
  /** The parts of the character shown (an item on its own); null: the whole character. */
  regions: string[] | null;
  /** The size of the shot's slot in pixels. */
  w: number;
  h: number;
  /** How many times the slot's size the shot is rendered at (a shot sized up is taken again larger, to stay sharp); 1 when absent. */
  resolution?: number;
  /** A loadout that can be rolled again: it keeps this item and draws the others anew. */
  reroll?: { item: number };
  /** The pose the character holds (every bone's local transform), when it is not its weapon's idle: a random one, or one set in 3D. */
  pose?: { pos: number[]; quat: number[]; scale?: number[] };
  /** The pose can be rolled again (a random taunt or animation, stopped on a comfortable frame). */
  randomPose?: boolean;
  /** Camera, light, effects and scale kept the same as the picture's other shots of this item in its other styles; true when absent. */
  sync?: boolean;
  /**
   * A composition: its characters pictured together in one scene, each a spec of its own (its loadout, weapon, pose and face; `turn`).
   * This spec is then the picture's: its camera, its size and its effects.
   */
  group?: ShotSpec[];
  /** The camera's lens (vertical field of view, degrees); absent: the promo's 30. */
  fov?: number;
  /** In a group: how far the character is turned from facing the camera, in degrees. */
  turn?: number;
  /** In a group: where the character stands (viewer space; yaw in radians) when it was placed by hand in 3D; absent: the row sets it. */
  place?: { x: number; y: number; z: number; yaw: number };
  /** The 3D view's effects in the shot (the board's, kept on each shot so that it is taken again with them). */
  effects?: ShotEffects;
  /** What the pose is taken from: a taunt ("t<id>") or an animation ("s<name>"), and where in it (0..1). */
  poseOf?: { id: string; at: number; /** the pose parameters a random animation was rolled with (by lower case name, real values) */ params?: Record<string, number> };
  /** The flex controllers of the face it makes (a random one, or the scene's of a taunt), by lower case name. */
  flex?: Record<string, number>;
  /** The class's bodygroups set by hand in this shot (name -> model; 1 hides a part that has two), over what the cosmetics set. */
  bodygroups?: Record<string, number>;
  /**
   * Shots with the same value show their characters at the same size (RED and BLU, the styles, the line-up start out so): the camera
   * stands this far over `fill` away, not as near as the frame allows. Each is its own after that: its zoom and turn change it alone.
   */
  scaleDistance?: number;
}

/** How a paint chart was taken (the item on the promo scene's character `role`, in a style). */
export interface ChartSpec extends ShotAim {
  role: number;
  item: number;
  style: number;
  /** How many times 1920 × 1080 the chart is rendered at (sized up, it is taken again larger, to stay sharp); 1 when absent. */
  resolution?: number;
  /** The paint chart's own settings, as the live chart editor has them. */
  options: ChartOptions;
  /** Framed on the item (its camera turns about the item's middle); absent on a chart made before, framed on the whole character. */
  framed?: "item";
  /** Kept the same as the board's other charts of this item (its other styles): camera, paints and layout; true when absent. */
  sync?: boolean;
}

/** What a paint chart shows and how it is laid out (the live chart editor's controls; sizes are pixels of 1920 × 1080). */
export interface ChartOptions {
  /** The item unpainted first: not at all, in RED, or in RED and in BLU (true from a board made before: RED). */
  unpainted: "none" | "red" | "both" | boolean;
  teams: "both" | "own";
  cosmeticOnly: boolean;
  /** 0: as many as fit best. */
  cols: number;
  gapX: number;
  gapY: number;
  padding: number;
  align: "center" | "left";
  cellAspect: number;
  /** The paints taken out (their labels). */
  removed: string[];
}

export const DEFAULT_CHART: ChartOptions = { unpainted: "red", teams: "both", cosmeticOnly: false, cols: 0, gapX: 10, gapY: 10, padding: 46, align: "center", cellAspect: 1, removed: [] };

/** A picture of a paint chart: where each paint is in it, as shares of the picture (for the board to point at). */
export interface ChartCellRect {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A shot in a picture: fitted into its box (`alignY` 0 against the top, 1 against the bottom), then scaled by `scale` about the point it
 * is aligned on (the bottom middle of a character standing on the bottom) and moved by `dx`, `dy`.
 */
export interface PromoLayer {
  name: string;
  image: HTMLCanvasElement;
  box: { x: number; y: number; w: number; h: number };
  alignY: number;
  scale: number;
  dx: number;
  dy: number;
  hidden: boolean;
  /** How it was taken, when it can be taken again. */
  shot?: ShotSpec;
  chart?: ChartSpec;
  /**
   * The shot this is an instance of, in several pictures (RED on every main picture): the layers of a link that are `shared` have one
   * spec and one image, so taking it again changes them all; where each sits stays its own.
   */
  link?: string;
  shared?: boolean;
  /**
   * Kept in the middle of its box by what is visible in it (`content`: the middle of its opaque pixels, from the image's middle, in its
   * pixels), not by the middle of the 3D bounds it was framed on: an item framed alone has the head it sits on below it.
   */
  centre?: boolean;
  content?: { x: number; y: number };
  /** Where its visible pixels are in its image (the box the board outlines and grabs it by), measured with `content`. */
  opaque?: { x0: number; y0: number; x1: number; y1: number };
  /** A paint chart's paints, where they are in its image. */
  cells?: ChartCellRect[];
  /** A text layer: what it says and how (its image is drawn from it). */
  text?: TextSpec;
  /** Turned (degrees, clockwise) about the middle of what is visible of it. */
  rotation?: number;
}

/** A text of a picture: its font (an overlay font's path, "" for the system font, or "sys:<family>"), weight, colour and look. */
export interface TextSpec {
  text: string;
  font: string;
  weight: number;
  /** Pixels of the picture, at the layer's scale 1. */
  size: number;
  color: string;
  /** A dark outline round the letters. */
  outline: boolean;
  /** A soft shadow under them. */
  shadow: boolean;
  align: "left" | "center" | "right";
}

export const DEFAULT_TEXT: TextSpec = { text: "Text", font: "resource/tf2build.ttf", weight: 400, size: 110, color: "#ffffff", outline: false, shadow: true, align: "center" };

/** The fonts a text can have: the overlay fonts (TF2's own among them), then a few of the system's. */
export const TEXT_FONTS: [string, string][] = [
  ["resource/tf2build.ttf", "TF2 Build"], ["resource/tf2secondary.ttf", "TF2 Secondary"], ["resource/tf2professor.ttf", "TF2 Professor"],
  ["resource/tf2.ttf", "TF2"], ["", "Segoe UI"], ["sys:Arial", "Arial"], ["sys:Georgia", "Georgia"], ["sys:Impact", "Impact"],
  ["sys:Consolas", "Consolas"], ["sys:Trebuchet MS", "Trebuchet MS"],
];

const fontFamily = (font: string) => (font.startsWith("sys:") ? `"${font.slice(4)}", sans-serif` : overlayFontFamily(font));

/** The pixels a text is drawn at, per pixel of the picture (sharper than the picture, to be sized up). */
const TEXT_RES = 2;

/** A text drawn on a transparent canvas just its size (at `res` pixels a picture pixel), once its font is loaded. */
export async function renderText(t: TextSpec, res = TEXT_RES): Promise<HTMLCanvasElement> {
  if (t.font && !t.font.startsWith("sys:")) await ensureOverlayFont(t.font).catch(() => {});
  const lines = (t.text || " ").split("\n");
  const probe = document.createElement("canvas").getContext("2d")!;
  const font = `${t.weight} ${t.size * res}px ${fontFamily(t.font)}`;
  probe.font = font;
  const lh = t.size * 1.18 * res, pad = Math.ceil(t.size * 0.3 * res);
  const widths = lines.map((l) => probe.measureText(l).width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(Math.max(...widths) + pad * 2));
  canvas.height = Math.max(1, Math.ceil(lh * lines.length + pad * 2));
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  lines.forEach((line, i) => {
    const x = t.align === "left" ? pad : t.align === "right" ? canvas.width - pad - widths[i] : (canvas.width - widths[i]) / 2;
    const y = pad + lh * (i + 0.5);
    if (t.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = t.size * 0.18 * res;
      ctx.shadowOffsetY = t.size * 0.06 * res;
    }
    if (t.outline) {
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = t.size * 0.14 * res;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = "transparent";
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = "transparent";
  });
  return canvas;
}

/** A text layer whose middle is at (cx, cy); with `maxWidth`, the text is set smaller (down to 20 px) when it would be wider than that. */
export async function textLayer(name: string, t: TextSpec, cx: number, cy: number, maxWidth?: number): Promise<PromoLayer> {
  let image = await renderText(t);
  let w = image.width / TEXT_RES, h = image.height / TEXT_RES;
  if (maxWidth !== undefined && w > maxWidth) {
    t = { ...t, size: Math.max(20, Math.floor((t.size * maxWidth) / w)) };
    image = await renderText(t);
    w = image.width / TEXT_RES;
    h = image.height / TEXT_RES;
  }
  return { ...layer(name, image, cx - w / 2, cy - h / 2, w, h), text: t };
}

/**
 * Draws a text layer again after its text changed (its middle stays where it is), at a resolution for its size: sized up, it is drawn
 * larger, to stay sharp.
 */
export async function refreshText(l: PromoLayer) {
  if (!l.text) return;
  const res = TEXT_RES * Math.max(1, l.scale);
  const image = await renderText(l.text, res);
  const cx = l.box.x + l.box.w / 2, cy = l.box.y + l.box.h / 2;
  const w = image.width / res, h = image.height / res;
  l.box = { x: cx - w / 2, y: cy - h / 2, w, h };
  l.image = image;
}

export interface PromoText {
  text: string;
  x: number;
  y: number;
  /** Pixels. */
  size: number;
  hidden: boolean;
}

export interface PromoPicture {
  /** The file name, without `.png`. */
  name: string;
  /** The item it is of (its display name): the board groups the pictures by it. */
  item?: string;
  /** What it is ("Main", "Paint chart", ...), for the board. */
  kind: string;
  w: number;
  h: number;
  layers: PromoLayer[];
  texts: PromoText[];
  /** How many of its layers are under the border (the others are over it); all of them when absent. */
  strokeAt?: number;
  /** Its own backdrop; none: the board's. */
  backdrop: Backdrop | null;
}

export interface BoardLook {
  backdrop: Backdrop;
  stroke: Stroke;
  /** A soft dark glow round the shots (the characters and items; not the texts or the paint charts). */
  glow?: Glow;
  /** The 3D view's effects in every shot. */
  effects?: ShotEffects;
}

/** The 3D view's effects in a shot: the character's ground shadow, and the view's look (its post-processing). */
export interface ShotEffects {
  shadow: { on: boolean; azimuth: number; length: number; blur: number; opacity: number };
  look: boolean;
}

export const DEFAULT_SHOT_EFFECTS: ShotEffects = { shadow: { on: false, azimuth: 32, length: 0.6, blur: 0.5, opacity: 0.6 }, look: false };

/**
 * A shot's pixels without its effects (no shadow, no glow of the look), when it has any: what is the character, for its bounds and for
 * clicks; the shadow and the glow are not part of it.
 */
export const solidOf = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/**
 * A shot's ground shadow on its own (black, with the shadow's alpha), for a shot made with a shadow and no look: the picture draws the
 * shadows of all its shots together first, so that where they overlap they are as dark as one (and not darker, as drawing each shot with
 * its shadow in its pixels would make them), and the characters over them from `solidOf`.
 */
export const shadowOf = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** The shadow of a shot: what `shot` has over `plain` (the same shot without the shadow), as black with that alpha. */
export function shadowLayer(shot: HTMLCanvasElement, plain: HTMLCanvasElement): HTMLCanvasElement {
  const { width: w, height: h } = shot;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const a = shot.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h);
  const b = plain.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const o = out.getContext("2d")!.createImageData(w, h);
  for (let i = 3; i < a.data.length; i += 4) {
    // the shot is the character over the shadow: its alpha is c + s (1 - c)
    const c = b[i] / 255;
    const s = c >= 0.999 ? 0 : Math.max(0, (a.data[i] / 255 - c) / (1 - c));
    o.data[i] = Math.round(Math.min(1, s) * 255);
  }
  out.getContext("2d")!.putImageData(o, 0, 0);
  return out;
}

export interface Glow {
  on: boolean;
  /** Pixels of a 1080-high picture. */
  size: number;
  /** 0..1. */
  strength: number;
}

export const DEFAULT_GLOW: Glow = { on: false, size: 22, strength: 0.55 };

/** HSL (degrees, percent) as "#rrggbb". */
function hex(h: number, s: number, l: number): string {
  const S = s / 100, L = l / 100, a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const rgba = (color: string, alpha: number) => {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/**
 * The families of neutral a backdrop is drawn from: slate and steel blues, muted violet-greys and warm stone greys ([hue, hue spread]).
 * No greens or yellows: they fight with paints and team colours.
 */
const NEUTRALS: [number, number][] = [[210, 25], [265, 20], [25, 15]];

/**
 * A random backdrop that stays out of the item's way: a near-grey of one neutral family (barely tinted), running from dark at the
 * bottom to a mid tone at the top, so the item is the most colourful and brightest thing in the picture. No light or dark corners
 * (they can be added on the board).
 */
export function randomBackdrop(rand: () => number = Math.random): Backdrop {
  const [base, spread] = NEUTRALS[Math.floor(rand() * NEUTRALS.length)];
  const hue = (base + (rand() - 0.5) * spread + 360) % 360;
  const sat = 6 + rand() * 10;
  return {
    from: hex(hue, sat, 12 + rand() * 6),
    to: hex((hue + (rand() - 0.5) * 10 + 360) % 360, sat + 4, 34 + rand() * 10),
    angle: 270,
    glow: hex(hue, sat, 70),
    glowAmount: 0,
    vignette: 0,
  };
}

/** Paints the backdrop over a picture of w × h. */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, b: Backdrop) {
  const cx = w / 2, cy = h / 2, r = Math.hypot(w, h) / 2;
  const g = ctx.createLinearGradient(...gradientEnds(w, h, b.angle));
  g.addColorStop(0, b.from);
  g.addColorStop(1, b.to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy, r);
  glow.addColorStop(0, rgba(b.glow, b.glowAmount));
  glow.addColorStop(0.6, rgba(b.glow, 0));
  glow.addColorStop(1, `rgba(0,0,0,${b.vignette})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

/** The direction of a backdrop's gradient over a picture of w × h, as its two ends. */
function gradientEnds(w: number, h: number, angle: number): [number, number, number, number] {
  const cx = w / 2, cy = h / 2, r = Math.hypot(w, h) / 2, t = (angle * Math.PI) / 180;
  return [cx - Math.cos(t) * r, cy - Math.sin(t) * r, cx + Math.cos(t) * r, cy + Math.sin(t) * r];
}

/** The stroke around the border of a picture of w × h (`backdrop`: the one the picture is on, for a stroke of its colours). */
export function paintStroke(ctx: CanvasRenderingContext2D, w: number, h: number, s: Stroke, backdrop?: Backdrop) {
  if (!s.on || s.width <= 0) return;
  const k = h / 1080;
  const line = s.width * k, inset = s.inset * k;
  ctx.save();
  ctx.globalAlpha = s.opacity;
  if (s.mode === "backdrop" && backdrop) {
    const g = ctx.createLinearGradient(...gradientEnds(w, h, backdrop.angle));
    g.addColorStop(0, lighter(backdrop.from, s.lighten));
    g.addColorStop(1, lighter(backdrop.to, s.lighten));
    ctx.strokeStyle = g;
  } else ctx.strokeStyle = s.color;
  ctx.lineWidth = line;
  ctx.strokeRect(inset + line / 2, inset + line / 2, w - 2 * inset - line, h - 2 * inset - line);
  ctx.restore();
}

/** Where a layer is drawn, in the picture's pixels. */
export function layerRect(l: PromoLayer): { x: number; y: number; w: number; h: number } {
  const fit = Math.min(l.box.w / l.image.width, l.box.h / l.image.height);
  const fw = l.image.width * fit, fh = l.image.height * fit;
  // the fitted picture, and the point it is aligned on, which stays put as it is scaled
  const fx = l.box.x + (l.box.w - fw) / 2, fy = l.box.y + (l.box.h - fh) * l.alignY;
  const w = fw * l.scale, h = fh * l.scale;
  // what is visible in it in the middle of the box
  const k = fit * l.scale;
  const cx = l.centre && l.content ? l.content.x * k : 0, cy = l.centre && l.content ? l.content.y * k : 0;
  return { x: fx + (fw - w) / 2 + l.dx - cx, y: fy + (fh - h) * l.alignY + l.dy - cy, w, h };
}

/** Measures where a layer's visible pixels are (and, for a centred one, their middle), after its image was taken. */
export function measureContent(l: PromoLayer) {
  // (a shot's shadow and the glow of its look are not what is measured)
  const solid = solidOf.get(l.image) ?? l.image;
  const { width: w, height: h } = solid;
  const data = solid.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, w, h).data;
  if (!data) return;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const step = 2;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  l.content = x1 < 0 || !l.centre ? undefined : { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2 };
  l.opaque = x1 < 0 ? undefined : { x0, y0, x1: x1 + step, y1: y1 + step };
}

/** Where a layer's visible pixels are drawn, in the picture's pixels (all of it when they were not measured). */
export function opaqueRect(l: PromoLayer): { x: number; y: number; w: number; h: number } {
  const r = layerRect(l);
  if (!l.opaque) return r;
  const sx = r.w / l.image.width, sy = r.h / l.image.height;
  return { x: r.x + l.opaque.x0 * sx, y: r.y + l.opaque.y0 * sy, w: (l.opaque.x1 - l.opaque.x0) * sx, h: (l.opaque.y1 - l.opaque.y0) * sy };
}

/** The point a layer turns about: the middle of what is visible of it. */
export function layerPivot(l: PromoLayer): [number, number] {
  const o = opaqueRect(l);
  return [o.x + o.w / 2, o.y + o.h / 2];
}

/** A point turned by `degrees` about `pivot`. */
export function turnPoint(x: number, y: number, pivot: readonly [number, number], degrees: number): [number, number] {
  const t = (degrees * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = x - pivot[0], dy = y - pivot[1];
  return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
}

/** Draws a picture into `canvas` at `scale` of its size (the board's cards are small; an export is at full size). */
export function renderPicture(canvas: HTMLCanvasElement, p: PromoPicture, look: BoardLook, scale = 1) {
  canvas.width = Math.max(1, Math.round(p.w * scale));
  canvas.height = Math.max(1, Math.round(p.h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = "high";
  const backdrop = p.backdrop ?? look.backdrop;
  paintBackdrop(ctx, p.w, p.h, backdrop);
  // the border sits in the stack: the layers from `strokeAt` on are drawn over it
  const strokeAt = Math.min(p.strokeAt ?? p.layers.length, p.layers.length);
  const glow = look.glow?.on ? look.glow : null;
  const turn = (c: CanvasRenderingContext2D, l: PromoLayer) => {
    if (!l.rotation) return;
    const [px, py] = layerPivot(l);
    c.translate(px, py);
    c.rotate((l.rotation * Math.PI) / 180);
    c.translate(-px, -py);
  };
  // the shadows of the shots on the ground, together: the darkest of them where they overlap, under every character
  const shadowed = p.layers.filter((l) => !l.hidden && shadowOf.has(l.image));
  if (shadowed.length) {
    const acc = document.createElement("canvas");
    acc.width = canvas.width;
    acc.height = canvas.height;
    const actx = acc.getContext("2d", { willReadFrequently: true })!;
    actx.fillStyle = "#fff";
    actx.fillRect(0, 0, acc.width, acc.height);
    actx.globalCompositeOperation = "darken";
    // (each on white, so that "darken" takes the stronger of two shadows)
    const one = document.createElement("canvas");
    one.width = acc.width;
    one.height = acc.height;
    const octx = one.getContext("2d")!;
    for (const l of shadowed) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.fillStyle = "#fff";
      octx.fillRect(0, 0, one.width, one.height);
      octx.setTransform(scale, 0, 0, scale, 0, 0);
      octx.imageSmoothingQuality = "high";
      octx.save();
      turn(octx, l);
      const r = layerRect(l);
      octx.drawImage(shadowOf.get(l.image)!, r.x, r.y, r.w, r.h);
      octx.restore();
      actx.drawImage(one, 0, 0);
    }
    // white is no shadow, black the full one: the grey becomes the alpha of a black layer over the backdrop
    const px = actx.getImageData(0, 0, acc.width, acc.height);
    for (let i = 0; i < px.data.length; i += 4) {
      px.data[i + 3] = 255 - px.data[i];
      px.data[i] = px.data[i + 1] = px.data[i + 2] = 0;
    }
    actx.globalCompositeOperation = "source-over";
    actx.putImageData(px, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(acc, 0, 0);
    ctx.restore();
  }
  p.layers.forEach((l, i) => {
    if (i === strokeAt) paintStroke(ctx, p.w, p.h, look.stroke, backdrop);
    if (l.hidden) return;
    const r = layerRect(l);
    ctx.save();
    turn(ctx, l);
    // the glow round a character or an item (the canvas's shadow is in its own pixels, not the picture's)
    if (glow && l.shot) {
      ctx.shadowColor = `rgba(0,0,0,${glow.strength})`;
      ctx.shadowBlur = glow.size * (p.h / 1080) * scale;
    }
    // (a shot whose shadow is drawn above is drawn without it)
    ctx.drawImage(shadowOf.has(l.image) ? solidOf.get(l.image) ?? l.image : l.image, r.x, r.y, r.w, r.h);
    ctx.restore();
  });
  if (strokeAt >= p.layers.length) paintStroke(ctx, p.w, p.h, look.stroke, backdrop);
}

/** A picture as a PNG at full size. */
export function pictureBlob(p: PromoPicture, look: BoardLook): Promise<Blob> {
  const canvas = document.createElement("canvas");
  renderPicture(canvas, p, look);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the picture"))), "image/png"));
}

/** A layer of a shot fitted into a box. */
export const layer = (name: string, image: HTMLCanvasElement, x: number, y: number, w: number, h: number, alignY = 0.5): PromoLayer => ({
  name, image, box: { x, y, w, h }, alignY, scale: 1, dx: 0, dy: 0, hidden: false,
});

// --- the window -------------------------------------------------------------------------------------------------------------------

export interface PromoHost {
  /** The cosmetics that can be picked (the catalog). */
  catalog(): Promise<ItemInfo[]>;
  /** The classes (label, game name) that can wear all of these. */
  classesFor(items: ItemInfo[]): { label: string; game: string }[];
  /** The class to start on when it can wear the set (the selected character's), as a game name. */
  preferredClass(): string | null;
  /** The cosmetics the selected character wears now (ids, in the order it put them on), to start the set with. */
  currentSet(): number[];
  /** Takes the pictures and opens them on the board; `say` reports progress. Resolves to what to show when done. */
  generate(items: ItemInfo[], game: string, say: (text: string) => void): Promise<string>;
}

const KEY = "promoSet";
let closeOpen: (() => void) | null = null;

export function closePromo() {
  closeOpen?.();
}

export function openPromo(host: PromoHost) {
  if (closeOpen) return;
  const win = document.createElement("div");
  win.className = "chartWindow rollWindow promoWindow";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "Promo images");
  win.innerHTML = `<div class="chartHead"><span>Promo images</span><button class="chartClose" title="Close" aria-label="Close">×</button></div>
    <div class="rollBody">
      <h3>The set</h3>
      <div class="promoItems"></div>
      <div class="btns promoItemBtns"><button class="promoAddItem">+ Add item</button></div>
      <label class="chartRow inline">Class <select class="promoClass"></select></label>
      <p class="dim hint">For each item: a main picture (the set worn in RED and BLU, the item on its own beside them), a paint chart, a loadout line-up (the item with random others, unpainted), all 1920 × 1080, and a 512 × 512 thumbnail; an item with styles also gets its styles side by side and a paint chart of each. They open in the Promo tab, where each can be tweaked and the backdrop and border set for all, then exported.</p>
      <div class="btns"><button class="promoClose">Close</button><button class="primary promoGo">Generate</button></div>
      <p class="chartInfo" role="status"></p>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => win.querySelector(sel) as T;
  const head = $(".chartHead"), itemsBox = $(".promoItems"), classSel = $<HTMLSelectElement>(".promoClass");
  const go = $<HTMLButtonElement>(".promoGo"), status = $(".chartInfo");

  let items: ItemInfo[] = [];
  const byName = new Map<string, ItemInfo>();
  const names = document.createElement("datalist");
  names.id = `promoItems${Date.now()}`;
  win.appendChild(names);
  /** The set: one row per item (as many as wanted, at least one); null where the name typed is not an item. */
  let picked: (ItemInfo | null)[] = [null];
  let saved: number[] = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { /* none */ }
  const remember = () => { try { localStorage.setItem(KEY, JSON.stringify(picked.map((p) => p?.id ?? 0))); } catch { /* not kept */ } };

  /** The rows, drawn again whenever one is added or taken out. */
  function renderRows(focus = -1) {
    itemsBox.innerHTML = "";
    picked.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "promoItemRow";
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = `Item ${i + 1}`;
      input.setAttribute("list", names.id);
      input.setAttribute("aria-label", `Item ${i + 1}`);
      input.value = p?.displayName ?? "";
      input.oninput = () => {
        picked[i] = byName.get(input.value.trim().toLowerCase()) ?? null;
        input.classList.toggle("bad", !!input.value.trim() && !picked[i]);
        syncClasses();
        remember();
      };
      row.appendChild(input);
      if (picked.length > 1) {
        const remove = document.createElement("button");
        remove.className = "rollRemove";
        remove.textContent = "×";
        remove.title = "Take this item out of the set";
        remove.setAttribute("aria-label", `Take item ${i + 1} out`);
        remove.onclick = () => { picked.splice(i, 1); renderRows(); syncClasses(); remember(); };
        row.appendChild(remove);
      }
      itemsBox.appendChild(row);
      if (i === focus) input.focus();
    });
  }
  $(".promoAddItem").onclick = () => { picked.push(null); renderRows(picked.length - 1); syncClasses(); };
  renderRows();

  function syncClasses() {
    const set = picked.filter((p): p is ItemInfo => !!p);
    const classes = set.length ? host.classesFor(set) : [];
    const was = classSel.value;
    classSel.innerHTML = "";
    for (const c of classes) classSel.add(new Option(c.label, c.game));
    const preferred = host.preferredClass();
    if (classes.some((c) => c.game === was)) classSel.value = was;
    else if (preferred && classes.some((c) => c.game === preferred)) classSel.value = preferred;
    const typed = picked.length;
    const ok = set.length === typed && new Set(set.map((p) => p.id)).size === typed;
    go.disabled = !ok || !classes.length;
    status.textContent = !ok ? (set.length < typed ? "Pick an item from the list in every row (or take the row out)." : "Every item of the set has to be a different one.") : !classes.length ? `No class can wear ${typed === 1 ? "it" : "all of them"}.` : "";
  }

  void host.catalog().then((list) => {
    items = list;
    for (const it of items) {
      const key = it.displayName.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, it);
        names.appendChild(new Option(it.displayName));
      }
    }
    // the set the selected character wears, else the last one used
    const worn = host.currentSet().filter((id) => items.some((it) => it.id === id));
    const start = worn.length ? worn : saved;
    const found = start.map((id) => items.find((it) => it.id === id) ?? null).filter((it): it is ItemInfo => !!it);
    picked = found.length ? found : [null];
    renderRows();
    syncClasses();
  });

  let busy = false;
  go.onclick = async () => {
    const set = picked.filter((p): p is ItemInfo => !!p);
    if (busy || !set.length || set.length !== picked.length) return;
    busy = true;
    go.disabled = true;
    try {
      status.textContent = await host.generate(set, classSel.value, (text) => (status.textContent = text));
    } catch (err) {
      status.textContent = `Could not make the pictures: ${String(err)}`;
    } finally {
      busy = false;
      syncClasses();
    }
  };

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
  const close = () => {
    if (busy) return;
    win.remove();
    closeOpen = null;
  };
  $(".chartClose").onclick = close;
  $(".promoClose").onclick = close;
  win.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } });
  document.body.appendChild(win);
  // it opens in the middle of the screen (it can be dragged from there)
  const open = win.getBoundingClientRect();
  win.style.left = `${Math.max(0, (innerWidth - open.width) / 2)}px`;
  win.style.top = `${Math.max(8, (innerHeight - open.height) / 2)}px`;
  win.style.right = "auto";
  closeOpen = close;
  (itemsBox.querySelector("input") as HTMLInputElement | null)?.focus();
}
