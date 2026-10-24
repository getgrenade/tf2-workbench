/**
 * The maths of a gradient made of colour stops, as Photoshop's gradient editor has it: stops at places along the gradient, each with a colour,
 * a midpoint between it and the next stop (where the blend is half way: it leans the blend toward one of them), and a softness for the
 * whole gradient (how much each blend eases in and out of its stops). Plain data and no drawing, so that it can be tested.
 */

export interface GradientStop {
  /** Where it is along the gradient, 0..1 (0: the top of a linear one, the middle of a radial one). */
  at: number;
  /** "#rrggbb". */
  color: string;
  /** The blend to the next stop is half way here, as a share of the way (0.02..0.98; absent: in the middle). */
  mid?: number;
}

export const MIN_STOPS = 2;
export const MAX_STOPS = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
export const hexOfRgb = (c: readonly number[]) => `#${c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;

/**
 * The line a linear gradient runs along, on a picture of 1 × 1 (draw it stretched to the picture, so that it looks the same on any shape):
 * through the middle at `angle` degrees (0: to the right, 90: down), long enough that the corners of the picture are at its two ends (as
 * CSS does), so the first colour is reached at the first corner and the last at the opposite one, whatever the angle.
 */
export function unitGradientLine(angle: number): [number, number, number, number] {
  const t = (angle * Math.PI) / 180, dx = Math.cos(t), dy = Math.sin(t);
  const half = (Math.abs(dx) + Math.abs(dy)) / 2;
  return [0.5 - dx * half, 0.5 - dy * half, 0.5 + dx * half, 0.5 + dy * half];
}

/** The stops in order along the gradient. */
export const sortedStops = (stops: readonly GradientStop[]): GradientStop[] => [...stops].sort((a, b) => a.at - b.at);

/** How far into a blend (0..1) the colour has got when the way through it is `u`, with a midpoint and a softness. */
export function blendAt(u: number, mid: number | undefined, softness: number): number {
  const m = clamp(mid ?? 0.5, 0.02, 0.98);
  // a curve that passes through the midpoint at one half
  let f = Math.pow(clamp(u, 0, 1), Math.log(0.5) / Math.log(m));
  // softness: toward an ease in and out of each stop
  const e = f * f * (3 - 2 * f);
  f += (e - f) * clamp(softness, 0, 1);
  return f;
}

/** The colour of the gradient at `t` (0..1). `stops` are in order. */
export function colourAt(stops: readonly GradientStop[], softness: number, t: number): [number, number, number] {
  const first = stops[0], last = stops[stops.length - 1];
  if (t <= first.at) return rgbOf(first.color);
  if (t >= last.at) return rgbOf(last.color);
  let i = 0;
  while (i < stops.length - 2 && t >= stops[i + 1].at) i++;
  const a = stops[i], b = stops[i + 1];
  const u = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
  const f = blendAt(u, a.mid, softness);
  const x = rgbOf(a.color), y = rgbOf(b.color);
  return [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f];
}

/** The gradient as `n` evenly placed colour stops (for a canvas gradient, or to fade to another gradient). */
export function sampleStops(stops: readonly GradientStop[], softness: number, n: number): { at: number; color: string }[] {
  const s = sortedStops(stops);
  return Array.from({ length: n }, (_, i) => {
    const at = i / (n - 1);
    return { at, color: hexOfRgb(colourAt(s, softness, at)) };
  });
}

/** Stops read back from a file: in range, in order, at least two (null when there are fewer than two good ones). */
export function parseStops(raw: unknown): GradientStop[] | null {
  if (!Array.isArray(raw)) return null;
  const out: GradientStop[] = [];
  for (const s of raw.slice(0, MAX_STOPS)) {
    if (!s || typeof s !== "object") continue;
    const c = (s as GradientStop).color, at = (s as GradientStop).at, mid = (s as GradientStop).mid;
    if (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c) || typeof at !== "number" || !Number.isFinite(at)) continue;
    out.push({ at: clamp(at, 0, 1), color: c.toLowerCase(), ...(typeof mid === "number" && Number.isFinite(mid) && mid !== 0.5 ? { mid: clamp(mid, 0.02, 0.98) } : {}) });
  }
  return out.length >= MIN_STOPS ? sortedStops(out) : null;
}
