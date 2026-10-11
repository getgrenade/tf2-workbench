import type * as THREE from "three";

/** Retained asset storage estimate, not process RAM. Shared backing buffers count once. */
export function cachedDataBytes(values: Iterable<unknown>): number {
  const seen = new Set<object>();
  const size = (value: unknown): number => {
    if (typeof value === "number") return 8;
    if (typeof value === "string") return value.length * 2;
    if (!value || typeof value !== "object" || seen.has(value)) return 0;
    seen.add(value);
    if (ArrayBuffer.isView(value)) return size(value.buffer);
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (value instanceof Map) return [...value].reduce((sum, pair) => sum + size(pair), 0);
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + size(item), 0);
    return Object.values(value).reduce<number>((sum, item) => sum + size(item), 0);
  };
  let bytes = 0;
  for (const value of values) bytes += size(value);
  return bytes;
}

export function textureImages(texture: THREE.Texture): unknown[] {
  const images = Array.isArray(texture.image) ? texture.image : [texture.image];
  return images.map((image) => image?.isTexture ? image.image : image);
}

/** GPU copies of cached textures and static geometry, including generated texture mipmaps. */
export function cachedGpuBytes(textures: Iterable<THREE.Texture>, geometries: Iterable<THREE.BufferGeometry>): number {
  let bytes = 0;
  const seen = new Set<object>();
  for (const texture of textures) {
    if (seen.has(texture)) continue;
    seen.add(texture);
    for (const image of textureImages(texture) as { data?: ArrayBufferView; width?: number; height?: number }[]) {
      if (!image) continue;
      bytes += (image.data?.byteLength ?? (image.width ?? 0) * (image.height ?? 0) * 4) * (texture.generateMipmaps ? 4 / 3 : 1);
    }
  }
  for (const geometry of geometries) {
    for (const attribute of [...Object.values(geometry.attributes), geometry.index]) {
      if (!attribute) continue;
      const buffer = "data" in attribute ? attribute.data : attribute;
      if (seen.has(buffer)) continue;
      seen.add(buffer);
      bytes += buffer.array.byteLength;
    }
  }
  return bytes;
}
