/**
 * A random ambient gradient for the background, made by rules taken from the shipped ones (see shippedBackdrops.ts), so that a roll is
 * never loud or muddy:
 * - colours are picked in OKLCH (lightness and colourfulness as the eye sees them), muted: little chroma, less still in the light colours
 *   and in the greens and yellows (olive and mustard read as dirt behind a character);
 * - one hue family: the colours drift at most ~95° of hue from the first, along the shorter way;
 * - a clear light-to-dark build: one end dark, the other mid to light (or the light in the middle of the run, or at the centre of a radial
 *   one), never two bright ends;
 * - a vertical or diagonal run (as the shipped ones), never across, or a radial one lit at its middle;
 * - 2 to 5 stops, spread out (no hard bands).
 */
import type { Backdrop } from "./promo";
import { hexOfRgb } from "./gradientStops";
import { stopsBackdrop } from "./backdropPresets";

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** OKLCH (L 0..1, C, h degrees) as sRGB 0..255, or null when it is out of the sRGB gamut. */
function oklchToRgb(L: number, C: number, h: number): [number, number, number] | null {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (lin.some((v) => v < -0.001 || v > 1.001)) return null;
  return lin.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  }) as [number, number, number];
}

/** A colour of the roll as hex: its chroma capped by the rules, and lowered until it is a colour the screen can show. */
function colour(L: number, C: number, h: number): string {
  h = ((h % 360) + 360) % 360;
  // (greens and yellows go muddy first; light colours want less chroma to stay soft)
  if (h > 85 && h < 170) C *= 0.5;
  // (a dark colour of high chroma reads as a flat neon navy or blood red: deep, but quiet)
  if (L < 0.35) C = Math.min(C, 0.075);
  if (L > 0.72) C *= 1 - (L - 0.72) * 2.2;
  C = Math.min(C, 0.11);
  for (let c = C; c >= 0; c -= 0.004) {
    const rgb = oklchToRgb(L, c, h);
    if (rgb) return hexOfRgb(rgb);
  }
  return hexOfRgb(oklchToRgb(L, 0, h) ?? [0, 0, 0]);
}

type Style = "fall" | "peak" | "dusk" | "radial";
let last: { hue: number; style: Style } | null = null;

/** A new random gradient (another hue or look than the last one rolled). */
export function rollBackdrop(): Backdrop {
  let hue = 0, style: Style = "fall";
  for (let i = 0; i < 12; i++) {
    hue = rand(0, 360);
    // (olive and mustard are rarely a good start: most often another hue)
    if (hue > 80 && hue < 150 && Math.random() < 0.75) continue;
    style = pick<Style>(["fall", "fall", "fall", "peak", "peak", "radial", "radial", "radial", "dusk"]);
    const dh = last ? Math.abs((((hue - last.hue) % 360) + 540) % 360 - 180) : 180;
    if (!last || dh > 40 || (style !== last.style && dh > 20)) break;
  }
  last = { hue, style };
  const drift = (Math.random() < 0.5 ? -1 : 1) * rand(10, 95);
  const chroma = rand(0.025, 0.09);
  const n = pick([2, 3, 3, 4, 4, 5]);
  const dark = rand(0.12, 0.28), light = style === "dusk" ? dark + rand(0.17, 0.25) : rand(0.6, 0.86);
  // where the light is along the run (0: at the start), and so each stop's lightness
  const peakAt = style === "peak" ? rand(0.4, 0.7) : 0;
  const ats = Array.from({ length: n }, (_, i) => (i === 0 ? 0 : i === n - 1 ? 1 : (i + rand(-0.25, 0.25)) / (n - 1)));
  const stops = ats.map((at) => {
    const away = style === "peak" ? Math.abs(at - peakAt) / Math.max(peakAt, 1 - peakAt) : at;
    // (the ends of a peak are a little lighter than the darkest of a fall: it is a band of light, not a hole)
    const L = light + (dark - light) * Math.pow(away, rand(0.8, 1.3)) * (style === "peak" ? 0.85 : 1) + rand(-0.02, 0.02);
    // dark colours carry a little more chroma (deep wine, ink blue); the hue drifts along the run
    const C = chroma * (L < 0.35 ? 1.25 : 1) * rand(0.8, 1.15);
    return { at: Math.round(at * 1e4) / 1e4, color: colour(L, C, hue + drift * at) };
  });
  if (style === "radial") return stopsBackdrop(stops, "radial", { softness: rand(0, 0.35), cx: 0.5, cy: rand(0.4, 0.5) });
  // (the first stop is the lightest) light at the top or the bottom of a fall, or along a diagonal; a dusk is lighter at the top
  const angle = style === "dusk" ? pick([90, 45, 135]) : pick([90, 270, 270, 45, 135, 225, 315]);
  return stopsBackdrop(stops, "linear", { angle, softness: rand(0, 0.35) });
}
