/**
 * The keys and mouse buttons of the app, in one place: what each action is called, its default binding, and a match test for the
 * handlers. A binding is a string like "Shift+KeyW" (a key, by its physical position, so it stays where it is on other layouts, with the
 * modifiers it needs) or "Mouse1" (a mouse button: 0 left, 1 middle, 2 right). The ones a user changed are kept in the settings
 * (`hotkeys`); everything else is the default. This file has no imports so that it can be tested alone.
 */

export type HotkeyGroup = "Tools" | "Selection and view" | "Editing" | "Outliner" | "Mouse navigation";

export interface HotkeyDef {
  id: string;
  label: string;
  group: HotkeyGroup;
  /** A line of explanation (shown as the tooltip of the binding). */
  hint: string;
  /** The default binding; "" is none. */
  default: string;
  /** "tool": a key alone (the same key with Shift or Alt does the by-mouse edit and the reset); "key": any key with modifiers; "mouse": a mouse button. */
  kind: "tool" | "key" | "mouse";
}

export const HOTKEYS = [
  { id: "tool.move", label: "Move gizmo", group: "Tools", hint: "Picks the move tool. With Shift the same key starts a move by mouse alone; with Alt it puts the position back.", default: "KeyW", kind: "tool" },
  { id: "tool.rotate", label: "Rotate gizmo", group: "Tools", hint: "Picks the rotation tool. With Shift the same key starts a turn by mouse alone; with Alt it puts the rotation back.", default: "KeyE", kind: "tool" },
  { id: "tool.scale", label: "Scale gizmo", group: "Tools", hint: "Picks the scale tool. With Shift the same key starts a scaling by mouse alone; with Alt it puts the scale back.", default: "KeyR", kind: "tool" },
  { id: "select.box", label: "Box select", group: "Selection and view", hint: "Drag a box to select several things; pressed again (or Esc) it goes off.", default: "KeyQ", kind: "key" },
  { id: "view.focus", label: "Focus under pointer", group: "Selection and view", hint: "Moves the camera to what the pointer is over.", default: "KeyF", kind: "key" },
  { id: "view.focusAll", label: "Frame everything", group: "Selection and view", hint: "Moves the camera back to show all the characters (with the pointer over the view).", default: "KeyA", kind: "key" },
  { id: "view.fullscreen", label: "Hide the panels", group: "Selection and view", hint: "Hides the header and the docks so the 3D view fills the window; the same key brings them back.", default: "Tab", kind: "key" },
  { id: "play.toggle", label: "Play / pause", group: "Selection and view", hint: "Starts or pauses the animation.", default: "Space", kind: "key" },
  { id: "edit.copy", label: "Copy", group: "Editing", hint: "Copies the selected characters, lights or cameras.", default: "Ctrl+KeyC", kind: "key" },
  { id: "edit.paste", label: "Paste", group: "Editing", hint: "Pastes what was copied.", default: "Ctrl+KeyV", kind: "key" },
  { id: "edit.undo", label: "Undo", group: "Editing", hint: "Takes back the last placement, or the last change of the pose while posing.", default: "Ctrl+KeyZ", kind: "key" },
  { id: "edit.redo", label: "Redo", group: "Editing", hint: "Does it again. The undo key with Shift does it too.", default: "Ctrl+KeyY", kind: "key" },
  { id: "outliner.rename", label: "Rename", group: "Outliner", hint: "Renames the selected row of the outliner.", default: "F2", kind: "key" },
  { id: "outliner.delete", label: "Delete", group: "Outliner", hint: "Removes the selected rows of the outliner.", default: "Delete", kind: "key" },
  { id: "outliner.toggle", label: "Show / hide", group: "Outliner", hint: "Turns the selected rows of the outliner on or off.", default: "Space", kind: "key" },
  { id: "nav.orbit", label: "Orbit", group: "Mouse navigation", hint: "Turns the view about what it looks at. (Ctrl or Shift with the left button pans.)", default: "Mouse0", kind: "mouse" },
  { id: "nav.zoom", label: "Zoom (drag)", group: "Mouse navigation", hint: "Dragging moves the view in and out. The wheel always zooms.", default: "Mouse1", kind: "mouse" },
  { id: "nav.pan", label: "Pan", group: "Mouse navigation", hint: "Slides the view sideways and up and down.", default: "Mouse2", kind: "mouse" },
] as const satisfies readonly HotkeyDef[];

export type HotkeyId = (typeof HOTKEYS)[number]["id"];
export const HOTKEY_GROUPS: HotkeyGroup[] = ["Tools", "Selection and view", "Editing", "Outliner", "Mouse navigation"];

export interface Binding { code: string; ctrl: boolean; alt: boolean; shift: boolean }

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
export const isModifierCode = (code: string) => MODIFIER_CODES.test(code);

/** "Ctrl+Shift+KeyZ" → its parts (null for "" or what is not a binding). */
export function parseBinding(text: string): Binding | null {
  if (!text) return null;
  const parts = text.split("+");
  const code = parts.pop() ?? "";
  if (!code || isModifierCode(code)) return null;
  const mods = new Set(parts);
  for (const m of mods) if (m !== "Ctrl" && m !== "Alt" && m !== "Shift") return null;
  return { code, ctrl: mods.has("Ctrl"), alt: mods.has("Alt"), shift: mods.has("Shift") };
}

export function formatBinding(b: Binding): string {
  return [b.ctrl ? "Ctrl" : "", b.alt ? "Alt" : "", b.shift ? "Shift" : "", b.code].filter(Boolean).join("+");
}

/** The binding a keyboard event is (the modifier keys that are down, and the key). */
export function bindingOfKey(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): Binding {
  return { code: e.code, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey };
}

const NAMES: Record<string, string> = {
  Space: "Space", Escape: "Esc", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Enter: "Enter", NumpadEnter: "Num Enter", Tab: "Tab",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", PageUp: "Page Up", PageDown: "Page Down", Home: "Home", End: "End",
  Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`", BracketLeft: "[", BracketRight: "]",
  NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /", NumpadDecimal: "Num .",
  Mouse0: "LMB", Mouse1: "MMB", Mouse2: "RMB", Mouse3: "Mouse 4", Mouse4: "Mouse 5",
};

/** A code as it is written on the key: KeyW → W, Digit1 → 1, Numpad4 → Num 4. */
export function codeName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const pad = /^Numpad(\d)$/.exec(code);
  if (pad) return `Num ${pad[1]}`;
  return code;
}

/** What is shown for a binding: "Ctrl + Z", "Shift + MMB", or "—" for none. */
export function displayBinding(text: string): string {
  const b = parseBinding(text);
  if (!b) return "—";
  return [b.ctrl ? "Ctrl" : "", b.alt ? "Alt" : "", b.shift ? "Shift" : "", codeName(b.code)].filter(Boolean).join(" + ");
}

export const isMouseBinding = (text: string) => /(^|\+)Mouse\d$/.test(text);

const defs = new Map<string, HotkeyDef>(HOTKEYS.map((h) => [h.id, h]));
export const hotkeyDef = (id: HotkeyId): HotkeyDef => defs.get(id)!;

let overrides: Record<string, string> = {};
let parsed = new Map<string, Binding | null>();

function rebuild() {
  parsed = new Map();
  for (const h of HOTKEYS) parsed.set(h.id, parseBinding(binding(h.id)));
}

/** Sets the bindings the user changed (an id missing from `changed` has its default; an empty string is none). */
export function setHotkeyOverrides(changed: Record<string, string> | undefined) {
  overrides = {};
  for (const [id, value] of Object.entries(changed ?? {})) {
    const def = defs.get(id);
    if (!def || typeof value !== "string") continue;
    if (value === "" || validFor(def, value)) overrides[id] = value;
  }
  rebuild();
}

/** Whether a string is a binding that this action can have. */
export function validFor(def: HotkeyDef, text: string): boolean {
  const b = parseBinding(text);
  if (!b) return false;
  if (def.kind === "mouse") return /^Mouse[0-2]$/.test(b.code) && !b.ctrl && !b.alt && !b.shift && text === b.code;
  if (/^Mouse\d$/.test(b.code)) return false;
  if (def.kind === "tool") return !b.ctrl && !b.alt && !b.shift;
  return true;
}

/** The binding of an action now ("" for none). */
export function binding(id: HotkeyId | string): string {
  return id in overrides ? overrides[id] : (defs.get(id)?.default ?? "");
}

/** The changed bindings, as they are stored. */
export const hotkeyOverrides = (): Record<string, string> => ({ ...overrides });

/** The same set of modifiers, and the key. */
const same = (b: Binding | null | undefined, e: Binding) => !!b && b.code === e.code && b.ctrl === e.ctrl && b.alt === e.alt && b.shift === e.shift;

/** Whether the key event is the key of this action (with just the modifiers the binding has). */
export function hotkeyMatches(id: HotkeyId, e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return same(parsed.get(id), bindingOfKey(e));
}

/** Redo is its own key, or the undo key with Shift. */
export function redoMatches(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  if (hotkeyMatches("edit.redo", e)) return true;
  const undo = parsed.get("edit.undo");
  return !!undo && !undo.shift && same({ ...undo, shift: true }, bindingOfKey(e));
}

/** The gizmo tool whose key this is (the key alone; the callers look at the modifiers). */
export function toolOfCode(code: string): "move" | "rotate" | "scale" | null {
  for (const t of ["move", "rotate", "scale"] as const) if (parsed.get(`tool.${t}`)?.code === code) return t;
  return null;
}

/** The mouse button (0, 1 or 2) an action is on, or -1 when it has none. */
export function mouseButtonOf(id: HotkeyId): number {
  const b = parsed.get(id);
  const m = b && /^Mouse([0-2])$/.exec(b.code);
  return m ? Number(m[1]) : -1;
}

/**
 * The actions that would clash with this binding on `id`: the ones that are on the same key (or button) and can be pressed at the same
 * time. The outliner keys are only read while the outliner has focus, so they clash with each other but not with the viewport's keys;
 * the viewport's keys (and the mouse buttons, among themselves) clash with each other.
 */
export function conflictsOf(id: HotkeyId, text: string): HotkeyId[] {
  const def = hotkeyDef(id);
  const mine = parseBinding(text);
  if (!mine) return [];
  const scope = (d: HotkeyDef) => (d.group === "Outliner" ? "outliner" : d.kind === "mouse" ? "mouse" : "viewport");
  return HOTKEYS.filter((h) => h.id !== id && scope(h) === scope(def) && same(parsed.get(h.id), mine)).map((h) => h.id);
}

rebuild();
