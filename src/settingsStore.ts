import { getSettings, setSettings, type Settings } from "./api";
import { setHotkeyOverrides } from "./hotkeys";

/** The values used until the stored settings have loaded (and when they cannot be read). Keep in sync with settings.rs. */
export const DEFAULTS: Settings = {
  matchHlmvColors: true,
  autoWeaponAnimation: true,
  cameraSmoothing: true,
  restoreViewportOnCameraExit: false,
  playHitReactions:true,
  scrollStrength: 1,
  restoreLastScene: true,
  confirmCloseScene: true,
  allowOverlappingCosmetics: false,
  uiBase: "#222226",
  uiScale: 0,
  uiAccent: "#e08a3c",
  wireColor: "#b7d2be",
  wireOpacity: 0.1,
  gridColor: "#5fab60",
  gridOpacity: 0.46,
  flashColor: "#4ef320",
  selectionOpacity: 0.85,
  screenshotScale: 2,
  screenshotTransparent: true,
  hotkeys: {},
};

let current: Settings = { ...DEFAULTS };
let loaded: Promise<Settings> | null = null;
const listeners: ((s: Settings) => void)[] = [];

/** Calls `fn` whenever a setting changes (and returns how to stop). */
export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.push(fn);
  return () => listeners.splice(listeners.indexOf(fn), 1);
}

/** Loads the stored settings once; later calls return the same promise. */
export function loadSettings(): Promise<Settings> {
  loaded ??= getSettings()
    .then((s) => { current = { ...DEFAULTS, ...s }; setHotkeyOverrides(current.hotkeys); return current; })
    .catch(() => current);
  return loaded;
}

/** The current settings, synchronously (the defaults until `loadSettings` has resolved). */
export const settings = (): Settings => current;

/** Changes one setting and stores them all. */
export async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await loadSettings();
  const next = { ...current, [key]: value };
  await setSettings(next);
  current = next;
  setHotkeyOverrides(current.hotkeys);
  for (const fn of listeners) fn(current);
}

/** Changes several settings at once, with one write. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await loadSettings();
  const next = { ...current, ...patch };
  await setSettings(next);
  current = next;
  setHotkeyOverrides(current.hotkeys);
  for (const fn of listeners) fn(current);
}
