/** The reflections of a scene: the part of reflection.ts that needs no game files or graphics (the scene files read it). */

export interface ReflectionState {
  /** The cubemap that "the cubemap of the level" shows: `user/<name>` for a file of the cubemaps folder (an older scene can have a path under the game's materials/); empty: the default. */
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
  // the cubemap of 2fort was once the program's own, it is now the one in the cubemaps folder
  const cubemap = v.cubemap === "maps/2fort" ? "user/2fort" : v.cubemap.slice(0, 120);
  return { cubemap, brightness };
}
