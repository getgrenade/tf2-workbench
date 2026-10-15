/** The cubemaps of the installed game that can light a scene: their names, and the cube texture of one. */
import type * as THREE from "three";
import { loadMaterial, searchPaths } from "../api";
import { parseMaterial } from "./payload";
import type { SourceMaterials } from "./sourceMaterials";

/** A cubemap texture travels as a material of its own: this path is no file, the backend makes the material from the texture. */
export const CUBEMAP_MATERIAL = (name: string) => `materials/__cubemap__/${name}.vmt`;

/** Cubemaps that are not in `materials/cubemaps/`, with names for the list. */
const EXTRA: { name: string; label: string }[] = [
  { name: "hlmv/cubemap", label: "Studio (the viewer's own)" },
  { name: "effects/saxxy/saxxy_gold", label: "Saxxy gold" },
  { name: "effects/pyrocube", label: "Pyroland" },
];

/**
 * The cubemaps of some of the game's maps (`maps/<map>`), which come with the program: they are in no game archive. The names are the maps'
 * and the labels what the list shows; the program only has the ones that were built in the map.
 */
export const MAP_CUBEMAPS: { name: string; label: string }[] = [
  { name: "maps/cp_dustbowl", label: "Dustbowl (CP)" },
  { name: "maps/cp_foundry", label: "Foundry (CP)" },
  { name: "maps/cp_gorge", label: "Gorge (CP)" },
  { name: "maps/cp_granary", label: "Granary (CP)" },
  { name: "maps/cp_gravelpit", label: "Gravel Pit (CP)" },
  { name: "maps/cp_well", label: "Well (CP)" },
  { name: "maps/ctf_2fort", label: "2Fort (CTF)" },
  { name: "maps/ctf_doublecross", label: "Double Cross (CTF)" },
  { name: "maps/ctf_foundry", label: "Foundry (CTF)" },
  { name: "maps/pl_upward", label: "Upward (PL)" },
];

/** "cubemaps/cubemap_gold001" as "Gold 001". */
export function cubemapLabel(name: string): string {
  const extra = EXTRA.find((e) => e.name === name) ?? MAP_CUBEMAPS.find((e) => e.name === name);
  if (extra) return extra.label;
  const m = /^([a-z_]*?)(\d+)?$/i.exec(name.replace(/^cubemaps\/cubemap_/, ""));
  const word = (m?.[1] || name).replace(/_/g, " ");
  return `${word[0].toUpperCase()}${word.slice(1)}${m?.[2] ? ` ${m[2]}` : ""}`;
}

let names: Promise<string[]> | null = null;
/** The cubemaps the game has (`materials/cubemaps/cubemap_*.vtf`; the `.hdr` files only hold the same ones in HDR), then the few others. */
export function listCubemaps(): Promise<string[]> {
  names ??= searchPaths("materials/cubemaps/cubemap_", 400).then((paths) => {
    const found = paths.filter((p) => /^materials\/cubemaps\/[^/]+\.vtf$/i.test(p) && !/\.hdr\.vtf$/i.test(p)).map((p) => p.replace(/^materials\//i, "").replace(/\.vtf$/i, "")).sort();
    if (!found.length) throw new Error("no cubemaps yet");
    // the maps' own cubemaps are in the program (the web build has the game's only)
    return [...found, ...EXTRA.map((e) => e.name), ...(__WEB__ ? [] : MAP_CUBEMAPS.map((e) => e.name))];
  }).catch((e) => { names = null; throw e; });
  return names;
}

/** The cube texture of a game cubemap, made by the materials (so that it is kept for as long as they keep their textures). */
export async function loadCubemapTexture(materials: SourceMaterials, name: string): Promise<THREE.CubeTexture> {
  const data = parseMaterial(await loadMaterial(CUBEMAP_MATERIAL(name)));
  const cube = materials.cubemap(data);
  if (!cube) throw new Error(`${name}: ${data.errors.join("; ") || "not a cubemap"}`);
  return cube;
}
