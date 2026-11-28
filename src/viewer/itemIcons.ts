import { loadMaterial } from "../api";
import { parseMaterial } from "./payload";
import { InventoryIconCache } from "./inventoryIconCache";
import { keepPicture, keptPicture } from "../thumbCache";

/** Item inventory icons (`image_inventory` of items_game.txt), decoded from the install on demand. */
const cache = new InventoryIconCache(image => slot(() => decode(image)));
const MAX_PARALLEL = 6;
let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function decode(image: string): Promise<string | null> {
  const vmt = `materials/${image}.vmt`;
  // the picture of an earlier launch, if the game has not changed since
  const kept = await keptPicture("icon", vmt);
  if (kept) return kept;
  try {
    const tex = parseMaterial(await loadMaterial(vmt)).textures.base;
    if (!tex) return null;
    const canvas = document.createElement("canvas");
    canvas.width = tex.width;
    canvas.height = tex.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(tex.rgba), tex.width, tex.height), 0, 0);
    keepPicture("icon", vmt, canvas);
    return canvas.toDataURL();
  } catch {
    return null;
  }
}

/** Forgets the cached icons of the images `match` accepts (a workshop icon changed). */
export function purgeIcons(match: (image: string) => boolean) {
  cache.purge(match);
}

/** A data URL for the icon, or null when the item has none in the install. Results are cached. */
export function itemIcon(image: string): Promise<string | null> {
  return cache.small(image);
}

/**
 * The icon without its empty border (a taunt's picture is a small card in the middle of the image): cut to what is drawn, with a
 * little margin, so it fills its tile.
 */
const trimmedIcons = new Map<string, Promise<string | null>>();
export function trimmedItemIcon(image: string): Promise<string | null> {
  let p = trimmedIcons.get(image);
  if (!p) {
    p = itemIcon(image).then((url) => (url ? trimIcon(url) : null)).catch(() => null);
    trimmedIcons.set(image, p);
  }
  return p;
}
async function trimIcon(url: string): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a[(y * w + x) * 4 + 3] <= 8) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return url;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return url;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL();
}


