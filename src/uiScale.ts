import { onSettingsChange, settings } from "./settingsStore";

/** The screen the interface is laid out for: 2560×1440 at a scale of 1. */
const REFERENCE = { width: 2560, height: 1440 };
/** Automatic scaling never goes below this (smaller text would not be readable) nor above 1 (the system's own display scaling covers big screens). */
const AUTO_MIN = 0.8;

let applied = 1;
/** The web view may be at another scale than 1 when the page starts (it keeps its scale while the app runs): the first time it is set whatever it is. */
let first = true;

/** The scale that fits the screen: the interface keeps its proportions on a 1080p screen by being drawn at 80 %. */
export function autoScale(): number {
  // (the screen's size does not change with the web view's scale)
  const width = window.screen.width, height = window.screen.height;
  const fit = Math.min(width / REFERENCE.width, height / REFERENCE.height);
  return Math.round(Math.min(1, Math.max(AUTO_MIN, fit)) * 100) / 100;
}

/** The scale in use for a setting value (0 is automatic). */
export const scaleFor = (value: number): number => (value > 0 ? Math.min(2, Math.max(0.5, value)) : autoScale());

async function apply(value: number): Promise<void> {
  const scale = scaleFor(value);
  if (!first && Math.abs(scale - applied) < 0.005) return;
  first = false;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  try { await getCurrentWebview().setZoom(scale); applied = scale; } catch (error) { console.error("UI scale", error); }
}

/** The screen the window is on: its size and its pixel ratio without the web view's scale. */
const screenKey = () => `${window.screen.width}x${window.screen.height}@${(window.devicePixelRatio / applied).toFixed(2)}`;

/** Scales the interface as the settings say now and whenever the setting changes or the window is dragged to another screen. */
export function startUiScale(): void {
  let seen = "";
  const run = async () => { await apply(settings().uiScale); seen = screenKey(); };
  void run();
  onSettingsChange(() => { void run(); });
  // (no event says that the window changed screens: the screen's size is looked at)
  const check = () => { if (screenKey() !== seen) void run(); };
  window.addEventListener("resize", check);
  window.setInterval(check, 1000);
}
