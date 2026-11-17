/**
 * The font of the interface: its own (Inter / Segoe UI), or one of the game's, read from the TF2 install as the overlays read theirs (no
 * game file ships with the app). It is written to the root element as --ui-font, with the default fonts behind it for what it lacks.
 */
import { onSettingsChange } from "./settingsStore";
import { ensureOverlayFont, overlayFontFamily } from "./viewer/overlayFonts";

/** The fonts the interface can be drawn in: "" is its own. */
export const UI_FONTS = [
  { path: "", label: "Default" },
  { path: "resource/tf2secondary.ttf", label: "TF2 Secondary (the game's menus)" },
  { path: "resource/tf2build.ttf", label: "TF2 Build (the game's titles)" },
] as const;

const DEFAULT_STACK = 'Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

/** The --ui-font value for a font path (the default stack for "" or a path not on the list). */
export function uiFontFamily(path: string): string {
  if (!path || !UI_FONTS.some((f) => f.path === path)) return DEFAULT_STACK;
  const [own] = overlayFontFamily(path).split(",");
  return `${own}, ${DEFAULT_STACK}`;
}

let wanted = "";
/** Puts a font on the interface once the game's file of it is loaded (the default when it cannot be). */
export async function applyUiFont(path: string) {
  wanted = path;
  const style = document.documentElement.style;
  if (!path || !UI_FONTS.some((f) => f.path === path)) { style.removeProperty("--ui-font"); return; }
  try { await ensureOverlayFont(path); } catch (error) { console.warn(`interface font ${path}:`, error); return; }
  if (wanted === path) style.setProperty("--ui-font", uiFontFamily(path));
}

onSettingsChange((s) => void applyUiFont(s.uiFont));
