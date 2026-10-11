/** The sky of a scene: the part of skybox.ts that needs no game files or graphics (the scene files read it). */

export interface SkyState {
  /** The name of the skybox (`sky_dustbowl_01`); empty: no sky, the plain background. */
  name: string;
  /** Degrees around the vertical axis. */
  rotation: number;
  /** A factor on the brightness of the picture. */
  brightness: number;
}

export const DEFAULT_SKY: SkyState = { name: "", rotation: 0, brightness: 1 };

/** The sky of a scene file (undefined when it has none). */
export function parseSky(raw: unknown): SkyState | undefined {
  const v = raw as Partial<SkyState> | null;
  if (!v || typeof v !== "object" || typeof v.name !== "string") return undefined;
  const n = (x: unknown, fallback: number, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
  return { name: v.name.slice(0, 80), rotation: n(v.rotation, 0, -360, 360), brightness: n(v.brightness, 1, 0, 4) };
}
