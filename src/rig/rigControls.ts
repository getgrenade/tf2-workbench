import type { Actor } from "../viewer/actor";
import type { Viewer } from "../viewer/viewer";
import { loadRig, onRigsChange, rigEntries, rigFor, type RigEntry } from "./rigLibrary";
import { LIMBS, RigSession, type LimbId } from "./rigSession";

/**
 * A Blender rig in pose mode (desktop): the rig added in Settings for the posing character's class takes the place of the body map in the pose
 * panel (the button in the panel's head switches back to the built-in controls); each limb switches between FK and IK, and the rig's sliders
 * are set here.
 */

const KEY_ON = "tf2workbench.blenderRigOn";

interface Env {
  /** Where the rig's controls go in the pose panel. */
  slot: HTMLElement;
  /** The button in the panel's head: shows the rig's controls in place of the body map, or the other way round. */
  button: HTMLButtonElement;
  /** Shows the rig's controls (true) or the body map and its buttons (false). */
  setMode: (on: boolean) => void;
  viewer: () => Viewer | null;
  actor: () => Actor | null;
  /** The class of the character being posed (`heavy`). */
  cls: () => string;
  /** Called after the rig changed the pose. */
  changed: () => void;
}

export interface RigControls {
  /** Brings the panel and the overlay in line with whether a character is being posed. */
  sync(posing: boolean): void;
  refresh(): void;
}

const css = `
.phRigBtn { margin-left: auto; height: var(--ui-h); padding: 0 var(--ui-3); border-radius: var(--ui-radius); font-size: var(--ui-fs-small); cursor: pointer; border: 1px solid var(--line); background: var(--ui-input); color: var(--fg); }
.phRigBtn:hover { border-color: var(--ui-line-strong); background: var(--ui-hover); }
.phRigBtn.on { border-color: var(--ui-accent-line); background: var(--ui-accent-soft); }
.phRigBtn:disabled { opacity: .45; cursor: default; }
.phRig { max-height: min(62vh, 560px); overflow: auto; padding-top: var(--ui-2); }
.phRig .phRigSeg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ui-2); }
.phRig .phRigSeg > button, .phRig .phRigOne { height: var(--ui-h); padding: 0 var(--ui-2); border-radius: var(--ui-radius); font-size: var(--ui-fs-small); white-space: nowrap; }
.phRig .phRigSeg > button.on, .phRig .phRigOne.on { border-color: var(--ui-accent-line); color: var(--fg); background: var(--ui-accent-soft); }
.phRig .hint { margin: var(--ui-2) 0; }
.phRig .phRigSliders { margin-top: var(--ui-3); padding-top: var(--ui-3); border-top: 1px solid var(--ui-line); }
`;

export function createRigControls(env: Env): RigControls {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const panel = env.slot;
  const button = env.button;

  let session: RigSession | null = null;
  /** The rig entry the session was made for. */
  let sessionFor: RigEntry | null = null;
  let enabled = true;
  let note = "";
  let loading = false;
  let slidersOpen = false;
  try { enabled = localStorage.getItem(KEY_ON) !== "0"; } catch { /* not remembered */ }
  const sessions = new Map<string, RigSession>();
  let posingNow = false;

  /** Reads the rig for the posing character's class (once), then puts it on the character. */
  function ensureRig() {
    const entry = rigFor(env.cls());
    if (!entry) { session = null; sessionFor = null; note = ""; return; }
    if (sessionFor?.id === entry.id && session) return;
    sessionFor = entry;
    const cached = sessions.get(entry.path);
    if (cached) { session = cached; return; }
    session = null;
    loading = true;
    note = "";
    loadRig(entry).then((data) => {
      const made = new RigSession(data);
      sessions.set(entry.path, made);
      if (sessionFor?.id === entry.id) session = made;
    }).catch((e) => {
      if (sessionFor?.id === entry.id) note = String(e);
    }).finally(() => {
      loading = false;
      if (posingNow) { apply(); render(); env.changed(); }
    });
  }

  /** Puts the rig on the posing character (or takes it off), and shows the rig's controls or the body map to match. */
  function apply() {
    const v = env.viewer();
    const actor = env.actor();
    if (!v) return;
    if (!enabled || !session || !actor?.isPosing) {
      v.blenderRig.setActor(null);
      v.rig.setShown(true);
      env.setMode(false);
      return;
    }
    if (v.blenderRig.actor !== actor || v.blenderRig.rigSession !== session) {
      const ok = v.blenderRig.setActor(actor, session);
      if (!ok) { note = "This character's skeleton is not the rig's."; v.rig.setShown(true); env.setMode(false); return; }
    }
    v.rig.setShown(false);
    env.setMode(true);
  }

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  };

  /** A row of the panel: a name and one control. */
  const row = (name: string, control: HTMLElement, title = "") => {
    const r = make("div", "ui-prop");
    const key = make("span", "ui-key", name);
    if (title) key.title = title;
    const val = make("div", "ui-val single");
    val.append(control);
    r.append(key, val);
    return r;
  };

  const showSwitch = (shown: boolean, set: (on: boolean) => void) => {
    const b = make("button", `phRigOne${shown ? " on" : ""}`, shown ? "Shown" : "Hidden");
    b.onclick = () => { set(!shown); render(); };
    return b;
  };

  function render() {
    const have = !!sessionFor;
    button.hidden = !have;
    button.disabled = !session;
    button.className = `phRigBtn${enabled && session ? " on" : ""}`;
    button.title = session ? "Pose with the Blender rig's controls instead of the built-in ones" : loading ? "Reading the rig with Blender… (the first time takes a little while)" : note || "";
    panel.replaceChildren();
    if (note || !session) {
      const n = make("div", "hint", note || (loading ? "Reading the rig with Blender… (the first time takes a little while)" : ""));
      panel.append(n);
    }
    const v = env.viewer();
    if (!session || !enabled || !v?.blenderRig.active) return;
    for (const limb of LIMBS) {
      const seg = make("div", "phRigSeg");
      const fk = make("button", "", "FK");
      const ik = make("button", "", "IK");
      (session.ik(limb.id) ? ik : fk).className = "on";
      fk.onclick = () => { v.blenderRig.setIk(limb.id as LimbId, false); env.changed(); render(); };
      ik.onclick = () => { v.blenderRig.setIk(limb.id as LimbId, true); env.changed(); render(); };
      seg.append(fk, ik);
      panel.append(row(limb.label, seg));
    }
    panel.append(row("Fingers", showSwitch(v.blenderRig.groups.fingers, (on) => v.blenderRig.setFingers(on))));
    panel.append(row("Misc", showSwitch(v.blenderRig.groups.misc, (on) => v.blenderRig.setMisc(on)), "The rig's extra controls (bullet belt, pack...)"));
    const sliders = v.blenderRig.sliders().filter((s) => !/IK\/FK$/.test(s.name));
    if (!sliders.length) return;
    const head = make("button", `phRigOne${slidersOpen ? " on" : ""}`, slidersOpen ? "Hide sliders" : "Sliders");
    head.style.width = "100%";
    head.style.marginTop = "var(--ui-3)";
    head.onclick = () => { slidersOpen = !slidersOpen; render(); };
    panel.append(head);
    if (!slidersOpen) return;
    const list = make("div", "phRigSliders");
    for (const s of sliders) {
      const wrap = make("div", "ui-prop");
      const key = make("span", "ui-key", s.name.toLowerCase().replace(/(^|\s)\w/g, (m) => m.toUpperCase()));
      key.title = s.name;
      const val = make("div", "ui-val");
      const range = make("input", "ui-range");
      range.type = "range";
      range.min = String(s.min); range.max = String(s.max); range.step = String(s.step); range.value = String(s.value);
      const num = make("input", "ui-num");
      num.type = "number";
      num.min = String(s.min); num.max = String(s.max); num.step = String(s.step); num.value = String(s.value);
      const set = (value: number) => { v.blenderRig.setSlider(s.name, value); env.changed(); range.value = num.value = String(value); };
      range.oninput = () => set(Number(range.value));
      num.onchange = () => set(Math.min(s.max, Math.max(s.min, Number(num.value) || 0)));
      val.append(range, num);
      wrap.append(key, val);
      list.append(wrap);
    }
    panel.append(list);
  }

  button.onclick = () => {
    if (!session) return;
    enabled = !enabled;
    try { localStorage.setItem(KEY_ON, enabled ? "1" : "0"); } catch { /* not remembered */ }
    apply();
    env.changed();
    render();
  };

  const controls: RigControls = {
    sync(posing) {
      posingNow = posing;
      const have = posing && rigEntries().length > 0 && !!rigFor(env.cls());
      if (!have) {
        sessionFor = null;
        const v = env.viewer();
        if (v?.blenderRig.actor) v.blenderRig.setActor(null);
        v?.rig.setShown(true);
        env.setMode(false);
        button.hidden = true;
        return;
      }
      ensureRig();
      apply();
      render();
    },
    refresh() { if (posingNow) render(); },
  };
  onRigsChange(() => { sessionFor = null; if (posingNow) controls.sync(true); });
  return controls;
}
