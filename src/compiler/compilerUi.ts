import type { MaterialData, ModelData } from "../viewer/payload";
import { BODYGROUPS, EQUIP_REGIONS, PREFABS, TRIANGLE_BUDGET, CompilerSession, blankMaterial, type CompilerMaterial, type SessionIo } from "./session";
import { ENVMAPS, LIGHTWARPS, type MaterialSettings } from "./vmt";
import type { ItemBuildRequest } from "../api";
import { makeBuildRequest } from "./request";
import { accordify } from "../accordion";
import { showContextMenu } from "../viewer/contextMenu";
import { parseImportSession } from "./importSession";
import { defaultJiggle, type JiggleSetup } from "./jiggleBones";
import { aimTurn, turnMatrix, type BoneTurn } from "./boneAxes";
import type { PreviewBone } from "./preview";
import { createProxyEditor } from "./proxyUi";
import * as THREE from "three";

/** What the viewer is asked to show of the item: a cosmetic for the selected character and the materials it refers to. */
export interface PreviewApplication {
  /** What the item is called and the class it is shown for: the viewer lists it as a temporary item while the Compiler tab is closed. */
  name: string;
  cls: string;
  data: ModelData;
  materials: Map<string, MaterialData>;
  /** The body groups of the class the item hides (name -> 1), like the ones a cosmetic's schema entry names. */
  bodygroups: Record<string, number>;
}

/** What the compiler needs of the viewer it sits in. */
export interface CompilerHost {
  root: HTMLElement;
  /** The panel that slides out over the 3D view beside the left panel: the item's materials. */
  flyout: HTMLElement;
  io: SessionIo;
  /** The selected character: its class folder name ("sniper", "demo"), team and loaded model. */
  selection(): { cls: string; team: number; lod: number; model: ModelData | null } | null;
  /** The classes of the game, in the order of the viewer's class buttons, with the icon of each when it has been loaded. */
  classes(): { id: string; label: string; icon: string }[];
  /** Changes the selected character's class (the item then shows that class's model). */
  selectClass(cls: string): void;
  /** Puts the selected character on a team (0 RED, 1 BLU): the item shows that skin. */
  setTeam(team: number): void;
  /** Shows the selected character, and the item, at a level of detail. */
  setLod(lod: number): void;
  /** Asks for an importer session file (the open dialog, starting in the importer's folder) and returns its text; null when none is chosen. */
  openSession(): Promise<string | null>;
  /** Draws the axes, length and constraints of a bone of the item on the character (null: nothing). */
  setBoneHelper(helper: { bone: string; setup: JiggleSetup | null } | null): void;
  /**
   * A rotation gizmo on a bone of the item that turns the bone's own axes: `turn` is the bone's turn when a drag begins, `onTurn` gets the
   * whole turn (degrees) while it is dragged and `onEnd` says the drag is over. Null takes it away.
   */
  setBoneGizmo(gizmo: { bone: string; turn: () => BoneTurn; onTurn: (turn: BoneTurn) => void; onEnd: () => void } | null): void;
  /** Opens the item alone in a scene of its own, framed square for its backpack icon. */
  openIconStudio(): void;
  setPreview(preview: PreviewApplication | null): void;
  /** The open dialog for a source file; the chosen path, or null. */
  pick(kind: "fbx" | "tga", current: string): Promise<string | null>;
  /** Builds the item on the native side and returns what to tell the artist (and the archive's path, to show it). */
  build(request: ItemBuildRequest): Promise<{ ok: boolean; message: string; path?: string }>;
  reveal?(path: string): void;
}

const STORAGE_KEY = "tf2workbench.compiler";

/** What the Smart fill switch does, for its tooltip: the naming the compiler looks for. */
const SMART_FILL_RULES = [
  "Picking a file fills the rest from the names of the files beside it:",
  "• Model LOD 0 (hat.fbx): the LODs are hat_lod1.fbx and hat_lod2.fbx (or lod0, lod1, lod2 in the names).",
  "• A model named for a class (sniper_hat.fbx; also scout, soldier, demo or demoman, medic, heavy, pyro, spy, engineer or engie): the other classes' models with the same name (heavy_hat.fbx, spy_hat.fbx...) and their LODs.",
  "• Diffuse texture (hat_diffuse.tga): the normal (hat_normal.tga) and the exponent (hat_expmask.tga).",
  "• A model in a folder named mesh with a folder named texture (or textures) beside it: each material's diffuse texture is the .tga in it named after the material.",
  "Files you picked by hand are never replaced. Switch it off to fill everything yourself.",
].join("\n");

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string; title?: string } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) if (c) el.append(c);
  return el;
}

function appendAll(parent: ParentNode, ...children: Child[]) { for (const c of children) if (c) parent.append(c); }

export function createCompilerUi(host: CompilerHost) {
  const session = new CompilerSession(host.io);
  let active = false;
  let loaded = false;
  let timer = 0;
  let poll = 0;
  let building = false;
  let status = "";
  let builtPath = "";
  /** An archive of this name exists and the artist was told; the next Build replaces it. */
  let customBones: string[] = [];
  /** The item's own bones from the last preview (the bones of the model the class does not have), and the one being set up. */
  let itemBones: PreviewBone[] = [];
  let selectedBone = "";
  /** Whether the selected bone has its rotation gizmo in the view: off until asked, so dragging the view cannot turn a bone by mistake. */
  let turnWithGizmo = false;
  /** What the materials panel shows: the materials, or the jiggle bones (one at a time: neither needs the other). Remembered. */
  type FlyoutTab = "materials" | "bones";
  let flyoutTab: FlyoutTab = "materials";
  try { if (localStorage.getItem("tf2workbench.compilerFlyoutTab") === "bones") flyoutTab = "bones"; } catch { /* the materials */ }
  /** A jiggle setup copied from a bone, to paste onto others. */
  let copiedJiggle: JiggleSetup | null = null;
  const root = host.root;
  const flyout = host.flyout;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) session.restore(JSON.parse(saved), host.selection()?.cls);
  } catch { /* a first run, or storage is not available */ }

  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session.toJSON())); } catch { /* the session just is not remembered */ } };

  // --- the pieces ---------------------------------------------------------------------------------------------------

  /** A file row: a label, the path, and buttons to browse for another and to clear it. */
  function fileRow(label: string, path: string, kind: "fbx" | "tga", set: (path: string) => void, note = "", problem = "", compact = false) {
    const input = h("input", { className: "text", type: "text", value: path, placeholder: kind === "fbx" ? "model (.fbx)" : "texture (.tga)", spellcheck: false });
    input.onchange = () => set(input.value.trim());
    const browse = h("button", { textContent: "…", title: `Choose a .${kind} file` });
    browse.onclick = async () => { const chosen = await host.pick(kind, path); if (chosen) set(chosen); };
    const clear = h("button", { textContent: "×", title: "Remove", disabled: !path });
    clear.onclick = () => set("");
    return h("div", { className: "cmpRow" },
      h("label", { textContent: label }), h("div", { className: "row2" }, input, browse, compact ? null : clear),
      note ? h("div", { className: "dim hint" + (problem ? " err" : ""), textContent: note }) : null);
  }

  function checkbox(label: string, checked: boolean, change: (on: boolean) => void, title = "") {
    const input = h("input", { type: "checkbox", checked });
    input.onchange = () => change(input.checked);
    return h("label", { className: "cmpCheck", title }, input, ` ${label}`);
  }

  /**
   * A slider with a box to type the number in (which may go past the slider's end), and the mouse wheel over it moves it (Shift: ten steps).
   * Changes are not redrawn through `render`: that would rebuild the slider under the pointer in the middle of a drag.
   */
  function slider(label: string, value: number, min: number, max: number, step: number, change: (v: number) => void) {
    const decimals = (String(step).split(".")[1] ?? "").length;
    const range = h("input", { className: "ui-range", type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
    const box = h("input", { className: "ui-num", type: "number", min: String(min), step: String(step), value: value.toFixed(decimals) });
    range.oninput = () => { box.value = Number(range.value).toFixed(decimals); change(Number(range.value)); };
    box.onfocus = () => box.select();
    box.onchange = () => {
      const typed = Number(box.value);
      const v = Number.isFinite(typed) ? Math.max(min, typed) : Number(range.value);
      box.value = v.toFixed(decimals); range.value = String(v);
      change(v);
    };
    const controls = h("div", { className: "ui-val" }, range, box);
    // a notch of a wheel (100) is a step; a touchpad sends many small ones, which add up to steps
    let carried = 0;
    controls.addEventListener("wheel", (event) => {
      event.preventDefault();
      carried += event.deltaY * (event.deltaMode === 1 ? 33 : 1);
      const notches = Math.trunc(carried / 100);
      if (notches === 0) return;
      carried -= notches * 100;
      const next = Number(range.value) - notches * step * (event.shiftKey ? 10 : 1);
      const v = Number(Math.min(max, Math.max(min, next)).toFixed(decimals));
      range.value = String(v); box.value = v.toFixed(decimals);
      change(v);
    }, { passive: false });
    return h("div", { className: "ui-prop" }, h("span", { className: "ui-key", textContent: label }), controls);
  }

  /** A control that only matters while its switch is on stays in its place, dimmed, so the two materials line up row by row. */
  function gate<T extends HTMLElement>(on: boolean, el: T): T { el.classList.toggle("off", !on); return el; }

  /** A colour picker for a 0-255 colour. */
  function colorInput(value: readonly number[], change: (v: [number, number, number]) => void, title = "") {
    const hex = "#" + value.map((c) => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, "0")).join("");
    const input = h("input", { className: "cmpPicker", type: "color", value: hex, title });
    input.onchange = () => change([1, 3, 5].map((k) => parseInt(input.value.slice(k, k + 2), 16)) as [number, number, number]);
    return input;
  }

  function colorRow(label: string, value: readonly number[], change: (v: [number, number, number]) => void) {
    return h("label", { className: "cmpNum" }, h("span", { textContent: label }), colorInput(value, change));
  }

  function select<T extends string>(label: string, value: T, options: { value: T; label: string }[], change: (v: T) => void) {
    const el = h("select", {});
    for (const o of options) el.append(h("option", { value: o.value, textContent: o.label, selected: o.value === value }));
    el.onchange = () => change(el.value as T);
    return h("label", { className: "cmpNum" }, h("span", { textContent: label }), el);
  }

  const foldedParts = new Set<string>();
  /** A part of a material's panel that folds. */
  function fold(title: string, key: string, body: HTMLElement) {
    // (kept while the app runs, for every material alike; the settings are open every time the app starts)
    let closed = foldedParts.has(key);
    const head = h("button", { type: "button", className: "cmpFoldHead" + (closed ? " closed" : ""), textContent: title });
    head.setAttribute("aria-expanded", String(!closed));
    body.hidden = closed;
    head.onclick = () => {
      closed = !closed;
      head.classList.toggle("closed", closed);
      head.setAttribute("aria-expanded", String(!closed));
      body.hidden = closed;
      if (closed) foldedParts.add(key); else foldedParts.delete(key);
    };
    return h("div", { className: "cmpFold" }, head, body);
  }

  function materialSettings(m: CompilerMaterial) {
    const s = m.settings;
    const team = session.data.teamColors;
    const set = (patch: Partial<MaterialSettings>) => { Object.assign(m.settings, patch); changed(false); };
    /** For the sliders: the setting changes, the preview follows, the pane is not rebuilt. */
    const live = (patch: Partial<MaterialSettings>) => { Object.assign(m.settings, patch); quiet(); };
    const settings = h("div", { className: "cmpSettingsBody" });
    appendAll(settings,
      select("Light ramp", s.lightwarp, LIGHTWARPS.map((w) => ({ value: w.path, label: w.name })), (v) => set({ lightwarp: v })),
      slider("Phong exponent", s.phongExponent, 0, 150, 1, (v) => live({ phongExponent: v })),
      slider("Phong boost", s.phongBoost, 0, 10, 0.05, (v) => live({ phongBoost: v })),
      checkbox("Rim light", s.rimLight, (v) => set({ rimLight: v })),
      slider("Rim exponent", s.rimExponent, 0, 20, 1, (v) => live({ rimExponent: v })),
      slider("Rim boost", s.rimBoost, 0, 10, 0.1, (v) => live({ rimBoost: v })),
      checkbox("Rim mask", s.rimMask, (v) => set({ rimMask: v })),
      checkbox("Half-lambert", s.halfLambert, (v) => set({ halfLambert: v })),
      checkbox("Phong mask in the diffuse texture's alpha", s.baseAlphaPhongMask, (v) => set({ baseAlphaPhongMask: v })),
      // the colour of the item before it is painted sits beside the switch (RED, and BLU for a team-coloured item)
      h("div", { className: "cmpCheckRow" },
        checkbox("Paintable", s.paintable, (v) => set({ paintable: v }), "The item takes paint (Team Spirit and the others) where the diffuse texture's alpha allows"),
        gate(s.paintable, colorInput(s.colorTintBase, (v) => set({ colorTintBase: v }), team ? "Colour before paint, RED" : "Colour before paint")),
        team ? gate(s.paintable, colorInput((m.blueTint ?? s).colorTintBase, (v) => { m.blueTint = { colorTintBase: v, selfIllumTint: (m.blueTint ?? s).selfIllumTint }; changed(false); }, "Colour before paint, BLU")) : null),
      gate(s.paintable, slider("Paint blend", s.blendTintColorOverBase, 0, 1, 0.01, (v) => live({ blendTintColorOverBase: Math.min(1, v) }))),
      checkbox("Translucent", s.translucent, (v) => set({ translucent: v })),
      gate(s.translucent, checkbox("Alpha test", s.alphaTest, (v) => set({ alphaTest: v }))),
      checkbox("Additive", s.additive, (v) => set({ additive: v })),
      checkbox("Self-illumination", s.selfIllum, (v) => set({ selfIllum: v })),
      gate(s.selfIllum, colorRow(team ? "Glow colour RED" : "Glow colour", s.selfIllumTint, (v) => set({ selfIllumTint: v }))),
      team ? gate(s.selfIllum, colorRow("Glow colour BLU", (m.blueTint ?? s).selfIllumTint, (v) => { m.blueTint = { colorTintBase: (m.blueTint ?? s).colorTintBase, selfIllumTint: v }; changed(false); })) : null,
      select("Reflection", s.envmap, ENVMAPS.map((e) => ({ value: e.path, label: e.name })), (v) => set({ envmap: v })),
      gate(!!s.envmap, select("Reflection mask", s.envmapMask, [
        { value: "", label: "none" }, { value: "$basealphaenvmapmask", label: "diffuse alpha" }, { value: "$normalmapalphaenvmapmask", label: "normal map alpha" },
      ], (v) => set({ envmapMask: v }))),
      gate(!!s.envmap, colorRow("Reflection tint", s.envmapTint, (v) => set({ envmapTint: v }))),
    );
    // the proxies the artist adds (a pulsing glow, a scrolling texture): kept with the material, run by the preview, written into the VMT
    const proxies = createProxyEditor({
      proxies: () => m.settings.customProxies ?? [],
      commit: (next, rebuild) => { m.settings.customProxies = next; if (rebuild) changed(false); else quiet(); },
      selfIllum: () => m.settings.selfIllum,
    });
    const count = m.settings.customProxies?.length ?? 0;
    return h("div", { className: "cmpSettings" }, fold("Settings", "settings", settings), fold(count ? `Proxies (${count})` : "Proxies", "proxies", proxies));
  }

  // --- the jiggle bones -------------------------------------------------------------------------------------------------

  const mat = (bone: PreviewBone) => new THREE.Matrix4().fromArray(bone.world);
  const depthOf = (bone: PreviewBone) => { let d = 0; for (let p = bone.parent; p && d < 32; d++) { const up = itemBones.find((b) => b.name === p); if (!up) break; p = up.parent; } return d; };
  const childOf = (bone: PreviewBone) => itemBones.find((b) => b.parent === bone.name);
  /** The length a new setup starts with: the distance to the bone's first child, else a short one. */
  const autoLength = (bone: PreviewBone) => {
    const child = childOf(bone);
    if (!child) return 10;
    const d = new THREE.Vector3().setFromMatrixPosition(mat(child)).distanceTo(new THREE.Vector3().setFromMatrixPosition(mat(bone)));
    return Math.max(1, Math.round(d * 10) / 10);
  };

  /** The bones the model brings, to give them spring physics and the axes it needs; a selected bone shows its axes and constraints on the character. */
  function bonesSection(): HTMLElement[] {
    if (!itemBones.length) {
      return [h("div", { className: "dim hint", textContent: "The bones of the model that the class does not have (a tail, a tassel, a cloth strip) appear here, to give them spring physics." })];
    }
    const list = h("div", { className: "cmpBoneList" });
    for (const bone of itemBones) {
      const row = h("div", { className: "cmpBone" + (bone.name === selectedBone ? " on" : ""), title: bone.parent ? `Child of ${bone.parent}` : "" });
      row.style.paddingLeft = `${6 + depthOf(bone) * 14}px`;
      const toggle = checkbox("", !!session.data.jiggles[bone.name], (on) => {
        if (on) session.data.jiggles[bone.name] = defaultJiggle(autoLength(bone)); else delete session.data.jiggles[bone.name];
        selectedBone = bone.name;
        changed(false);
      }, "Spring physics on this bone");
      const name = h("span", { className: "cmpBoneName", textContent: bone.name });
      row.onclick = (event) => { if ((event.target as HTMLElement).closest("input, label")) return; selectedBone = bone.name; render(); void updatePreview(); };
      row.oncontextmenu = (event) => {
        event.preventDefault();
        selectedBone = bone.name;
        const mine = session.data.jiggles[bone.name];
        const entries: { label: string; run: () => void }[] = [];
        if (mine) entries.push({ label: "Copy jiggle", run: () => { copiedJiggle = structuredClone(mine); } });
        if (copiedJiggle) entries.push({ label: "Paste jiggle", run: () => pasteJiggle([bone]) });
        const others = itemBones.filter((b) => b.name !== bone.name && session.data.jiggles[b.name]);
        if (mine && others.length) entries.push({ label: `Copy to the other ${others.length} jiggle bone${others.length === 1 ? "" : "s"}`, run: () => { copiedJiggle = structuredClone(mine); pasteJiggle(others); } });
        if (mine) entries.push({ label: "Remove jiggle", run: () => { delete session.data.jiggles[bone.name]; changed(false); } });
        if (!entries.length) entries.push({ label: "Tick the bone to give it jiggle", run: () => { session.data.jiggles[bone.name] = defaultJiggle(autoLength(bone)); changed(false); } });
        render();
        showContextMenu(event.clientX, event.clientY, entries);
      };
      row.append(toggle, name, session.data.turns[bone.name] ? h("span", { className: "cmpChip", textContent: "axes", title: "Its axes are turned" }) : "");
      list.append(row);
    }
    const out: HTMLElement[] = [list];
    const bone = itemBones.find((b) => b.name === selectedBone);
    if (bone) out.push(boneEditor(bone));
    return out;
  }

  /** Puts the copied jiggle on bones: all of it but the length, which belongs to the bone (a bone that has none yet gets the length of its own span). */
  function pasteJiggle(bones: PreviewBone[]) {
    const source = copiedJiggle;
    if (!source) return;
    for (const bone of bones) {
      const length = session.data.jiggles[bone.name]?.length ?? autoLength(bone);
      session.data.jiggles[bone.name] = { ...structuredClone(source), length };
    }
    changed(false);
  }

  /** Everything about one bone: its axes, then its spring. */
  function boneEditor(bone: PreviewBone): HTMLElement {
    const box = h("div", { className: "cmpBoneEditor" });
    const quietly = () => quiet();
    // the axes: turned with the gizmo on the bone in the view
    const current = session.data.turns[bone.name];
    const child = childOf(bone);
    const aim = h("button", { textContent: "Aim Z at the child", disabled: !child, title: child ? "Turn the axes so Z points along the bone to its child" : "The bone has no child to aim at" });
    aim.onclick = () => {
      if (!child) return;
      // the turn is of the bone's own axes as the file has them: start from the model's bone, not the one already turned
      const original = mat(bone);
      const t = session.data.turns[bone.name];
      if (t) original.multiply(turnMatrix(t).invert());
      const aimed = aimTurn(original, new THREE.Vector3().setFromMatrixPosition(mat(child)));
      if (aimed.every((x) => x === 0)) delete session.data.turns[bone.name]; else session.data.turns[bone.name] = aimed;
      changed(false);
    };
    const gizmo = h("button", { textContent: turnWithGizmo ? "Done turning" : "Rotate axes", className: turnWithGizmo ? "on" : "", title: "Show a rotation gizmo on the bone in the view; its rings turn the bone's own axes" });
    gizmo.onclick = () => { turnWithGizmo = !turnWithGizmo; render(); };
    const reset = h("button", { textContent: "Reset axes", disabled: !current });
    reset.onclick = () => { delete session.data.turns[bone.name]; changed(false); };
    box.append(
      h("h4", {}, `${bone.name}: axes`),
      h("div", { className: "dim hint", textContent: "Z points along the bone, yaw swings it around Y, pitch around X. Press Rotate axes, then drag the rings on the bone in the view to turn its axes (the bone stays where it is) so they lie the way the numbers below mean them." }),
      h("div", { className: "row2" }, gizmo, aim, reset),
      current ? h("div", { className: "dim hint", textContent: `Turned ${current.map((v) => `${v}°`).join(", ")} about X, Y, Z` }) : "",
    );
    // the spring
    const setup = session.data.jiggles[bone.name];
    if (!setup) {
      box.append(h("div", { className: "dim hint", textContent: "Tick the box in the list to give this bone spring physics." }));
      return box;
    }
    const num = (label: string, value: number, min: number, max: number, step: number, set: (s: JiggleSetup, v: number) => void) => slider(label, value, min, max, step, (v) => { set(setup, v); quietly(); });
    const mode = select("Kind", setup.mode, [{ value: "flexible" as const, label: "Flexible (springs)" }, { value: "rigid" as const, label: "Rigid (constraints only)" }], (v) => { setup.mode = v; changed(false); });
    const flexible = setup.mode === "flexible";
    const constraint = (label: string, c: JiggleSetup["yaw"]) => [
      checkbox(label, c.on, (on) => { c.on = on; changed(false); }),
      gate(c.on, num("Min", c.min, -180, 180, 1, (_s, v) => { c.min = v; })),
      gate(c.on, num("Max", c.max, -180, 180, 1, (_s, v) => { c.max = v; })),
      gate(c.on, num("Friction", c.friction, 0, 10, 0.05, (_s, v) => { c.friction = v; })),
      gate(c.on, num("Bounce", c.bounce, 0, 1, 0.01, (_s, v) => { c.bounce = v; })),
    ];
    const axis = (label: string, a: JiggleSetup["baseSpring"]["left"]) => [
      num(`${label} min`, a.min, -50, 50, 0.5, (_s, v) => { a.min = v; }),
      num(`${label} max`, a.max, -50, 50, 0.5, (_s, v) => { a.max = v; }),
      num(`${label} friction`, a.friction, 0, 10, 0.05, (_s, v) => { a.friction = v; }),
    ];
    const base = setup.baseSpring, boing = setup.boing;
    appendAll(box,
      h("h4", {}, "Spring"),
      mode,
      num("Length", setup.length, 0, 200, 0.5, (s, v) => { s.length = v; }),
      num("Tip mass", setup.tipMass, 0, 300, 1, (s, v) => { s.tipMass = v; }),
      flexible ? num("Yaw stiffness", setup.yawStiffness, 0, 1000, 1, (s, v) => { s.yawStiffness = v; }) : null,
      flexible ? num("Yaw damping", setup.yawDamping, 0, 10, 0.5, (s, v) => { s.yawDamping = v; }) : null,
      flexible ? num("Pitch stiffness", setup.pitchStiffness, 0, 1000, 1, (s, v) => { s.pitchStiffness = v; }) : null,
      flexible ? num("Pitch damping", setup.pitchDamping, 0, 10, 0.5, (s, v) => { s.pitchDamping = v; }) : null,
      flexible ? checkbox("Allow length flex", setup.allowLengthFlex, (on) => { setup.allowLengthFlex = on; changed(false); }, "The tip may stretch along the bone, with a spring of its own") : null,
      flexible ? gate(setup.allowLengthFlex, num("Along stiffness", setup.alongStiffness, 0, 1000, 1, (s, v) => { s.alongStiffness = v; })) : null,
      flexible ? gate(setup.allowLengthFlex, num("Along damping", setup.alongDamping, 0, 10, 0.5, (s, v) => { s.alongDamping = v; })) : null,
      h("h4", {}, "Constraints"),
      ...constraint("Yaw constraint", setup.yaw),
      ...constraint("Pitch constraint", setup.pitch),
      checkbox("Angle constraint", setup.angle.on, (on) => { setup.angle.on = on; changed(false); }, "The tip stays inside a cone around Z"),
      gate(setup.angle.on, num("Limit", setup.angle.limit, 0, 180, 1, (s, v) => { s.angle.limit = v; })),
      h("h4", {}, "Base spring"),
      checkbox("Has base spring", base.on, (on) => { base.on = on; changed(false); }, "The bone itself springs in its parent's space"),
      gate(base.on, num("Mass", base.mass, 0, 100, 0.5, (_s, v) => { base.mass = v; })),
      gate(base.on, num("Stiffness", base.stiffness, 0, 1000, 1, (_s, v) => { base.stiffness = v; })),
      gate(base.on, num("Damping", base.damping, 0, 10, 0.5, (_s, v) => { base.damping = v; })),
      ...[axis("Left", base.left), axis("Up", base.up), axis("Forward", base.forward)].flat().map((el) => gate(base.on, el)),
      h("h4", {}, "Boing"),
      checkbox("Is boing", boing.on, (on) => { boing.on = on; changed(false); }, "Squash and stretch when the bone is jolted"),
      gate(boing.on, num("Impact speed", boing.impactSpeed, 0, 500, 1, (_s, v) => { boing.impactSpeed = v; })),
      gate(boing.on, num("Impact angle", boing.impactAngle, 0, 180, 1, (_s, v) => { boing.impactAngle = v; })),
      gate(boing.on, num("Damping rate", boing.dampingRate, 0, 2, 0.01, (_s, v) => { boing.dampingRate = v; })),
      gate(boing.on, num("Frequency", boing.frequency, 0, 100, 0.5, (_s, v) => { boing.frequency = v; })),
      gate(boing.on, num("Amplitude", boing.amplitude, 0, 2, 0.01, (_s, v) => { boing.amplitude = v; })),
    );
    return box;
  }

  // --- the pane ------------------------------------------------------------------------------------------------------

  /** Rebuilds the pane. `restructure` is false for changes (a number typed) that must not move the field the artist is in. */
  function render() {
    const d = session.data;
    const sel = host.selection();
    const issues = session.issues(customBones);
    const issue = (key: string) => issues.find((i) => i.key === key || i.key.startsWith(key + ":"));
    const note = (key: string) => issue(key)?.text ?? "";

    const name = h("input", { className: "text", type: "text", value: d.name, placeholder: "item name (a_cowboyhat)", spellcheck: false });
    name.onchange = () => { d.name = name.value; changed(true); };
    const prefab = h("select", {});
    for (const p of PREFABS) prefab.append(h("option", { value: p, textContent: p === "hat" ? "Hat" : "Misc", selected: d.prefab === p }));
    prefab.onchange = () => { d.prefab = prefab.value as typeof d.prefab; changed(false); };
    const region = h("select", {});
    for (const r of EQUIP_REGIONS) region.append(h("option", { value: r, textContent: r.replace(/_/g, " "), selected: d.region === r }));
    region.onchange = () => { d.region = region.value; changed(false); };
    const teamSwitch = checkbox("Team colours", d.teamColors, (on) => { session.setTeamColors(on); changed(true); }, "A RED and a BLU skin: each material gets a BLU diffuse texture and its own tints; the other textures are shared");
    const smartFill = checkbox("Smart fill", d.smartFill, (on) => { d.smartFill = on; changed(false); }, SMART_FILL_RULES);
    const bodygroups = h("div", { className: "chips" });
    for (const b of BODYGROUPS) {
      const chip = h("span", { className: "chip" + (d.bodygroups.includes(b) ? " active" : ""), textContent: b.replace(/_/g, " "), title: `Hides the ${b.replace(/_/g, " ")} of the class` });
      chip.onclick = () => { d.bodygroups = d.bodygroups.includes(b) ? d.bodygroups.filter((x) => x !== b) : [...d.bodygroups, b]; changed(false); };
      bodygroups.append(chip);
    }

    // the class being edited is the selected character's: its models are the ones the rows below hold
    const cls = sel?.cls ?? session.primaryClass() ?? "sniper";
    const files = session.lods(cls);
    const lods = [0, 1, 2].map((i) => {
      const model = session.model(cls, i);
      const budget = TRIANGLE_BUDGET[i];
      const info = model
        ? `${model.triangles} triangles of ${budget}, ${model.vertices} vertices, ${model.materials.length} material${model.materials.length === 1 ? "" : "s"}`
        : files[i] ? "" : i === 0 ? (session.isMulticlass() || !session.classesWithModels().length ? "required" : `optional: leave empty for a ${cls} without the item`) : "optional";
      const key = `lod${i}:${cls}`;
      const bad = !!note(key) || session.failures.has(files[i]);
      return fileRow(`LOD ${i}`, files[i], "fbx", (p) => void session.setLod(cls, i, p).then(() => changed(true)), note(key) || (session.failures.get(files[i]) ?? info), bad ? "x" : "", true);
    });
    const lodGrid = h("div", { className: "cmpLods" }, ...lods);

    // what the preview shows: the team (the item's skin) and the level of detail, next to the model they affect
    const segment = (labels: string[], current: number, pick: (i: number) => void, classes: string[] = []) => h("div", { className: "cmpSeg" }, ...labels.map((label, i) => {
      const b = h("button", { textContent: label, className: (classes[i] ?? "") + (current === i ? " on" : ""), disabled: !sel });
      b.onclick = () => pick(i);
      return b;
    }));
    const viewRow = h("div", { className: "cmpView" },
      h("span", { className: "dim", textContent: "Show on" }), segment(["RED", "BLU"], sel?.team ?? 0, (t) => host.setTeam(t), ["red", "blu"]),
      h("span", { className: "dim", textContent: "LOD" }), segment(["0", "1", "2"], Math.min(sel?.lod ?? 0, 2), (i) => host.setLod(i)));
    const withModels = new Set(session.classesWithModels());
    const picker = h("div", { className: "cmpClasses" });
    for (const c of host.classes()) {
      const b = h("button", { className: "classBtn" + (c.id === cls ? " on" : "") + (withModels.has(c.id) ? " has" : ""), title: withModels.has(c.id) ? `${c.label}: has a model` : c.label });
      if (c.icon) b.append(h("img", { src: c.icon, draggable: false })); else b.textContent = c.id.slice(0, 3);
      if (withModels.has(c.id)) b.append(h("span", { className: "cmpDot" }));
      b.onclick = () => host.selectClass(c.id);
      picker.append(b);
    }
    const classHint = session.isMulticlass()
      ? `All-class item: ${session.classesWithModels().length} classes, each with its own model (${session.itemName}_<class>) and the same textures.`
      : withModels.size ? "Add a model for another class to make this an all-class item." : "";

    /** The BLU diffuse texture of a team-coloured material; empty means BLU uses the RED one. */
    const blueRow = (n: string, m: CompilerMaterial) => {
      const problem = issues.find((i) => i.key === `material:${n}:blueColor`)?.text;
      const info = problem ?? session.failures.get(m.blueColor) ?? "";
      return fileRow("Diffuse BLU", m.blueColor, "tga", (p) => void session.setBlueColor(n, p).then(() => changed(true)), info, problem || session.failures.has(m.blueColor) ? "x" : "");
    };
    const names = session.materialNames();
    const materials = names.length
      ? names.map((n, index) => {
        const m = (d.materials[n] ??= blankMaterial());
        const row = (label: string, kind: "color" | "normal" | "phongexponent" | "illum") => {
          const problem = issues.find((i) => i.key === `material:${n}:${kind}`)?.text;
          const info = problem ?? session.failures.get(m[kind]) ?? "";
          return fileRow(label, m[kind], "tga", (p) => void session.setTexture(n, kind, p).then(() => changed(true)), info, problem || session.failures.has(m[kind]) ? "x" : "");
        };
        // a row per material: its textures on the left, its settings on the right
        return h("div", { className: "cmpMaterial" },
          h("div", { className: "cmpName", textContent: `${n}${index ? ` (${index + 1})` : ""}`, title: "A material of the model" }),
          h("div", { className: "cmpTextures" },
            row(d.teamColors ? "Diffuse RED" : "Diffuse", "color"),
            d.teamColors ? blueRow(n, m) : null,
            row("Normal", "normal"),
            row("Exponent", "phongexponent"),
            gate(m.settings.selfIllum, row("Glow mask", "illum"))),
          materialSettings(m));
      })
      : [h("div", { className: "dim hint", textContent: "The materials of the model appear here once it is added." })];
    const materialGrid = h("div", { className: "cmpMaterials" }, ...materials);

    const iconNote = issue("icon")?.text ?? session.failures.get(d.icon) ?? (session.icon ? "" : "512x512 with alpha; the picture inside the safe zone");
    const setIcon = (p: string) => void session.setIcon(p).then(() => changed(false));
    const iconBrowse = h("button", { textContent: "…", title: d.icon ? `${d.icon}
Choose another .tga` : "Choose the backpack icon (.tga)" });
    iconBrowse.onclick = async () => { const chosen = await host.pick("tga", d.icon); if (chosen) setIcon(chosen); };
    const iconClear = h("button", { textContent: "×", title: "Remove", disabled: !d.icon });
    iconClear.onclick = () => setIcon("");
    const iconProblem = !!issue("icon") || session.failures.has(d.icon);
    // the icon can be made from the item itself: it is shown alone, framed square, in a scene of its own
    const generate = h("button", { className: "cmpIconGen", textContent: "Generate icon", disabled: !sel?.model || !session.primaryClass(), title: "Open the item alone, framed for its backpack icon, and render it" });
    generate.onclick = () => host.openIconStudio();
    const thumb = h("canvas", { className: "cmpThumb", width: 96, height: 96, title: d.icon });
    if (session.icon) {
      const { image } = session.icon;
      const c = h("canvas", { width: image.width, height: image.height });
      c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
      const g = thumb.getContext("2d");
      g?.drawImage(c, 0, 0, 96, 96);
    }

    const list = h("ul", { className: "cmpIssues" });
    if (issues.length === 0) list.append(h("li", { className: "ok", textContent: "Ready to build." }));
    for (const i of issues) list.append(h("li", { className: i.level, textContent: i.text }));
    const errors = issues.filter((i) => i.level === "error").length;
    const build = h("button", { className: "cmpBuild", textContent: building ? "Building…" : "Build", disabled: building || errors > 0 || !sel, title: errors ? "Fix what is listed first" : "Compile the item into a .zip the game and the workshop tool can use" });
    build.onclick = () => void runBuild();
    const reset = h("button", { textContent: "New", title: "Start a new item" });
    reset.onclick = () => { session.restore(null); status = ""; customBones = []; void afterChange(true); };
    const openSession = h("button", { textContent: "Open", title: "Open an item from its importer session file (import_source/<name>.txt): its models, textures, material settings and icon" });
    openSession.onclick = () => void openFromFile();

    root.replaceChildren(
      h("h3", { className: "first" }, "Item ", openSession, reset),
      name,
      h("div", { className: "cmpTop" },
        h("div", { className: "cmpTopMain" },
          h("label", { className: "cmpNum" }, h("span", { textContent: "Type" }), prefab),
          h("label", { className: "cmpNum" }, h("span", { textContent: "Region" }), region),
          teamSwitch,
          smartFill,
          h("label", { textContent: "Hides" }), bodygroups),
        h("div", { className: "cmpIcon" },
          h("label", { textContent: "Icon" }), thumb,
          h("div", { className: "row2" }, iconBrowse, iconClear),
          generate,
          iconNote ? h("div", { className: "dim hint" + (iconProblem ? " err" : ""), textContent: iconNote }) : null)),
      h("h3", {}, "Model"), picker, viewRow, lodGrid,
      classHint ? h("div", { className: "dim hint", textContent: classHint }) : "",
      sel ? h("div", { className: "dim hint", textContent: `Shown on the selected ${sel.cls}. ${customBones.length ? `Own bones: ${customBones.join(", ")}.` : ""}` }) : h("div", { className: "dim hint", textContent: "Select a character to see the item on it." }),
      h("h3", {}, "Check"), list,
      h("div", { className: "row2" }, build, status ? h("span", { className: "dim hint", textContent: status }) : null,
        builtPath && host.reveal ? (() => { const show = h("button", { textContent: "Show", title: "Show the archive in the folder" }); show.onclick = () => host.reveal?.(builtPath); return show; })() : null),
    );
    // the panel over the 3D view has two menus: the materials and the jiggle bones
    const choose = (tab: FlyoutTab) => {
      flyoutTab = tab;
      try { localStorage.setItem("tf2workbench.compilerFlyoutTab", tab); } catch { /* not remembered */ }
      render();
    };
    const jiggling = Object.keys(session.data.jiggles).length;
    const tabs = h("div", { className: "cmpTabs", role: "tablist" },
      h("button", { textContent: "Materials", className: flyoutTab === "materials" ? "on" : "", onclick: () => choose("materials") }),
      h("button", { textContent: jiggling ? `Jiggle bones (${jiggling})` : "Jiggle bones", className: flyoutTab === "bones" ? "on" : "", onclick: () => choose("bones") }));
    flyout.replaceChildren(tabs, flyoutTab === "materials" ? materialGrid : h("div", { className: "cmpBones" }, ...bonesSection()));
    accordify(root, "compiler");
    // the bone being set up is drawn on the character while its menu is open
    host.setBoneHelper(flyoutTab === "bones" && selectedBone ? { bone: selectedBone, setup: session.data.jiggles[selectedBone] ?? null } : null);
    const bone = selectedBone;
    host.setBoneGizmo(flyoutTab === "bones" && bone && turnWithGizmo ? {
      bone,
      turn: () => session.data.turns[bone] ?? [0, 0, 0],
      onTurn: (turn) => { if (turn.every((v) => v === 0)) delete session.data.turns[bone]; else session.data.turns[bone] = turn; quiet(); },
      onEnd: () => render(),
    } : null);
  }

  /** Loads an item from an importer session file the artist picks: what it names is read from disk like files picked by hand. */
  async function openFromFile() {
    try {
      const text = await host.openSession();
      if (text === null) return;
      session.restore(parseImportSession(text));
      customBones = []; status = ""; builtPath = "";
      await session.loadAll();
      changed(true);
      const first = session.classesWithModels()[0];
      if (first && host.selection()?.cls !== first) host.selectClass(first);
      void updatePreview();
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      render();
    }
  }

  /** Something the artist changed: remember it, show it, and check it. */
  function changed(restructure: boolean) {
    save();
    void restructure;
    schedule();
    render();
  }
  /** A change that needs the preview but not a rebuilt pane (a slider being dragged). */
  function quiet() {
    save();
    schedule();
  }
  async function afterChange(restructure: boolean) { changed(restructure); }

  /** Rebuilds the preview shortly after the last change (typing a number should not rebuild the mesh on each key). */
  function schedule() {
    if (!active) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void updatePreview(), 120);
  }

  async function updatePreview() {
    if (!active) return;
    const sel = host.selection();
    if (!sel?.model) { host.setPreview(null); return; }
    try {
      const preview = await session.preview(sel.model, sel.cls, sel.lod);
      if (!active) return;
      const bones = preview?.customBones ?? [];
      const skeleton = preview?.skeleton ?? [];
      const same = bones.join() === customBones.join() && skeleton.map((b) => b.name).join() === itemBones.map((b) => b.name).join();
      customBones = bones;
      itemBones = skeleton;
      if (selectedBone && !skeleton.some((b) => b.name === selectedBone)) selectedBone = "";
      host.setBoneHelper(flyoutTab === "bones" && selectedBone ? { bone: selectedBone, setup: session.data.jiggles[selectedBone] ?? null } : null);
      host.setPreview(preview ? { name: session.data.name.trim() || session.itemName || "New item", cls: sel.cls, data: preview.data, materials: preview.materials, bodygroups: preview.bodygroups } : null);
      if (!same) render();
    } catch (error) {
      console.error("Item preview failed", error);
      status = String(error);
      render();
    }
  }

  async function runBuild() {
    if (building) return;
    building = true; status = ""; builtPath = "";
    render();
    try {
      const sel = host.selection();
      if (!sel) throw new Error("Select a character first.");
      const result = await host.build(makeBuildRequest(session, sel.cls));
      status = result.message;
      builtPath = result.ok ? result.path ?? "" : "";
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      status = text;
    } finally {
      building = false;
      render();
    }
  }

  async function checkFiles() {
    if (!active) return;
    try { if (await session.refresh()) { changed(false); } } catch (error) { console.error(error); }
  }

  return {
    session,
    /** The Compiler tab was opened. */
    async show() {
      active = true;
      render();
      if (!loaded) { loaded = true; await session.loadAll(); render(); }
      await updatePreview();
      window.clearInterval(poll);
      poll = window.setInterval(() => void checkFiles(), 1500);
    },
    /** The tab was left: the item comes off the character. */
    hide() {
      active = false;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      // the item stays on the character: the viewer lists it as a temporary item
    },
    /** The selected character (or its class, or its team) changed. */
    selectionChanged() { if (active) { render(); schedule(); } },
    /** Brings the preview up to date now (the item is on the selected character when this returns). */
    async updatePreviewNow() { window.clearTimeout(timer); await updatePreview(); },
    render,
  };
}
