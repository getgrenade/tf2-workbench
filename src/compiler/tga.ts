/**
 * A TGA reader for the textures the item importer takes (item_import.cpp CTargetTGA): uncompressed and run-length true colour, grayscale
 * and colour-mapped images of 8, 15/16, 24 and 32 bits, in either row order. The pixels come out as RGBA8, top row first.
 */
export interface TgaImage {
  width: number;
  height: number;
  /** The file has an alpha channel (a 32 bit image, or 16 bit with the attribute bit). */
  hasAlpha: boolean;
  /** Whether any pixel is not fully opaque. */
  usesAlpha: boolean;
  rgba: Uint8Array<ArrayBuffer>;
}

export class TgaError extends Error {}

/**
 * Writes an RGBA8 image (top row first) as an uncompressed TGA, the top row first in the file: 32 bit with an alpha channel, or (`alpha`
 * false) 24 bit without one.
 */
export function encodeTga(rgba: ArrayLike<number>, width: number, height: number, alpha = true): Uint8Array {
  const n = alpha ? 4 : 3;
  const out = new Uint8Array(18 + width * height * n);
  out[2] = 2;
  out[12] = width & 255; out[13] = width >> 8;
  out[14] = height & 255; out[15] = height >> 8;
  out[16] = alpha ? 32 : 24;
  out[17] = alpha ? 0x28 : 0x20; // (8 bits of alpha,) rows from the top
  for (let i = 0, o = 18; i < width * height * 4; i += 4, o += n) {
    out[o] = rgba[i + 2]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i];
    if (alpha) out[o + 3] = rgba[i + 3];
  }
  return out;
}

/**
 * The size a texture is made to fit its limit (see TEXTURE_LIMITS): each side the power of two at or under it, then both halved together
 * until they are within the limit (the shape kept). Null when it fits as it is.
 */
export function fittedSize(image: { width: number; height: number }, kind: TextureKind): { width: number; height: number } | null {
  if (!textureProblem(image, kind)) return null;
  const limit = TEXTURE_LIMITS[kind];
  const floorPow2 = (n: number) => 2 ** Math.floor(Math.log2(Math.max(1, n)));
  let width = floorPow2(image.width), height = floorPow2(image.height);
  while (width > limit || height > limit) { width = Math.max(1, width / 2); height = Math.max(1, height / 2); }
  return { width, height };
}

/**
 * An image made smaller (or another shape): each pixel the average of the ones it covers (weighted by how much of each). A normal map's
 * averaged normals are made unit length again (`normal`): an average of unit vectors is shorter, which would flatten the lighting.
 */
export function resizeImage(image: TgaImage, width: number, height: number, normal = false): TgaImage {
  const { width: sw, height: sh, rgba: src } = image;
  const out = new Uint8Array(width * height * 4);
  const fx = sw / width, fy = sh / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < width; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      const sum = [0, 0, 0, 0];
      let weight = 0;
      for (let sy = Math.floor(y0); sy < Math.min(sh, Math.ceil(y1)); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(sw, Math.ceil(x1)); sx++) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = (sy * sw + sx) * 4;
          sum[0] += src[i] * w; sum[1] += src[i + 1] * w; sum[2] += src[i + 2] * w; sum[3] += src[i + 3] * w;
          weight += w;
        }
      }
      const o = (y * width + x) * 4;
      let [r, g, b] = [sum[0] / weight, sum[1] / weight, sum[2] / weight];
      if (normal) {
        const v = [r / 127.5 - 1, g / 127.5 - 1, b / 127.5 - 1], len = Math.hypot(v[0], v[1], v[2]) || 1;
        [r, g, b] = v.map((c) => (c / len + 1) * 127.5);
      }
      out[o] = Math.round(r); out[o + 1] = Math.round(g); out[o + 2] = Math.round(b); out[o + 3] = Math.round(sum[3] / weight);
    }
  }
  let usesAlpha = false;
  for (let i = 3; i < out.length; i += 4) if (out[i] < 255) { usesAlpha = true; break; }
  return { width, height, hasAlpha: image.hasAlpha, usesAlpha, rgba: out };
}

export function decodeTga(buffer: ArrayBuffer | Uint8Array): TgaImage {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 18) throw new TgaError("The file is too small to be a TGA image");
  const idLength = bytes[0], mapType = bytes[1], type = bytes[2];
  const mapFirst = bytes[3] | (bytes[4] << 8), mapLength = bytes[5] | (bytes[6] << 8), mapDepth = bytes[7];
  const width = bytes[12] | (bytes[13] << 8), height = bytes[14] | (bytes[15] << 8), depth = bytes[16], descriptor = bytes[17];
  const rle = type >= 9;
  const base = rle ? type - 8 : type;
  if (![1, 2, 3].includes(base)) throw new TgaError(`Unsupported TGA image type ${type}`);
  if (!width || !height) throw new TgaError("The image has no pixels");
  if (![8, 15, 16, 24, 32].includes(depth)) throw new TgaError(`Unsupported TGA pixel depth ${depth}`);
  if (base === 1 && (mapType !== 1 || ![15, 16, 24, 32].includes(mapDepth))) throw new TgaError("Unsupported TGA colour map");

  let at = 18 + idLength;
  // the colour map
  const mapBytes = mapType === 1 ? Math.ceil(mapDepth / 8) : 0;
  const palette: number[][] = [];
  if (mapType === 1) {
    for (let i = 0; i < mapLength; i++, at += mapBytes) {
      if (at + mapBytes > bytes.length) throw new TgaError("The colour map is cut short");
      palette[mapFirst + i] = readPixel(bytes, at, mapDepth);
    }
  }

  const bytesPerPixel = Math.ceil(depth / 8);
  const pixels = width * height;
  const raw = new Uint8Array(pixels * bytesPerPixel);
  if (!rle) {
    if (at + raw.length > bytes.length) throw new TgaError("The pixel data is cut short");
    raw.set(bytes.subarray(at, at + raw.length));
  } else {
    let out = 0;
    while (out < raw.length) {
      if (at >= bytes.length) throw new TgaError("The pixel data is cut short");
      const head = bytes[at++], count = (head & 127) + 1;
      if (out + count * bytesPerPixel > raw.length) throw new TgaError("A run goes past the end of the image");
      if (head & 128) {
        if (at + bytesPerPixel > bytes.length) throw new TgaError("The pixel data is cut short");
        for (let i = 0; i < count; i++) raw.set(bytes.subarray(at, at + bytesPerPixel), out + i * bytesPerPixel);
        at += bytesPerPixel;
      } else {
        if (at + count * bytesPerPixel > bytes.length) throw new TgaError("The pixel data is cut short");
        raw.set(bytes.subarray(at, at + count * bytesPerPixel), out);
        at += count * bytesPerPixel;
      }
      out += count * bytesPerPixel;
    }
  }

  const rgba = new Uint8Array(pixels * 4);
  const topFirst = (descriptor & 0x20) !== 0, rightFirst = (descriptor & 0x10) !== 0;
  const alphaBits = descriptor & 0x0f;
  // a 32 bit file has an alpha channel whatever its descriptor says (the importer's own writer leaves the alpha bits at 0)
  const hasAlpha = depth === 32 ? true : depth === 16 ? alphaBits > 0 : base === 1 && mapDepth === 32;
  let usesAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = topFirst ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const column = rightFirst ? width - 1 - x : x;
      const src = (y * width + x) * bytesPerPixel;
      let px: number[];
      if (base === 1) {
        const index = raw[src];
        px = palette[index] ?? [0, 0, 0, 255];
      } else if (base === 3) {
        px = depth === 8 ? [raw[src], raw[src], raw[src], 255] : [raw[src], raw[src], raw[src], raw[src + 1]];
      } else {
        px = readPixel(raw, src, depth);
      }
      const dst = (row * width + column) * 4;
      rgba[dst] = px[0]; rgba[dst + 1] = px[1]; rgba[dst + 2] = px[2]; rgba[dst + 3] = px[3];
      if (px[3] !== 255) usesAlpha = true;
    }
  }
  return { width, height, hasAlpha, usesAlpha, rgba };
}

/** One pixel of the given depth as r, g, b, a (the file stores b, g, r[, a]; 15/16 bit is 1-5-5-5). */
function readPixel(b: Uint8Array, at: number, depth: number): number[] {
  if (depth === 24) return [b[at + 2], b[at + 1], b[at], 255];
  if (depth === 32) return [b[at + 2], b[at + 1], b[at], b[at + 3]];
  if (depth === 8) return [b[at], b[at], b[at], 255];
  const v = b[at] | (b[at + 1] << 8);
  const c = (shift: number) => { const x = (v >> shift) & 31; return (x << 3) | (x >> 2); };
  return [c(10), c(5), c(0), 255];
}

export const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

/** The largest size the importer accepts for each kind of texture (CheckImageSize). */
export const TEXTURE_LIMITS = { color: 512, normal: 512, phongexponent: 256, illum: 256, icon: 512 } as const;
export type TextureKind = keyof typeof TEXTURE_LIMITS;

/** Why the importer would refuse this image for this texture kind, or null. */
export function textureProblem(image: { width: number; height: number }, kind: TextureKind): string | null {
  const limit = TEXTURE_LIMITS[kind];
  if (image.width > limit || image.height > limit) return `is ${image.width}x${image.height}; the limit is ${limit}x${limit}`;
  if (kind !== "icon" && (!isPowerOfTwo(image.width) || !isPowerOfTwo(image.height))) return `is ${image.width}x${image.height}; both sides must be a power of two`;
  return null;
}

/** The rows of a backpack icon that may hold the picture; the rest must be empty (SetItemIcon). */
export const ICON_SAFE_ROWS = { start: 91, end: 420 } as const;

/**
 * Why the importer would refuse this image as the backpack icon, or null: it must be 512x512 with an alpha channel, nothing outside the
 * safe rows, and (in the safe rows) mostly black where it is transparent.
 */
export function iconProblem(image: TgaImage): string | null {
  if (image.width !== 512 || image.height !== 512) return `is ${image.width}x${image.height}; an icon is 512x512`;
  if (!image.hasAlpha) return "has no alpha channel; save it as a 32 bit TGA";
  let bad = 0;
  for (let y = 0; y < 512; y++) {
    const safe = y >= ICON_SAFE_ROWS.start && y < ICON_SAFE_ROWS.end;
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      const colour = image.rgba[i] || image.rgba[i + 1] || image.rgba[i + 2];
      if (safe) { if (image.rgba[i + 3] === 0 && colour) bad++; }
      else if (colour || image.rgba[i + 3]) return `has pixels outside the safe zone (rows ${ICON_SAFE_ROWS.start} to ${ICON_SAFE_ROWS.end - 1}); keep the picture inside it`;
    }
  }
  if (bad / (512 * (ICON_SAFE_ROWS.end - ICON_SAFE_ROWS.start)) > 0.05) return "has a background that is not black where it is transparent";
  return null;
}
