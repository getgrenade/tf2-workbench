import * as THREE from "three";
import type { BodyClass } from "./bodyGroups";

const textures = new Map<BodyClass, THREE.Texture>();
export function bodyMaskTextures(): THREE.Texture[] { return [...textures.values()]; }
/** One lossless, shared bit atlas per loaded class; no colour conversion or UV flipping. */
export function bodyMaskTexture(cls: BodyClass): THREE.Texture {
  let texture = textures.get(cls);
  if (!texture) {
    texture = new THREE.TextureLoader().load(new URL(`../assets/bodyMasks/${cls}.png`, import.meta.url).href);
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textures.set(cls, texture);
  }
  return texture;
}
