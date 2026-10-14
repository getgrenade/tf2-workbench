import type { Settings } from "./api";
import { attachNumberDrag } from "./viewer/numberDrag";
import { clearTauntCache, tauntCachePath } from "./api";
import { loadSettings, onSettingsChange, settings as currentSettings, updateSetting, updateSettings } from "./settingsStore";
import { DEFAULT_ACCENT, DEFAULT_BASE, normaliseAccent, normaliseBase } from "./theme";
import { createHotkeysSection } from "./hotkeysUi";
import { createRigSettings } from "./rig/rigSettings";

/** Colours to start from in the interface colour rows (any colour can still be picked). */
const ACCENT_PRESETS = ["#e08a3c", "#e0b03c", "#58b368", "#38b6c4", "#4f8fe8", "#9b6be0", "#e06a9c", "#e0584c"];
const BASE_PRESETS = ["#222226", "#20252c", "#1c2a2a", "#262224", "#161618", "#2e2e34"];

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** The sections of the tab, in the order of its list. */
const ALL_SECTIONS = [
  { id: "general", label: "General" },
  { id: "interface", label: "Interface" },
  { id: "viewport", label: "Viewport" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "rigs", label: "Rigs" },
  { id: "storage", label: "Storage" },
] as const;
/** (the web build keeps nothing on disk: no Storage section) */
const SECTIONS = ALL_SECTIONS.filter((s) => !(__WEB__ && (s.id === "storage" || s.id === "rigs")));
type SectionId = (typeof ALL_SECTIONS)[number]["id"];
const SECTION_KEY = "tf2workbench.settingsSection";

/** One boolean setting shown in the Settings tab. Add an entry here (and a field in settings.rs) for a new toggle. */
interface ToggleDef {
  key: BoolKey;
  section: SectionId;
  label: string;
  description: string;
  /** The setting is only read when the app starts, so changing it asks for a restart. */
  needsRestart: boolean;
}

const TOGGLES: ToggleDef[] = [
  { key: "restoreLastScene", section: "general", label: "Restore the last scene at start", description: "Opens the viewer with the characters, loadouts, camera and lights you left it with. Off: always start with a single Soldier.", needsRestart: false },
  { key: "confirmCloseScene", section: "general", label: "Ask before closing a scene", description: "The x on a scene tab asks first, so a scene is not closed by mistake. The prompt can turn this off too.", needsRestart: false },
  { key: "allowOverlappingCosmetics", section: "general", label: "Allow overlapping cosmetics", description: "Equipping a cosmetic replaces the ones in the same equip region, as in the game. On: keep them all and wear several hats at once.", needsRestart: false },
  { key: "autoWeaponAnimation", section: "general", label: "Switch animation when picking a weapon", description: "Picking a weapon plays its idle pose (stand_primary, stand_secondary, ...) so the character holds it properly. Off: keep the animation that is selected.", needsRestart: false },
  { key: "playHitReactions", section: "general", label: "Play mode hit reactions", description: "Explosions gib other characters; bullet hits turn them into ragdolls. Off restores affected characters. Characters reset when a new Play session starts.", needsRestart: false },
  { key: "matchHlmvColors", section: "interface", label: "Match hlmv.exe colours", description: "Turns off the web view's colour management so saturated colours reach the screen unconverted, as hlmv.exe draws them. Removes the orange cast on pure reds on wide-gamut displays; the interface gets a little more saturated.", needsRestart: true },
  { key: "cameraSmoothing", section: "viewport", label: "Camera smoothing", description: "Eases camera movement and navigation-axis transitions. Off: immediate movement.", needsRestart: false },
  { key: "restoreViewportOnCameraExit", section: "viewport", label: "Return to the viewport when leaving a camera", description: "Leaving a camera's view puts the viewport back where it was before you entered it (position, rotation, field of view).", needsRestart: false },
  { key: "screenshotTransparent", section: "viewport", label: "Transparent screenshots", description: "Leaves the background and the ground plane out of screenshots of the free view (the ground shadow keeps its soft edge). A shot through a camera follows that camera's Capture background setting.", needsRestart: false },
];

/** Builds the Settings tab into `root`: a list of sections on the left and the rows of the chosen one beside it. Settings are stored as they change. */
export async function createSettingsUi(root: HTMLElement) {
  let settings = await loadSettings();
  /** Values the running app was started with, to know when a restart is pending. */
  const started = { ...settings };

  root.innerHTML = `<div class="settingsPage"><div class="settingsNav" role="navigation" aria-label="Settings sections"></div><div class="settingsPane"></div></div>`;
  const nav = root.querySelector<HTMLElement>(".settingsNav")!;
  const pane = root.querySelector<HTMLElement>(".settingsPane")!;
  const note = document.createElement("div");
  note.className = "settingsNote dim";
  note.setAttribute("role", "status");
  nav.after(note);

  const restartPending = () => TOGGLES.some((t) => t.needsRestart && settings[t.key] !== started[t.key]);
  const refreshNote = () => { note.textContent = restartPending() ? "Close the app and open it again to apply the changed settings." : ""; };
  const failed = (error: unknown) => { note.textContent = `Could not save the settings: ${String(error)}`; };

  /** A row: the name and a line of explanation on the left, the control on the right. */
  function row(label: string, description: string, control: HTMLElement, restart = false): HTMLElement {
    const el = document.createElement("label");
    el.className = "setRow";
    const text = document.createElement("span");
    text.className = "setText";
    const title = document.createElement("b");
    title.textContent = label + (restart ? " (needs restart)" : "");
    const desc = document.createElement("span");
    desc.className = "dim";
    desc.textContent = description;
    text.append(title, desc);
    el.append(text, control);
    return el;
  }
  const group = (title: string, ...rows: HTMLElement[]) => {
    const box = document.createElement("div");
    box.className = "setGroup";
    if (title) {
      const h = document.createElement("h3");
      h.textContent = title;
      box.append(h);
    }
    const card = document.createElement("div");
    card.className = "setCard";
    card.append(...rows);
    box.append(card);
    return box;
  };

  function toggleRow(t: ToggleDef): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = settings[t.key];
    box.onchange = async () => {
      settings = { ...settings, [t.key]: box.checked };
      try { await updateSetting(t.key, box.checked); } catch (e) { failed(e); return; }
      refreshNote();
    };
    return row(t.label, t.description, box, t.needsRestart);
  }
  const toggles = (section: SectionId) => TOGGLES.filter((t) => t.section === section).map(toggleRow);

  function scrollRow(): HTMLElement {
    const input = document.createElement("input");
    input.type = "number"; input.className = "settingNumber";
    input.min = "0.1"; input.max = "10"; input.step = "0.1";
    input.value = String(settings.scrollStrength);
    input.setAttribute("aria-label", "Scroll strength");
    input.onchange = async () => {
      if (!Number.isFinite(input.valueAsNumber)) { input.value = String(settings.scrollStrength); return; }
      const value = Math.max(.1, Math.min(10, input.valueAsNumber)); input.value = String(value);
      try { await updateSetting("scrollStrength", value); settings = { ...settings, scrollStrength: value }; } catch (error) { failed(error); }
    };
    const el = row("Scroll strength", "Mouse-wheel zoom speed (0.1–10); 1 is the original speed. Applies to free view and camera navigation.", input);
    el.classList.add("scrubRow");
    attachNumberDrag(input, .02, { start() {}, change: value => { input.value = String(+Math.max(.1, Math.min(10, value)).toFixed(1)); }, end() { input.dispatchEvent(new Event("change")); } });
    return el;
  }

  function scaleRow(): HTMLElement {
    const select = document.createElement("select");
    select.add(new Option("Auto (fits the screen)", "0"));
    for (const n of [70, 80, 90, 100, 110, 125, 150]) select.add(new Option(`${n}%`, String(n / 100)));
    select.value = String(settings.uiScale);
    select.onchange = async () => {
      settings = { ...settings, uiScale: Number(select.value) };
      try { await updateSetting("uiScale", Number(select.value)); } catch (e) { failed(e); }
    };
    return row("Interface size", "The size of the whole interface. The layout is made for a 1440p screen: Auto draws it at 80% on a 1080p one.", select);
  }

  function screenshotRow(): HTMLElement {
    const select = document.createElement("select");
    for (const n of [1, 2, 4]) select.add(new Option(`${n}×`, String(n)));
    select.value = String(settings.screenshotScale);
    select.onchange = async () => {
      settings = { ...settings, screenshotScale: Number(select.value) };
      try { await updateSetting("screenshotScale", Number(select.value)); } catch (e) { failed(e); }
    };
    return row("Screenshot size", "Relative to the size of the 3D view (very large sizes are capped by the graphics card).", select);
  }

  function cacheGroup(): HTMLElement {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear taunt cache";
    const status = document.createElement("span");
    status.className = "dim";
    status.setAttribute("role", "status");
    const el = row("Taunt disk cache", "Compiled Workshop taunts unused for 30 days are removed when the app starts. Clearing the cache keeps your source ZIPs and scenes; taunts are recompiled when needed.", clear);
    // a label would turn a click anywhere on the row into a click on the button
    const plain = document.createElement("div");
    plain.className = el.className;
    plain.append(...el.childNodes);
    const pathLabel = document.createElement("span");
    pathLabel.className = "dim tauntCachePath";
    pathLabel.textContent = "Loading cache path…";
    plain.querySelector(".setText")!.append(pathLabel, status);
    void tauntCachePath().then((path) => { pathLabel.textContent = path; pathLabel.title = path; }).catch((error) => { pathLabel.textContent = "Cache path unavailable"; pathLabel.title = String(error); });
    clear.onclick = async () => {
      clear.disabled = true;
      status.textContent = "Clearing taunt cache…";
      try {
        const result = await clearTauntCache();
        status.textContent = `Removed ${result.removed} cached entries (${(result.bytes / 1048576).toFixed(1)} MiB).` +
          (result.deferred ? ` ${result.deferred} entries used this session will be removed on the next app start.` : "");
      } catch (error) { status.textContent = `Could not clear taunt cache: ${String(error)}`; }
      finally { clear.disabled = false; }
    };
    return group("", plain);
  }

  const builders: Record<SectionId, () => HTMLElement[]> = {
    general: () => [group("", ...toggles("general"))],
    interface: () => [...(__WEB__ ? [] : [group("Size", scaleRow())]), createThemeSection(), group("Display", ...toggles("interface"))],
    viewport: () => [group("Navigation", ...toggles("viewport").slice(0, 2), scrollRow()), group("Screenshots", screenshotRow(), ...toggles("viewport").slice(2))],
    hotkeys: () => [createHotkeysSection()],
    rigs: () => (__WEB__ ? [] : [createRigSettings()]),
    storage: () => [cacheGroup()],
  };

  let active: SectionId = "general";
  try { const saved = localStorage.getItem(SECTION_KEY) as SectionId | null; if (SECTIONS.some((s) => s.id === saved)) active = saved!; } catch { /* no storage: the first section */ }
  const buttons = new Map<SectionId, HTMLButtonElement>();
  /** A section is built the first time it is shown and kept (the ones with colours or keys follow the settings on their own). */
  const built = new Map<SectionId, HTMLElement[]>();
  function show(id: SectionId) {
    active = id;
    try { localStorage.setItem(SECTION_KEY, id); } catch { /* not kept */ }
    for (const [key, b] of buttons) { b.classList.toggle("on", key === id); b.setAttribute("aria-current", key === id ? "page" : "false"); }
    if (!built.has(id)) built.set(id, builders[id]());
    pane.replaceChildren(...built.get(id)!);
  }
  for (const s of SECTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.label;
    b.onclick = () => show(s.id);
    buttons.set(s.id, b);
    nav.append(b);
  }
  show(active);
  refreshNote();
}

/** The interface colours: the highlight and the base tone, each a row of presets and a colour picker. They apply as they change. */
function createThemeSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "setGroup";
  section.innerHTML = `<h3>Colours <button data-action="reset" title="Back to the default colours">Reset</button></h3>
<div class="themeBox setCard"></div>`;
  const box = section.querySelector<HTMLElement>(".themeBox")!;
  const syncers: (() => void)[] = [];
  const addRow = (key: "uiAccent" | "uiBase", label: string, hint: string, presets: string[], fix: (hex: string) => string) => {
    const row = document.createElement("div");
    row.className = "themeRow";
    row.title = hint;
    const name = document.createElement("span");
    name.textContent = label;
    const swatches = document.createElement("div");
    swatches.className = "themeSwatches";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.setAttribute("aria-label", `${label} colour`);
    const set = (hex: string) => { void updateSetting(key, fix(hex)); };
    const dots = presets.map((p) => {
      const b = document.createElement("button");
      b.className = "themeSwatch";
      b.style.background = p;
      b.title = p;
      b.setAttribute("aria-label", `${label}: ${p}`);
      b.onclick = () => set(p);
      swatches.append(b);
      return { b, hex: fix(p) };
    });
    picker.oninput = () => set(picker.value);
    const sync = () => {
      const value = currentSettings()[key];
      picker.value = value;
      for (const d of dots) d.b.classList.toggle("on", d.hex.toLowerCase() === value.toLowerCase());
    };
    row.append(name, swatches, picker);
    box.append(row);
    syncers.push(sync);
  };
  addRow("uiAccent", "Highlight", "The colour of what is active or selected: tabs, lit buttons, checkmarks, the outline round the selection", ACCENT_PRESETS, normaliseAccent);
  addRow("uiBase", "Base", "The tone of the panels and everything on them; the other surfaces and the text are mixed from it", BASE_PRESETS, normaliseBase);
  const syncAll = () => syncers.forEach((f) => f());
  section.querySelector<HTMLButtonElement>('[data-action="reset"]')!.onclick = () => { void updateSettings({ uiBase: DEFAULT_BASE, uiAccent: DEFAULT_ACCENT }); };
  onSettingsChange(syncAll);
  syncAll();
  return section;
}
