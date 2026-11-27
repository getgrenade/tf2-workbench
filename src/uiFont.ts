/**
 * The fonts of the interface: its own (Inter / Segoe UI), or Team Fortress 2's, read from the TF2 install as the overlays read theirs (no
 * game file ships with the app). The game draws its titles in TF2 Build and the rest in TF2 Secondary, and so does the interface with
 * the TF2 fonts on: they are written to the root element as --ui-font-head and --ui-font, with the default fonts behind them for what they lack.
 */
import { onSettingsChange } from "./settingsStore";
import { ensureOverlayFont, overlayFontFamily } from "./viewer/overlayFonts";

/** The font sets of the interface: "" is its own. */
export const UI_FONTS = [
  { id: "", label: "Default" },
  { id: "tf2", label: "TF2 (TF2 Build titles, TF2 Secondary text)" },
] as const;

const TF2_HEAD = "resource/tf2build.ttf";
const TF2_BODY = "resource/tf2secondary.ttf";
const DEFAULT_STACK = 'Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

/** The family of one of the game's fonts with the default fonts behind it. */
export function withDefaults(path: string): string {
  const [own] = overlayFontFamily(path).split(",");
  return `${own}, ${DEFAULT_STACK}`;
}

let wanted = "";
/** Puts a font set on the interface once the game's files of it are loaded (the default when they cannot be). */
export async function applyUiFont(id: string) {
  wanted = id;
  const style = document.documentElement.style;
  if (id !== "tf2") { style.removeProperty("--ui-font"); style.removeProperty("--ui-font-head"); return; }
  try { await Promise.all([ensureOverlayFont(TF2_HEAD), ensureOverlayFont(TF2_BODY)]); } catch (error) { console.warn("interface fonts:", error); return; }
  if (wanted !== id) return;
  style.setProperty("--ui-font", withDefaults(TF2_BODY));
  style.setProperty("--ui-font-head", withDefaults(TF2_HEAD));
}

onSettingsChange((s) => void applyUiFont(s.uiFont));
