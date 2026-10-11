import { loadOverlayFont } from "../api";

export const OVERLAY_FONTS = [
  { path: "", label: "System (Segoe UI)" },
  { path: "resource/tf2build.ttf", label: "TF2 Build" },
  { path: "resource/tf2secondary.ttf", label: "TF2 Secondary" },
  { path: "resource/tf2professor.ttf", label: "TF2 Professor" },
  { path: "resource/tf2.ttf", label: "TF2" },
  { path: "resource/tf.ttf", label: "TF" },
  { path: "resource/tfd.ttf", label: "TF Display" },
  { path: "resource/ocra.ttf", label: "OCR-A" },
] as const;
export const validOverlayFont = (path: unknown): path is string => typeof path === "string" && OVERLAY_FONTS.some(font => font.path === path);
export function overlayFontFamily(path?: string) {
  return path && validOverlayFont(path) ? `"Overlay_${path.split('/').pop()!.replace('.ttf', '')}", "Segoe UI", sans-serif` : '"Segoe UI", sans-serif';
}
const fonts = new Map<string, Promise<void>>();
/** Font bytes stay in memory; only paths are saved in overlays. Load selected fonts, not the whole catalog. */
export function ensureOverlayFont(path?: string): Promise<void> {
  if (!path) return Promise.resolve();
  if (!validOverlayFont(path)) return Promise.reject(new Error("Unsupported overlay font"));
  let pending = fonts.get(path);
  if (!pending) {
    pending = (async () => {
      const bytes = await loadOverlayFont(path);
      const face = new FontFace(`Overlay_${path.split('/').pop()!.replace('.ttf', '')}`, bytes);
      await face.load(); document.fonts.add(face);
    })();
    fonts.set(path, pending);
    void pending.catch(() => { fonts.delete(path); });
  }
  return pending;
}
