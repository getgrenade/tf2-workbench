/**
 * Fade masks of the promo board's layers: a linear or a radial gradient that fades a layer out (the bottom of a character seen from the
 * back, a head cut off below the neck), drawn in the layer's own frame so it moves, sizes and turns with it. A shot's mask can keep parts
 * of the character whole wherever the gradient falls (its arms and hands, its head, what it holds): those come from a picture of the
 * shot in which each pixel says how much of it is which part (see `partsOf`).
 */

/** The parts a mask can keep, and the channel of the parts picture that holds each. */
export const KEEP_PARTS = [
  { id: "arms", label: "Arms and hands", channel: 0 },
  { id: "head", label: "Head", channel: 1 },
  { id: "weapon", label: "What it holds", channel: 2 },
] as const;
export type KeepPart = (typeof KEEP_PARTS)[number]["id"];

export interface LayerMask {
  /** Off: kept, not drawn (to compare). */
  on: boolean;
  kind: "linear" | "radial";
  /**
   * In the layer's own frame (0..1 of its upright rectangle). Linear: `a` is where it is wholly shown, `b` where it is gone. Radial: `a`
   * is the middle, `b` the end of the long radius (its direction turns the ellipse).
   */
  a: [number, number];
  b: [number, number];
  /** Radial: the short radius over the long one. */
  ratio: number;
  /** Where the fade is halfway, as a share of the way from where it starts to where it ends (0.5: even). */
  mid: number;
  /** Radial: the share of the radius that is wholly shown before the fade starts. */
  hardness: number;
  /** The other way round: shown where it would be gone. */
  invert: boolean;
  /** Parts of the character that stay whole (a shot's). */
  keep: KeepPart[];
}

export function defaultMask(kind: LayerMask["kind"] = "linear"): LayerMask {
  return kind === "linear"
    ? { on: true, kind, a: [0.5, 0.55], b: [0.5, 0.92], ratio: 1, mid: 0.5, hardness: 0, invert: false, keep: [] }
    : { on: true, kind, a: [0.5, 0.4], b: [0.5, 0.85], ratio: 0.8, mid: 0.5, hardness: 0.35, invert: false, keep: [] };
}

/** A mask read back from a saved board (anything missing or wrong is the default's). */
export function parseMask(raw: unknown): LayerMask | undefined {
  const m = raw as Partial<LayerMask> | null;
  if (!m || typeof m !== "object") return undefined;
  const kind = m.kind === "radial" ? "radial" : "linear";
  const d = defaultMask(kind);
  const pt = (v: unknown, f: [number, number]): [number, number] => (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(x)) ? [v[0], v[1]] : f);
  const n = (v: unknown, f: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : f);
  return {
    on: m.on !== false,
    kind,
    a: pt(m.a, d.a),
    b: pt(m.b, d.b),
    ratio: n(m.ratio, d.ratio, 0.05, 20),
    mid: n(m.mid, d.mid, 0.02, 0.98),
    hardness: n(m.hardness, d.hardness, 0, 0.98),
    invert: m.invert === true,
    keep: Array.isArray(m.keep) ? m.keep.filter((k): k is KeepPart => KEEP_PARTS.some((p) => p.id === k)) : [],
  };
}

/**
 * The parts picture of a shot's image (the same size): red how much of a pixel is the arms and hands, green the head, blue what it
 * holds. Taken with the shot when its mask keeps parts.
 */
export const partsOf = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** How much is shown at `t` of the way through the fade (1 at its start, 0 at its end), bent so that `mid` is halfway. */
function fade(t: number, mid: number): number {
  const e = Math.log(0.5) / Math.log(Math.min(0.98, Math.max(0.02, mid)));
  return 1 - Math.pow(Math.min(1, Math.max(0, t)), e);
}

/** The colour stops of a fade: enough of them that the bend of its middle is smooth. */
function stops(g: CanvasGradient, from: number, mid: number, invert: boolean) {
  const n = Math.abs(mid - 0.5) < 0.01 ? 1 : 12;
  if (from > 0) g.addColorStop(0, `rgba(0,0,0,${invert ? 0 : 1})`);
  for (let i = 0; i <= n; i++) {
    const t = i / n, shown = fade(t, mid);
    g.addColorStop(from + (1 - from) * t, `rgba(0,0,0,${(invert ? 1 - shown : shown).toFixed(4)})`);
  }
}

/** A part-keeping picture: the chosen channels of a parts picture as alpha (white), cached by the parts and the choice. */
const keepCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
function keepAlpha(parts: HTMLCanvasElement, keep: KeepPart[]): HTMLCanvasElement {
  const key = [...keep].sort().join(",");
  let byKey = keepCache.get(parts);
  if (!byKey) keepCache.set(parts, (byKey = new Map()));
  let out = byKey.get(key);
  if (out) return out;
  const { width: w, height: h } = parts;
  const src = parts.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const channels = KEEP_PARTS.filter((p) => keep.includes(p.id)).map((p) => p.channel);
  for (let i = 0; i < src.length; i += 4) {
    let a = 0;
    for (const c of channels) a = Math.max(a, src[i + c]);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  byKey.set(key, out);
  return out;
}

/**
 * Paints a mask's alpha on `ctx` over w × h (the layer's upright rectangle at that size): opaque where the layer shows. `parts`, when the
 * mask keeps any, is the shot's parts picture.
 */
export function paintMask(ctx: CanvasRenderingContext2D, m: LayerMask, w: number, h: number, parts?: HTMLCanvasElement | null) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const ax = m.a[0] * w, ay = m.a[1] * h, bx = m.b[0] * w, by = m.b[1] * h;
  if (m.kind === "linear") {
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    stops(g, 0, m.mid, m.invert);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    const r = Math.max(0.5, Math.hypot(bx - ax, by - ay));
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(by - ay, bx - ax));
    ctx.scale(1, Math.max(0.05, m.ratio));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    stops(g, m.hardness, m.mid, m.invert);
    ctx.fillStyle = g;
    // (the stretched frame: what covers the canvas in it is far larger than it)
    const big = (w + h) * 4 / Math.max(0.05, Math.min(1, m.ratio));
    ctx.fillRect(-big, -big, big * 2, big * 2);
  }
  ctx.restore();
  if (parts && m.keep.length) ctx.drawImage(keepAlpha(parts, m.keep), 0, 0, w, h);
}

/** A layer's image with its mask: drawn into a canvas of its own at w × h (reused from one draw to the next). */
const scratch = new WeakMap<object, { image: HTMLCanvasElement; mask: HTMLCanvasElement }>();
export function maskedImage(owner: object, image: CanvasImageSource, m: LayerMask, w: number, h: number, parts?: HTMLCanvasElement | null): HTMLCanvasElement {
  w = Math.max(1, Math.min(8192, Math.round(w)));
  h = Math.max(1, Math.min(8192, Math.round(h)));
  let s = scratch.get(owner);
  if (!s) scratch.set(owner, (s = { image: document.createElement("canvas"), mask: document.createElement("canvas") }));
  for (const c of [s.image, s.mask]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const mctx = s.mask.getContext("2d")!;
  paintMask(mctx, m, w, h, parts);
  const ctx = s.image.getContext("2d")!;
  ctx.globalCompositeOperation = "copy";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(s.mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return s.image;
}

/** A mask as a grey picture of w × h (white shown, black hidden): a Photoshop layer mask. */
export function maskGrey(m: LayerMask, w: number, h: number, parts?: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d")!;
  paintMask(ctx, m, c.width, c.height, parts);
  // white with the mask's alpha, over black: grey where it fades
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}
