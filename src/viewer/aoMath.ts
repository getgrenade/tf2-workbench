/** Ambient occlusion as a post effect: the settings and the sampling kernel (the pass itself is in aoPass.ts). */

export interface AoState {
  enabled: boolean;
  /** How much the occlusion darkens, 0..1. */
  strength: number;
  /** How far around a point the occlusion looks, in character heights. */
  radius: number;
  /** Contrast of the occlusion (1: as measured, higher: darker creases and lighter open surfaces). */
  power: number;
}

export const DEFAULT_AO: AoState = { enabled: false, strength: 0.8, radius: 0.12, power: 1.5 };

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** The ambient occlusion of a scene file, with anything missing or out of range replaced by the default; undefined when there is none. */
export function parseAo(raw: any): AoState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    enabled: raw.enabled === true,
    strength: num(raw.strength, 0, 1, DEFAULT_AO.strength),
    radius: num(raw.radius, 0.01, 1, DEFAULT_AO.radius),
    power: num(raw.power, 0.5, 4, DEFAULT_AO.power),
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
