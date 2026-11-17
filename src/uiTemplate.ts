/**
 * Interface templates: a whole look at once. "tf2" dresses the interface as the game's own menus (the ClientScheme.res colours, tan text on
 * dark brown, TF2 Build titles and buttons, TF2 Secondary text), as the Mann-ual does. The look is in style.css under
 * `:root[data-template="tf2"]`; picking a template also sets the font and the two theme colours to go with it.
 */
import type { Settings } from "./api";
import { DEFAULT_ACCENT, DEFAULT_BASE } from "./theme";
import { onSettingsChange } from "./settingsStore";

export const UI_TEMPLATES = [
  { id: "", label: "Default" },
  { id: "tf2", label: "Team Fortress 2" },
] as const;

/** What picking a template changes besides the template itself. */
export function templateSettings(id: string): Partial<Settings> {
  if (id === "tf2") return { uiTemplate: "tf2", uiFont: "tf2", uiBase: "#292526", uiAccent: "#cf6a32" };
  return { uiTemplate: "", uiFont: "", uiBase: DEFAULT_BASE, uiAccent: DEFAULT_ACCENT };
}

const CACHE_KEY = "tf2workbench.template";
export function applyUiTemplate(id: string) {
  const root = document.documentElement;
  if (UI_TEMPLATES.some((t) => t.id === id) && id) root.dataset.template = id; else delete root.dataset.template;
  try { localStorage.setItem(CACHE_KEY, id); } catch { /* not remembered */ }
}

// (put on as the module loads, so the interface does not flash the default look while the stored settings load)
try { applyUiTemplate(localStorage.getItem(CACHE_KEY) ?? ""); } catch { /* the default */ }
onSettingsChange((s) => applyUiTemplate(s.uiTemplate));
