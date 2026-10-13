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

/** Native large inventory artwork, loaded only for icons placed in camera overlays. */
export function overlayItemIcon(image: string): Promise<string | null> { return cache.overlay(image); }
