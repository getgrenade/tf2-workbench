import * as THREE from "three";
import type { BodyClass } from "./bodyGroups";

const textures = new Map<BodyClass, THREE.Texture>();
/** The masks still loading: a body part they hide shows until its mask is in. */
const loading = new Set<Promise<unknown>>();
export function bodyMaskTextures(): THREE.Texture[] { return [...textures.values()]; }
/** Resolves once every body mask asked for so far is loaded (a picture taken before would show the parts it hides). */
export async function bodyMasksLoaded(): Promise<void> {
  while (loading.size) await Promise.allSettled([...loading]);
}
/** One lossless, shared bit atlas per loaded class; no colour conversion or UV flipping. */
export function bodyMaskTexture(cls: BodyClass): THREE.Texture {
  let texture = textures.get(cls);
  if (!texture) {
    let done = () => {};
    const ready = new Promise<void>((resolve) => (done = resolve));
    loading.add(ready);
    void ready.then(() => loading.delete(ready));
    texture = new THREE.TextureLoader().load(new URL(`../assets/bodyMasks/${cls}.png`, import.meta.url).href, () => done(), undefined, () => done());
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textures.set(cls, texture);
  }
  return texture;
}
