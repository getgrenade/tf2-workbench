/** The reflections of a scene: the part of reflection.ts that needs no game files or graphics (the scene files read it). */

export interface ReflectionState {
  /** The cubemap of the game (a path under materials/, like `cubemaps/cubemap_gold001`) that "the cubemap of the level" shows; empty: the viewer's own. */
  cubemap: string;
  /** A factor on the brightness of what it reflects. */
  brightness: number;
}

export const DEFAULT_REFLECTION: ReflectionState = { cubemap: "", brightness: 1 };

/** The reflections of a scene file (undefined when it has none). */
export function parseReflection(raw: unknown): ReflectionState | undefined {
  const v = raw as Partial<ReflectionState> | null;
  if (!v || typeof v !== "object" || typeof v.cubemap !== "string") return undefined;
  const brightness = typeof v.brightness === "number" && Number.isFinite(v.brightness) ? Math.min(4, Math.max(0, v.brightness)) : 1;
  return { cubemap: v.cubemap.slice(0, 120), brightness };
}
