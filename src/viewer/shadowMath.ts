/**
 * Geometry of the ground shadow: a planar projection of the model onto the floor along a direction (viewer space: x left,
 * y up, z toward the camera at start). Kept free of three.js so it can be unit tested.
 */

export interface ShadowParams {
  enabled: boolean;
  /** Degrees; the compass direction the shadow falls toward, 0 = away from the camera, 90 = to the model's left (+x). */
  azimuth: number;
  /** Horizontal travel per unit of height: 0 drops the shadow straight down (a blob), 1 is a 45 degree light. */
  length: number;
  /** Gaussian blur sigma in world units (0 = hard edge). */
  blur: number;
  /** Strength of the shadow, 0..1. */
  opacity: number;
}

export const DEFAULT_SHADOW: ShadowParams = { enabled: true, azimuth: 32, length: 0.8, blur: 0.5, opacity: 0.8 };

/** Resolution of the shadow texture (square). */
export const SHADOW_TEXTURE_SIZE = 1024;

export interface ShadowFootprint {
  /** Unit horizontal direction the shadow falls toward. */
  dirX: number;
  dirZ: number;
  /** Centre of the ground square the shadow is drawn into, and its half size. */
  centerX: number;
  centerZ: number;
  half: number;
  /** Blur sigma converted to texels of the shadow texture. */
  sigmaTexels: number;
}

/**
 * Where to put the ground square for a model centred at (cx, cz) with the given bounding radius: it is shifted along the
 * shadow direction and grows with the length so a long shadow stays inside it.
 */
export function shadowFootprint(p: ShadowParams, cx: number, cz: number, radius: number): ShadowFootprint {
  const az = (p.azimuth * Math.PI) / 180;
  // Opposite of the light azimuth convention in viewer.ts (0 = light from the camera side, so the shadow falls behind).
  const dirX = Math.sin(az);
  const dirZ = -Math.cos(az);
  const reach = radius * p.length;
  const half = radius * (1.6 + p.length) + p.blur * 3;
  const worldPerTexel = (2 * half) / SHADOW_TEXTURE_SIZE;
  return { dirX, dirZ, centerX: cx + dirX * reach, centerZ: cz + dirZ * reach, half, sigmaTexels: p.blur / worldPerTexel };
}

/**
 * Where a point at `height` above the floor lands: it moves by `length * height` along the shadow direction
 * (the same formula the shadow vertex shader uses).
 */
export function projectToFloor(x: number, z: number, height: number, p: ShadowParams): [number, number] {
  const f = shadowFootprint(p, 0, 0, 1);
  const h = Math.max(height, 0);
  return [x + f.dirX * p.length * h, z + f.dirZ * p.length * h];
}

/** Gaussian blur taps for one axis: offsets in texels and normalised weights, spanning about +-2.5 sigma. */
export function blurTaps(sigmaTexels: number, taps = 17): { offsets: number[]; weights: number[] } {
  const n = Math.max(1, Math.floor(taps / 2));
  const step = sigmaTexels > 0 ? (2.5 * sigmaTexels) / n : 0;
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let i = -n; i <= n; i++) {
    offsets.push(i * step);
    weights.push(sigmaTexels > 0 ? Math.exp(-(i * step * i * step) / (2 * sigmaTexels * sigmaTexels)) : i === 0 ? 1 : 0);
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return { offsets, weights: weights.map((w) => w / sum) };
}
