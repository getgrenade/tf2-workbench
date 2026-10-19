/** The cubemaps that can light a scene: the `.vtf` files of the cubemaps folder (`user/<name>`), and the cube texture of one. */
import type * as THREE from "three";
import { listUserCubemaps, loadMaterial } from "../api";
import { parseMaterial } from "./payload";
import type { SourceMaterials } from "./sourceMaterials";

/** A cubemap texture travels as a material of its own: this path is no file, the backend makes the material from the texture. */
export const CUBEMAP_MATERIAL = (name: string) => `materials/__cubemap__/${name}.vmt`;

/** The name a cubemap of the folder goes by in a scene, and what the list shows of it. */
export const userCubemapName = (file: string) => `user/${file}`;
export function cubemapLabel(name: string): string {
  return name.replace(/^(user|maps)\//, "").replace(/^cubemaps\/cubemap_/, "");
}

/** The cubemaps of the cubemaps folder, asked for every time (a file that was put there shows up without a restart). */
export async function listCubemaps(): Promise<string[]> {
  return (await listUserCubemaps()).map(userCubemapName);
}

/** The cube texture of a game cubemap, made by the materials (so that it is kept for as long as they keep their textures). */
export async function loadCubemapTexture(materials: SourceMaterials, name: string): Promise<THREE.CubeTexture> {
  const data = parseMaterial(await loadMaterial(CUBEMAP_MATERIAL(name)));
  const cube = materials.cubemap(data);
  if (!cube) throw new Error(`${name}: ${data.errors.join("; ") || "not a cubemap"}`);
  return cube;
}
