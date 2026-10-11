/** The skyboxes of the installed game: their names, and the cube texture of one (see skyboxMath.ts for how the faces fit together). */
import * as THREE from "three";
import { loadMaterial, searchPaths } from "../api";
import { parseMaterial } from "./payload";
import { buildCubeFace, parseTextureTransform, SKY_FACES, type SkyFace, type SkyPicture } from "./skyboxMath";

export { DEFAULT_SKY, parseSky, type SkyState } from "./skyState";

/** "sky_dustbowl_01" as "Dustbowl 01". */
export function skyLabel(name: string): string {
  return name.replace(/^sky_/, "").split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

let names: Promise<string[]> | null = null;

/** The skyboxes that the game has (`materials/skybox/<name>ft.vmt` and the five others); the `_hdr` ones only hold the same pictures in HDR. */
export function listSkies(): Promise<string[]> {
  names ??= searchPaths("materials/skybox/sky_", 4000).then((paths) => {
    const found = new Set<string>();
    for (const p of paths) {
      const m = /^materials\/skybox\/(sky_[a-z0-9_]+?)(?:ft|bk|lf|rt|up|dn)\.vmt$/i.exec(p);
      if (m && !/_hdr$/i.test(m[1])) found.add(m[1].toLowerCase());
    }
    const all = [...found].filter((n) => SKY_FACES.every((f) => paths.some((p) => p.toLowerCase() === `materials/skybox/${n}${f}.vmt`))).sort();
    if (!all.length) names = null; // nothing yet: the game may still be getting indexed, so the next ask looks again
    return all;
  }).catch((e) => { names = null; throw e; });
  return names;
}

/** The size of the faces of the cube texture: as sharp as the sky's own pictures, up to this. */
const MAX_FACE = 1024;

async function loadPicture(name: string, face: SkyFace): Promise<SkyPicture> {
  const material = parseMaterial(await loadMaterial(`materials/skybox/${name}${face}.vmt`));
  const base = material.textures.base;
  if (!base) throw new Error(`${name}${face}: no texture (${material.errors.join("; ") || "unknown"})`);
  return { width: base.width, height: base.height, rgba: base.rgba, transform: parseTextureTransform(material.params["$basetexturetransform"]), clampS: base.clampS === true, clampT: base.clampT === true };
}

/** The cube texture of a sky (colours in sRGB, as the game's textures are). */
export async function loadSkyTexture(name: string): Promise<THREE.CubeTexture> {
  const pictures = {} as Record<SkyFace, SkyPicture>;
  await Promise.all(SKY_FACES.map(async (f) => { pictures[f] = await loadPicture(name, f); }));
  const size = Math.min(MAX_FACE, Math.max(...SKY_FACES.map((f) => pictures[f].width)));
  const images: ImageData[] = [];
  for (let i = 0; i < 6; i++) {
    // one face at a time, so that the window keeps drawing while the sky is made
    await new Promise((r) => setTimeout(r));
    images.push(new ImageData(buildCubeFace(pictures, size, i), size, size));
  }
  const texture = new THREE.CubeTexture(images);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
