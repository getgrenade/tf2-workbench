/**
 * Pictures kept on disk between launches (the desktop program only): an item's inventory icon and a prop's thumbnail are a model or a texture
 * of the game, decoded or drawn on the first use; the picture is kept as a small WebP in the program's cache folder, and the next launch reads
 * it back instead (see src-tauri thumbcache.rs for when it is stale).
 */
import { thumbCacheGet, thumbCachePut } from "./api";

/** A kept picture as an address the page can show, or null (none kept, or the web version, which keeps nothing). */
export async function keptPicture(kind: "icon" | "prop", key: string): Promise<string | null> {
  if (__WEB__) return null;
  try {
    const bytes = await thumbCacheGet(kind, key);
    return bytes ? URL.createObjectURL(new Blob([bytes], { type: "image/webp" })) : null;
  } catch {
    return null;
  }
}

/** Keeps a picture drawn on a canvas (it does not matter if that fails: it is only a cache). */
export function keepPicture(kind: "icon" | "prop", key: string, canvas: HTMLCanvasElement) {
  if (__WEB__) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    void blob.arrayBuffer().then((buffer) => thumbCachePut(kind, key, new Uint8Array(buffer))).catch(() => {});
  }, "image/webp", 0.85);
}
