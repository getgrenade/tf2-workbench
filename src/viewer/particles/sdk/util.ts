import type { Collection } from "./collection";
import type { Vec3 } from "./attrs";

export const RAD = Math.PI / 180;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const smooth = (t: number) => t * t * (3 - 2 * t);
/** Valve's RemapValClamped. */
export function remapClamped(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMin === inMax) return v >= inMax ? outMax : outMin;
  const t = clamp((v - inMin) / (inMax - inMin), 0, 1);
  return outMin + t * (outMax - outMin);
}
/** RemapVal (no clamping). */
export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMin === inMax) return v >= inMax ? outMax : outMin;
  return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** The attributes by their number in the engine (PARTICLE_ATTRIBUTE_*), for the operators that name a field. */
export function field(c: Collection, id: number): { array: Float32Array; size: number } | null {
  switch (id) {
    case 0: return { array: c.xyz, size: 3 };
    case 1: return { array: c.life, size: 1 };
    case 2: return { array: c.prev, size: 3 };
    case 3: return { array: c.radius, size: 1 };
    case 4: return { array: c.rotation, size: 1 };
    case 5: return { array: c.rotSpeed, size: 1 };
    case 6: return { array: c.rgb, size: 3 };
    case 7: return { array: c.alpha, size: 1 };
    case 8: return { array: c.creation, size: 1 };
    case 9: return { array: c.seq, size: 1 };
    case 10: return { array: c.trail, size: 1 };
    case 11: return { array: c.id, size: 1 };
    case 12: return { array: c.yaw, size: 1 };
    case 13: return { array: c.seq1, size: 1 };
    case 14: return { array: c.hitbox, size: 1 };
    case 15: return { array: c.hitRel, size: 3 };
    case 16: return { array: c.alpha2, size: 1 };
    case 17: return { array: c.traceP0, size: 3 };
    case 18: return { array: c.traceP1, size: 3 };
    case 19: return { array: c.traceHit, size: 1 };
    case 20: return { array: c.traceNormal, size: 3 };
    case 21: return { array: c.cpIndex, size: 1 };
    default: return null;
  }
}
/** The same for the values a particle had at birth (the ones operators may ask for). */
export function initialField(c: Collection, id: number): { array: Float32Array; size: number } | null {
  const names: Record<number, keyof Collection["initial"]> = { 0: "xyz", 1: "life", 3: "radius", 4: "rotation", 5: "rotSpeed", 6: "rgb", 7: "alpha", 8: "creation", 9: "seq", 10: "trail", 12: "yaw", 16: "alpha2" };
  const name = names[id];
  const f = field(c, id);
  return name && f ? { array: c.initial[name], size: f.size } : null;
}

/** Makes a vector unit length (a zero vector stays zero). */
export function normalize(v: Vec3): number {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l > 1e-12) { v[0] /= l; v[1] /= l; v[2] /= l; }
  return l;
}
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
