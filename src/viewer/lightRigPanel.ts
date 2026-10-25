/**
 * The controller of a three-point light rig of the scene (a folder of a key, a fill and a rim light, made by Add > Light > Three-point):
 * the properties panel shows it when the folder is clicked. The pivot ball and its two angles turn the three together; the brightness of
 * all, each light's and their colours; Flip, Randomize and Reset; whether the rig turns with the view; and the scene's ambient light (the
 * light from everywhere, which is the scene's, not the rig's: the same as the Light tab's). What it sets is written to
 * the three lights by its host (they stay lights of their own, to be edited one by one too).
 */
import { DEFAULT_STUDIO, STUDIO_LABELS, STUDIO_ROLES, flipStudio, randomStudio, type StudioLight } from "./studioLight";
import { createStudioSphere } from "./studioSphere";

/** A rig of the scene: the studio light's settings, and whether its lights turn with the view (as the view's own light does) or stay put. */
export type SceneLightRig = StudioLight & { follow: boolean };

export const DEFAULT_SCENE_RIG: SceneLightRig = { ...structuredClone(DEFAULT_STUDIO), follow: true };

export function createLightRigPanel(host: {
  /** The rig the panel shows (null: none, the panel is empty). */
  get: () => SceneLightRig | null;
  /** A change: `final` once a drag or a typed number ends (the step to undo), not for each step of a slider. */
  set: (rig: SceneLightRig, final: boolean) => void;
  /** The scene's ambient light: its level (0..1) and colour, and a change of them (`final` as for the rig). */
  ambient: { get: () => { level: number; color: string }; set: (level: number, color: string, final: boolean) => void };
}) {
  const el = document.createElement("div");
  el.className = "lightRigPanel";

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  /** A row of the app's: its key, a slider and the number beside it. */
  const sliders = new Map<string, { range: HTMLInputElement; num: HTMLInputElement; digits: number }>();
  const slider = (key: string, label: string, min: number, max: number, step: number, title: string, read: (r: SceneLightRig) => number, write: (r: SceneLightRig, v: number) => void) => {
    const digits = (String(step).split(".")[1] ?? "").length;
    const row = make("div", "ui-prop");
    const name = make("span", "ui-key", label);
    name.title = title;
    const val = make("div", "ui-val");
    const range = make("input", "ui-range");
    range.type = "range";
    range.min = String(min); range.max = String(max); range.step = String(step);
    const num = make("input", "ui-num");
    num.type = "number";
    num.min = String(min); num.max = String(max); num.step = String(step);
    const change = (v: number, final: boolean) => {
      const r = host.get();
      if (!r) return;
      const next = structuredClone(r);
      write(next, v);
      host.set(next, final);
      ball.draw();
    };
    range.oninput = () => { num.value = Number(range.value).toFixed(digits); change(Number(range.value), false); };
    range.onchange = () => change(Number(range.value), true);
    num.onfocus = () => num.select();
    num.onchange = () => {
      const typed = Number(num.value);
      const v = Number.isFinite(typed) ? Math.min(max, Math.max(min, typed)) : Number(range.value);
      num.value = v.toFixed(digits);
      range.value = String(v);
      change(v, true);
    };
    val.append(range, num);
    row.append(name, val);
    sliders.set(key, { range, num, digits });
    reads.set(key, read);
    return row;
  };
  const reads = new Map<string, (r: SceneLightRig) => number>();

  // the heading's tools, as the promo thumbnails' rig has them
  const head = make("h3", "", "Three-point light");
  const tools = make("span");
  const tool = (label: string, title: string, run: (r: SceneLightRig) => SceneLightRig) => {
    const b = make("button", "", label);
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); const r = host.get(); if (r) { host.set(run(r), true); refresh(); } };
    tools.appendChild(b);
  };
  tool("Flip", "Mirror the rig left to right: the key, the fill and the rim each to the other side (the pivot too)", (r) => ({ ...flipStudio(r), follow: r.follow }));
  tool("Randomize", "Another three-point setup: the key on one side and above, the fill on the other and dimmer, the rim behind, in colours that go together", (r) => ({ ...randomStudio(), follow: r.follow }));
  tool("Reset", "The classic rig again: a warm key high on the right, a cool fill low on the left, a rim behind", (r) => ({ ...structuredClone(DEFAULT_STUDIO), follow: r.follow }));
  head.appendChild(tools);

  // the pivot: the ball (drag it: the three together; drag K, F or R: one), its two angles under it
  let dragging = false;
  const ball = createStudioSphere(() => host.get() ?? DEFAULT_SCENE_RIG, (s, final) => {
    const r = host.get();
    if (!r) return;
    dragging = !final;
    host.set({ ...s, follow: r.follow }, final);
    refreshSliders();
  });
  const ballBox = make("div", "lightRigBall");
  const hint = make("p", "hint dim", "Drag the ball: all three lights · drag K, F, R: one light");
  ballBox.append(ball.element, hint);

  const follow = make("label", "inline-check");
  const followBox = make("input");
  followBox.type = "checkbox";
  followBox.onchange = () => { const r = host.get(); if (r) host.set({ ...r, follow: followBox.checked }, true); };
  follow.append(followBox, " Turns with the view");
  follow.title = "On: the rig stays where it is as seen from the view (the key on the right as you look, as the view's own light does) · Off: it stays put in the world, lit from the front of the scene";

  const swatches = make("div", "promoSwatches");
  const colours = STUDIO_ROLES.map((role) => {
    const c = make("input");
    c.type = "color";
    c.title = `The ${STUDIO_LABELS[role].toLowerCase()} light's colour`;
    c.oninput = () => { const r = host.get(); if (r) host.set({ ...r, [role]: { ...r[role], color: c.value } }, false); ball.draw(); };
    c.onchange = () => { const r = host.get(); if (r) host.set(r, true); };
    swatches.appendChild(c);
    return c;
  });
  const colourRow = make("div", "ui-prop");
  const colourKey = make("span", "ui-key", "Key · fill · rim");
  colourKey.title = "The colours of the key, the fill and the rim";
  const colourVal = make("div", "ui-val single");
  colourVal.appendChild(swatches);
  colourRow.append(colourKey, colourVal);

  // the scene's ambient: a slider with its number, and its colour
  const ambientRow = make("div", "ui-prop");
  const ambientKey = make("span", "ui-key", "Ambient");
  ambientKey.title = "The scene's light from everywhere, under the rig (low lets the rig shape the character): the same as the Light tab's Ambient";
  const ambientVal = make("div", "ui-val");
  const ambientRange = make("input", "ui-range");
  ambientRange.type = "range";
  ambientRange.min = "0"; ambientRange.max = "1"; ambientRange.step = "0.01";
  const ambientNum = make("input", "ui-num");
  ambientNum.type = "number";
  ambientNum.min = "0"; ambientNum.max = "1"; ambientNum.step = "0.01";
  const ambientColour = make("input");
  ambientColour.type = "color";
  ambientColour.title = "The ambient light's colour";
  const setAmbient = (level: number, final: boolean) => host.ambient.set(level, ambientColour.value, final);
  ambientRange.oninput = () => { ambientNum.value = Number(ambientRange.value).toFixed(2); setAmbient(Number(ambientRange.value), false); };
  ambientRange.onchange = () => setAmbient(Number(ambientRange.value), true);
  ambientNum.onfocus = () => ambientNum.select();
  ambientNum.onchange = () => {
    const typed = Number(ambientNum.value);
    const v = Number.isFinite(typed) ? Math.min(1, Math.max(0, typed)) : Number(ambientRange.value);
    ambientNum.value = v.toFixed(2);
    ambientRange.value = String(v);
    setAmbient(v, true);
  };
  ambientColour.oninput = () => host.ambient.set(Number(ambientRange.value), ambientColour.value, false);
  ambientColour.onchange = () => host.ambient.set(Number(ambientRange.value), ambientColour.value, true);
  ambientVal.append(ambientRange, ambientNum);
  ambientRow.append(ambientKey, ambientVal);
  const ambientColourRow = make("div", "ui-prop");
  const ambientColourKey = make("span", "ui-key", "Ambient colour");
  const ambientColourVal = make("div", "ui-val single");
  ambientColourVal.appendChild(ambientColour);
  ambientColourRow.append(ambientColourKey, ambientColourVal);

  el.append(
    head,
    ballBox,
    slider("yaw", "Pivot round", -180, 180, 1, "Turns the three lights together round the subject", (r) => r.yaw, (r, v) => (r.yaw = v)),
    slider("pitch", "Pivot over", -80, 80, 1, "Turns the three lights together over the subject", (r) => r.pitch, (r, v) => (r.pitch = v)),
    slider("brightness", "Brightness", 0, 3, 0.01, "All three lights at once", (r) => r.brightness, (r, v) => (r.brightness = v)),
    ...STUDIO_ROLES.map((role) => slider(role, STUDIO_LABELS[role], 0, 4, 0.01, `How bright the ${STUDIO_LABELS[role].toLowerCase()} light is`, (r) => r[role].intensity, (r, v) => (r[role] = { ...r[role], intensity: v }))),
    colourRow,
    ambientRow,
    ambientColourRow,
    follow,
  );

  function refreshSliders() {
    const r = host.get();
    if (!r) return;
    for (const [key, s] of sliders) {
      const v = reads.get(key)!(r);
      s.range.value = String(v);
      if (document.activeElement !== s.num) s.num.value = v.toFixed(s.digits);
    }
  }
  /** Shows the rig as it is now (after an undo, or a change of its lights from elsewhere). */
  function refresh() {
    const r = host.get();
    el.hidden = !r;
    if (!r || dragging) return;
    refreshSliders();
    STUDIO_ROLES.forEach((role, i) => { if (document.activeElement !== colours[i]) colours[i].value = r[role].color; });
    followBox.checked = r.follow;
    const ambient = host.ambient.get();
    ambientRange.value = String(ambient.level);
    if (document.activeElement !== ambientNum) ambientNum.value = ambient.level.toFixed(2);
    if (document.activeElement !== ambientColour) ambientColour.value = ambient.color;
    ball.draw();
  }
  return { el, refresh };
}
