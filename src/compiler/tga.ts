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

/** Writes an RGBA8 image (top row first) as an uncompressed 32 bit TGA with an alpha channel, the top row first in the file. */
export function encodeTga(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(18 + width * height * 4);
  out[2] = 2;
  out[12] = width & 255; out[13] = width >> 8;
  out[14] = height & 255; out[15] = height >> 8;
  out[16] = 32;
  out[17] = 0x28; // 8 bits of alpha, rows from the top
  for (let i = 0, o = 18; i < width * height * 4; i += 4, o += 4) {
    out[o] = rgba[i + 2]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i]; out[o + 3] = rgba[i + 3];
  }
  return out;
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
