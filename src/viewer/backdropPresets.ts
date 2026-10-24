/** The backdrops that can be picked from a thumbnail (a gradient, or one colour), what a custom gradient starts from, and the fade between two of them. */
import type { Backdrop } from "./promo";
import { hexOfRgb, parseStops, rgbOf, sortedStops, type GradientStop } from "./gradientStops";
import { SHIPPED_GRADIENTS } from "./shippedBackdrops";

export interface BackdropPreset {
  id: string;
  label: string;
  backdrop: Backdrop;
}

/** A gradient of stops (the first is the top, or the centre of a radial one; the last the bottom, or the edge). */
export function stopsBackdrop(stops: GradientStop[], shape: "linear" | "radial" = "linear", extra: Partial<Backdrop> = {}): Backdrop {
  const s = sortedStops(stops);
  const first = s[0].color, last = s[s.length - 1].color;
  return { kind: "gradient", from: first, to: last, angle: 90, glow: first, glowAmount: 0, vignette: 0, stops: s, shape, softness: 0, ...extra };
}

/** The gradient a custom one starts from when there is none to start from: a soft grey, lighter at the top. */
export const DEFAULT_GRADIENT: Backdrop = stopsBackdrop([{ at: 0, color: "#5a6470" }, { at: 1, color: "#1d2228" }]);

/** The backdrop of one colour. */
export const colourBackdrop = (hex: string): Backdrop => ({ kind: "colour", from: hex, to: hex, angle: 90, glow: hex, glowAmount: 0, vignette: 0 });

const mix = (a: string, b: string, t: number) => {
  const x = rgbOf(a), y = rgbOf(b);
  return hexOfRgb(x.map((v, i) => v + (y[i] - v) * t));
};

/** The stops a gradient is made of: its own, or those of the two colours (and the light) of a gradient from before stops, or of a colour. */
export function stopsOf(b: Backdrop): { stops: GradientStop[]; shape: "linear" | "radial" } {
  if (b.stops && b.stops.length >= 2) return { stops: sortedStops(b.stops).map((s) => ({ ...s })), shape: b.shape ?? "linear" };
  if (b.kind === "colour") return { stops: [{ at: 0, color: b.from }, { at: 1, color: b.from }], shape: "linear" };
  // from before stops, "from" was at the start of its angle (270: the bottom); with a light, an oval of it over the colour
  if (b.glowAmount > 0) return { stops: [{ at: 0, color: mix(b.from, b.glow, b.glowAmount) }, { at: 1, color: b.from }], shape: "radial" };
  const up = Math.abs((((b.angle % 360) + 360) % 360) - 270) < 1;
  return { stops: up ? [{ at: 0, color: b.to }, { at: 1, color: b.from }] : [{ at: 0, color: b.from }, { at: 1, color: b.to }], shape: "linear" };
}

/** The backdrop a custom gradient starts from: the one that was there, as stops, with no preset (a picture starts from the first preset). */
export const customBackdrop = (from?: Backdrop | null): Backdrop => {
  const base = from && from.kind !== "picture" ? from : DEFAULT_GRADIENT;
  const { stops, shape } = stopsOf(base);
  // (a gradient of stops keeps the direction it runs: there is no control for it, but a gradient that came with one is not turned)
  return stopsBackdrop(stops, shape, { softness: base.softness ?? 0, ...(base.stops ? { angle: base.angle } : {}), ...(base.cx !== undefined ? { cx: base.cx } : {}), ...(base.cy !== undefined ? { cy: base.cy } : {}) });
};

const hexOf = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const numOf = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** The background a scene file holds (a gradient, or a picture), with anything wrong replaced; undefined when it has none. */
export function parseBackdrop(raw: unknown): Backdrop | undefined {
  const b = raw as Partial<Backdrop> | null;
  if (!b || typeof b !== "object" || (b.kind !== "gradient" && b.kind !== "picture")) return undefined;
  const image = typeof b.image === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(b.image) && b.image.length < 12e6 ? b.image : undefined;
  if (b.kind === "picture" && !image) return undefined;
  const from = hexOf(b.from, "#404040");
  const stops = b.kind === "gradient" ? parseStops(b.stops) : null;
  return {
    kind: b.kind, from, to: hexOf(b.to, from), glow: hexOf(b.glow, from),
    angle: numOf(b.angle, 0, 360, 270), glowAmount: numOf(b.glowAmount, 0, 1, 0), vignette: numOf(b.vignette, 0, 1, 0),
    ...(typeof b.preset === "string" && b.preset.length > 0 && b.preset.length <= 60 ? { preset: b.preset } : {}),
    ...(b.kind === "picture" ? { image } : {}),
    ...(stops ? { stops, shape: b.shape === "radial" ? ("radial" as const) : ("linear" as const), softness: numOf(b.softness, 0, 1, 0) } : {}),
    ...(stops && b.shape === "radial" ? { cx: numOf(b.cx, 0, 1, 0.5), cy: numOf(b.cy, 0, 1, 0.46) } : {}),
  };
}

/** The backdrop `t` of the way from `a` to `b`: `b` painted over `a` with `t` as its opacity, so that any two fade (a gradient that turns, a linear one to a radial one, a picture). */
export const fadeBackdrop = (a: Backdrop, b: Backdrop, t: number): Backdrop => (t >= 1 ? b : t <= 0 ? a : { ...b, crossfade: { from: a, t } });

// --- the gradients saved in the picker (kept for the user), and those that ship with the app ---------------------------------------------------

const SAVED_KEY = "backdropGradients";

/** The gradients the user saved: each a gradient of stops with a name. */
export function savedGradients(): BackdropPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x: unknown) => {
      const p = x as Partial<BackdropPreset> | null;
      const backdrop = parseBackdrop(p?.backdrop);
      return p && typeof p.id === "string" && typeof p.label === "string" && backdrop?.stops ? [{ id: p.id, label: p.label.slice(0, 60), backdrop: { ...backdrop, preset: p.id } }] : [];
    });
  } catch {
    return [];
  }
}

const writeSaved = (list: BackdropPreset[]) => {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* not kept */ }
  // (the pickers that are open show the list again)
  if (typeof window !== "undefined") window.dispatchEvent(new Event("backdrop-presets"));
};

/** Saves a gradient (it gets a name, "Gradient 1", "Gradient 2", ...); returns the entry. */
export function saveGradient(b: Backdrop): BackdropPreset {
  const list = savedGradients();
  const id = `mine-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  let n = list.length + 1;
  const taken = new Set([...list, ...SHIPPED_GRADIENTS].map((p) => p.label));
  while (taken.has(`Gradient ${n}`)) n++;
  const entry: BackdropPreset = { id, label: `Gradient ${n}`, backdrop: { ...b, preset: id, stops: b.stops?.map((s) => ({ ...s })) } };
  writeSaved([...list, entry]);
  return entry;
}

/** Gives a saved gradient another name (blank: it keeps its own). */
export function renameGradient(id: string, label: string) {
  const name = label.trim().slice(0, 60);
  if (!name) return;
  writeSaved(savedGradients().map((p) => (p.id === id ? { ...p, label: name } : p)));
}

/** Takes a saved gradient out. */
export function deleteGradient(id: string) {
  writeSaved(savedGradients().filter((p) => p.id !== id));
}

/** The gradients to pick from: those that ship with the app, then the user's own. */
export const gradientPresets = (): BackdropPreset[] => [...SHIPPED_GRADIENTS, ...savedGradients()];
