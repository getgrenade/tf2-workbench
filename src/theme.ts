/**
 * The theme of the interface: two colours (the base tone and the highlight) that every colour in tokens.css is mixed from.
 * They are written to the root element as --ui-base, --ui-accent and --ui-on-accent. The last theme is also kept in the browser's
 * storage and applied as soon as this module loads, so the interface does not flash its default colours while the stored settings load.
 */
import { onSettingsChange } from "./settingsStore";

export const DEFAULT_BASE = "#222226";
export const DEFAULT_ACCENT = "#e08a3c";
const CACHE_KEY = "tf2workbench.theme";

const HEX = /^#[0-9a-f]{6}$/i;

function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function toHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A base the interface stays readable on: dark, and not strongly coloured. */
export function normaliseBase(hex: string): string {
  if (!HEX.test(hex)) return DEFAULT_BASE;
  const [h, s, l] = toHsl(hex);
  return toHex(h, clamp(s, 0, 0.45), clamp(l, 0.07, 0.26));
}

/** A highlight that shows on the dark base, and that is not so pale or so dark that it loses its colour. */
export function normaliseAccent(hex: string): string {
  if (!HEX.test(hex)) return DEFAULT_ACCENT;
  const [h, s, l] = toHsl(hex);
  return toHex(h, clamp(s, 0.25, 1), clamp(l, 0.4, 0.72));
}

/** Text on a solid fill of this colour: dark on a bright one, white on the rest (WCAG relative luminance). */
export function onAccentFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? "#16161a" : "#ffffff";
}

let accent = DEFAULT_ACCENT;
/** The highlight colour now ("#rrggbb"), for what is drawn on a canvas and cannot read a CSS variable. */
export const accentHex = (): string => accent;

/** Puts the theme on the interface (colours that are not valid are replaced by the defaults, the others are kept in range). */
export function applyTheme(base: string, highlight: string) {
  const b = normaliseBase(base), a = normaliseAccent(highlight);
  accent = a;
  const style = document.documentElement.style;
  if (b === DEFAULT_BASE) style.removeProperty("--ui-base"); else style.setProperty("--ui-base", b);
  if (a === DEFAULT_ACCENT) style.removeProperty("--ui-accent"); else style.setProperty("--ui-accent", a);
  style.setProperty("--ui-on-accent", onAccentFor(a));
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ base: b, accent: a })); } catch { /* not remembered */ }
}

try {
  const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { base?: string; accent?: string } | null;
  if (cached) applyTheme(cached.base ?? DEFAULT_BASE, cached.accent ?? DEFAULT_ACCENT);
} catch { /* the defaults of tokens.css stay */ }

onSettingsChange((s) => applyTheme(s.uiBase, s.uiAccent));
