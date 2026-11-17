/**
 * Textures replaced by the user's own images (the Textures panel): any map of any material, a character's or a cosmetic's. A replacement
 * is drawn at the size of the texture it replaces (the image is scaled to it; a normal map stays normalised), everywhere that material
 * is drawn, until it is reset. The game's own pixels are kept to put back.
 */
import { decodeTga, resizeImage } from "../compiler/tga";
import type { MaterialData, TextureData } from "./payload";

/** The maps of a material, in the order the panel lists them, with what each is. */
export const TEXTURE_SLOTS: { id: string; label: string; title: string }[] = [
  { id: "base", label: "Diffuse", title: "$basetexture (its alpha is often the paint / phong mask)" },
  { id: "bump", label: "Normal", title: "$bumpmap" },
  { id: "exponent", label: "Exp mask", title: "$phongexponenttexture: the exponent, the tint mask and the rim mask in its channels" },
  { id: "envmask", label: "Env mask", title: "$envmapmask" },
  { id: "illum", label: "Self-illum", title: "$selfillummask" },
  { id: "detail", label: "Detail", title: "$detail" },
  { id: "ao", label: "AO", title: "$ambientocclTexture" },
  { id: "warp", label: "Light warp", title: "$lightwarptexture" },
  { id: "phongwarp", label: "Phong warp", title: "$phongwarptexture" },
  { id: "tex2", label: "Texture 2", title: "$texture2" },
  { id: "cornea", label: "Cornea", title: "$corneatexture" },
];

/** The image types a texture can be replaced with. */
export const REPLACEMENT_EXTENSIONS = ["png", "jpg", "jpeg", "tga", "vtf"];

/** An image the user picked, decoded to RGBA8 (top row first): a .vtf comes decoded from the backend (`VTF0`, width, height, pixels). */
export async function decodeReplacement(bytes: ArrayBuffer, name: string): Promise<TextureData> {
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (String.fromCharCode(...head) === "VTF0") {
    const view = new DataView(bytes);
    const width = view.getUint32(4, true), height = view.getUint32(8, true);
    return { width, height, rgba: new Uint8Array(bytes.slice(12, 12 + width * height * 4)) };
  }
  if (/\.tga$/i.test(name)) {
    const tga = decodeTga(bytes);
    return { width: tga.width, height: tga.height, rgba: tga.rgba };
  }
  const bitmap = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  bitmap.close();
  return { width: canvas.width, height: canvas.height, rgba: new Uint8Array(pixels.buffer.slice(0)) };
}

/** An image fitted to the texture it replaces: its size, its wrap flags; a normal map is scaled as normals. */
export function fitReplacement(image: TextureData, original: TextureData, slot: string): TextureData {
  const sized = image.width === original.width && image.height === original.height
    ? image
    : (() => {
        const r = resizeImage({ width: image.width, height: image.height, hasAlpha: true, usesAlpha: true, rgba: image.rgba as Uint8Array<ArrayBuffer> }, original.width, original.height, slot === "bump");
        return { width: r.width, height: r.height, rgba: r.rgba };
      })();
  return { ...sized, clampS: original.clampS, clampT: original.clampT };
}

interface Override {
  /** The material's path as it was given. */
  path: string;
  slot: string;
  original: TextureData;
  /** The file it came from (its name is shown). */
  file: string;
}

const key = (path: string, slot: string) => `${path.toLowerCase()}#${slot}`;

/** The replaced textures of the session, and the game's own pixels of each. */
export class TextureOverrides {
  private readonly list = new Map<string, Override>();
  private readonly listeners: (() => void)[] = [];

  constructor(
    /** Puts the pixels of a material's map wherever it is drawn. */
    private readonly put: (path: string, slot: string, data: TextureData) => void,
  ) {}

  onChange(fn: () => void) { this.listeners.push(fn); }
  private changed() { for (const fn of this.listeners) fn(); }

  /** Replaces a map of a material with an image (fitted to it); the material's data is changed in place. */
  replace(material: MaterialData, slot: string, image: TextureData, file: string) {
    const current = material.textures[slot];
    if (!current) throw new Error(`${material.path} has no ${slot} texture`);
    const k = key(material.path, slot);
    const original = this.list.get(k)?.original ?? current;
    const fitted = fitReplacement(image, original, slot);
    material.textures[slot] = fitted;
    this.list.set(k, { path: material.path, slot, original, file });
    this.put(material.path, slot, fitted);
    this.changed();
  }

  /** Puts the game's own map back. */
  reset(material: MaterialData, slot: string) {
    const k = key(material.path, slot);
    const o = this.list.get(k);
    if (!o) return;
    material.textures[slot] = o.original;
    this.list.delete(k);
    this.put(material.path, slot, o.original);
    this.changed();
  }

  /** Puts back every map of every material (`lookup` finds the material data of a path). */
  resetAll(lookup: (path: string) => MaterialData | null | undefined) {
    for (const [k, o] of [...this.list]) {
      const material = lookup(o.path);
      if (material) this.reset(material, o.slot);
      else this.list.delete(k);
    }
    this.changed();
  }

  /** The file a map was replaced with, or null when it is the game's own. */
  file(path: string, slot: string): string | null { return this.list.get(key(path, slot))?.file ?? null; }
  edited(path: string, slot?: string): boolean {
    if (slot) return this.list.has(key(path, slot));
    const prefix = `${path.toLowerCase()}#`;
    for (const k of this.list.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }
  get size() { return this.list.size; }
  /** The replaced maps as (material path, slot). */
  entries(): [string, string][] { return [...this.list.values()].map((o) => [o.path, o.slot]); }
}
