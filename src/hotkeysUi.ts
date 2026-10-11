import {
  HOTKEYS, HOTKEY_GROUPS, bindingOfKey, conflictsOf, displayBinding, formatBinding, hotkeyDef, hotkeyOverrides, isModifierCode, validFor,
  binding as bindingOf, type HotkeyDef, type HotkeyId,
} from "./hotkeys";
import { onSettingsChange, settings, updateSettings } from "./settingsStore";

/**
 * The Hotkeys section of the Settings tab: a grid of cards, each with the name of an action and its binding. A click on a card waits for
 * the new key (or, for a mouse action, the button); Esc gives up, Backspace or Delete leaves the action without one, and the arrow on a
 * changed card puts the default back. A key that another action had is taken from it.
 */
export function createHotkeysSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "hotkeys";
  section.innerHTML = `<div class="hkTop"><span class="dim hkNote">Click a binding, then press the new key. Esc cancels; Backspace or Delete clears it.</span><button type="button" data-action="reset" title="Put every key and button back to its default">Reset all</button></div><div class="hkBody"></div><div class="hkStatus dim" role="status" aria-live="polite"></div>`;
  const body = section.querySelector<HTMLElement>(".hkBody")!;
  const status = section.querySelector<HTMLElement>(".hkStatus")!;
  const cards = new Map<string, { card: HTMLElement; value: HTMLElement; reset: HTMLButtonElement }>();
  let listening: string | null = null;

  const note = (text: string) => { status.textContent = text; };

  async function save(changes: Record<string, string>) {
    const next = { ...hotkeyOverrides() };
    for (const [id, value] of Object.entries(changes)) {
      if (value === hotkeyDef(id as HotkeyId).default) delete next[id];
      else next[id] = value;
    }
    try { await updateSettings({ hotkeys: next }); } catch (error) { note(`Could not save the settings: ${String(error)}`); }
  }

  /** Gives `id` the binding `text` ("" for none), taking it from the action that had it. */
  async function assign(id: HotkeyId, text: string) {
    const changes: Record<string, string> = { [id]: text };
    const taken = text ? conflictsOf(id, text) : [];
    for (const other of taken) changes[other] = "";
    await save(changes);
    note(taken.length ? `${displayBinding(text)} was ${taken.map((t) => hotkeyDef(t).label).join(", ")}'s: it has no key now.` : "");
  }

  function stopListening() {
    if (!listening) return;
    cards.get(listening)?.card.classList.remove("listening");
    listening = null;
    refresh();
  }

  function listen(def: HotkeyDef) {
    stopListening();
    listening = def.id;
    const entry = cards.get(def.id)!;
    entry.card.classList.add("listening");
    entry.value.textContent = def.kind === "mouse" ? "Press a button…" : "Press a key…";
    note("");
    const done = () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("contextmenu", onMenu, true);
      if (listening === def.id) stopListening();
    };
    const take = (text: string) => {
      done();
      if (!validFor(def, text)) { note(def.kind === "tool" ? "A tool takes a key alone: Shift and Alt with it are the by-mouse edit and the reset." : "That cannot be used for this."); return; }
      void assign(def.id as HotkeyId, text);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || isModifierCode(e.code)) return; // the modifier keys are held while the key comes
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) { done(); return; }
      if ((e.code === "Backspace" || e.code === "Delete") && !e.ctrlKey && !e.altKey && !e.shiftKey && def.id !== "outliner.delete") { done(); void assign(def.id as HotkeyId, ""); return; }
      if (def.kind === "mouse") { note("This one is a mouse button: press one."); return; }
      take(formatBinding(bindingOfKey(e)));
    };
    const onPointer = (e: PointerEvent) => {
      if (entry.card.contains(e.target as Node) && def.kind !== "mouse") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (def.kind !== "mouse") { done(); return; } // a click elsewhere gives up
      if (e.button > 2) { note("Use the left, middle or right button."); return; }
      take(`Mouse${e.button}`);
    };
    const onMenu = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("contextmenu", onMenu, true);
  }

  for (const group of HOTKEY_GROUPS) {
    const defs = HOTKEYS.filter((h) => h.group === group);
    const head = document.createElement("div");
    head.className = "hkGroup";
    head.textContent = group;
    const grid = document.createElement("div");
    grid.className = "hkGrid";
    for (const def of defs as readonly HotkeyDef[]) {
      const card = document.createElement("div");
      card.className = "hkCard";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.title = def.hint;
      const name = document.createElement("span");
      name.className = "hkName";
      name.textContent = def.label;
      const value = document.createElement("span");
      value.className = "hkValue";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "hkReset";
      reset.textContent = "↺";
      reset.title = "Back to the default";
      reset.setAttribute("aria-label", `${def.label}: back to the default`);
      reset.onclick = (e) => { e.stopPropagation(); stopListening(); void assign(def.id as HotkeyId, def.default); };
      card.onclick = () => (listening === def.id ? stopListening() : listen(def));
      card.onkeydown = (e) => { if (listening === null && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); listen(def); } };
      card.append(name, value, reset);
      grid.append(card);
      cards.set(def.id, { card, value, reset });
    }
    body.append(head, grid);
  }

  function refresh() {
    const changed = hotkeyOverrides();
    for (const def of HOTKEYS as readonly HotkeyDef[]) {
      const entry = cards.get(def.id)!;
      if (listening === def.id) continue;
      const text = bindingOf(def.id);
      entry.value.textContent = displayBinding(text);
      entry.value.classList.toggle("none", !text);
      entry.card.classList.toggle("changed", def.id in changed);
      entry.reset.hidden = !(def.id in changed);
    }
  }

  section.querySelector<HTMLButtonElement>('[data-action="reset"]')!.onclick = () => { stopListening(); void updateSettings({ hotkeys: {} }).then(() => note("Every key and button is back to its default.")); };
  onSettingsChange(refresh);
  settings(); // (the store loads on its own; the first refresh comes with the first change or the section being shown)
  refresh();
  return section;
}
