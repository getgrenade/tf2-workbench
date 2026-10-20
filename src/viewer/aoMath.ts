/** Ambient occlusion as a post effect: the settings and the sampling kernel (the pass itself is in aoPass.ts). */

export interface AoState {
  enabled: boolean;
  /** How much the occlusion darkens, 0..1. */
  strength: number;
  /** How far around a point the occlusion looks, in character heights. */
  radius: number;
  /** Contrast of the occlusion (1: as measured, higher: darker creases and lighter open surfaces). */
  power: number;
  /** The colour what is occluded goes toward (black: plain darkening). */
  tint: string;
  /** How much the occluded colour is the surface's own, deeper and more saturated (0: the tint alone, 1: the surface's own colour). */
  bleed: number;
}

export const DEFAULT_AO: AoState = { enabled: false, strength: 0.8, radius: 0.12, power: 1.5, tint: "#000000", bleed: 0 };

/**
 * Applies the occlusion to a colour (the uniforms are declared by the shader using it: tAo, uAoOn, uAoStrength, uAoPower, uAoTint, uAoBleed).
 * With a black tint and no bleed it is the plain multiplication; otherwise what is occluded goes toward the tint, and toward the colour's own
 * deeper shade (its square, half as bright: the colour it has in a crease) as the bleed says, so a red wall is dark red there, not grey.
 */
export const AO_APPLY_GLSL = /* glsl */ `
vec3 aoApply(vec3 rgb, vec2 su) {
  if (uAoOn < 0.5) return rgb;
  float lit = mix(1.0, pow(texture2D(tAo, su).r, uAoPower), uAoStrength);
  vec3 deep = mix(uAoTint, rgb * rgb * 0.5, uAoBleed);
  return mix(deep, rgb, lit);
}
`;

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** A `#rrggbb` tint as red, green and blue shares (the colour the picture is made of, as typed: no gamma change). */
export const aoTintRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** The ambient occlusion of a scene file, with anything missing or out of range replaced by the default; undefined when there is none. */
export function parseAo(raw: any): AoState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    enabled: raw.enabled === true,
    strength: num(raw.strength, 0, 1, DEFAULT_AO.strength),
    radius: num(raw.radius, 0.01, 1, DEFAULT_AO.radius),
    power: num(raw.power, 0.5, 4, DEFAULT_AO.power),
    tint: typeof raw.tint === "string" && /^#[\da-f]{6}$/i.test(raw.tint) ? raw.tint.toLowerCase() : DEFAULT_AO.tint,
    bleed: num(raw.bleed, 0, 1, DEFAULT_AO.bleed),
  };
}

/** Sample offsets in the hemisphere above a surface (z up), unit length at most, more of them near the centre. Fixed, so pictures repeat. */
export function aoKernel(count = 16): [number, number, number][] {
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    let x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 0.9 + 0.1;
    const len = Math.hypot(x, y, z);
    const t = i / count;
    const scale = (0.1 + 0.9 * t * t) * rand() * 0.5 + 0.5 * (0.1 + 0.9 * t * t);
    x = (x / len) * scale;
    y = (y / len) * scale;
    z = (z / len) * scale;
    out.push([x, y, z]);
  }
  return out;
}
