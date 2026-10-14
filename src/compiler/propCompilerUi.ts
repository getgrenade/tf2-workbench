import type { MaterialData, ModelData } from "../viewer/payload";
import type { PropBuildRequest } from "../api";
import { PropSession, PROP_NUM_LODS, PROP_TEXTURE_LIMITS, blankPropMaterial } from "./propSession";
import { PROP_ENVMAPS, type PropMaterialSettings } from "./propVmt";
import type { CollisionMode } from "./collision";
import type { SessionIo } from "./session";
import { endAligned } from "../pathInput";
import { FILE_DROP_EVENT, type FileDropDetail } from "../fileDrop";
import { acceptedPath } from "../filePaths";
import { createProxyEditor } from "./proxyUi";

/** The surface properties offered for a prop (the game's own names; they decide how it sounds and what it makes when hit). */
export const PROP_SURFACES = [
  "default", "wood", "wood_crate", "wood_box", "wood_furniture", "wood_plank", "metal", "metal_box", "metal_barrel", "metalpanel", "solidmetal",
  "metalgrate", "plastic", "plastic_barrel", "plastic_box", "glass", "gravel", "concrete", "brick", "tile", "cardboard", "paper", "rubber", "carpet",
  "dirt", "grass", "sand", "water", "flesh", "foliage", "ceiling_tile", "computer", "ice", "snow",
];

export interface PropCompilerHost {
  io: SessionIo;
  /** The open dialog for a source file; the chosen path, or null. */
  pick(kind: "fbx" | "tga" | "smd", current: string): Promise<string | null>;
  /** The open dialog for a folder. */
  pickFolder(current: string): Promise<string | null>;
  /** Shows the prop in the scene (null takes it away). */
  setPreview(preview: { data: ModelData; materials: Map<string, MaterialData> } | null): void;
  build(request: PropBuildRequest): Promise<{ ok: boolean; message: string; path?: string }>;
  reveal?(path: string): void;
  /** The text of a prop session file: the one at the path, or (no path) one chosen in the open dialog; null when none is. */
  openSession(path?: string): Promise<string | null>;
}

const STORAGE_KEY = "tf2workbench.propCompiler";

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string; title?: string } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** The Prop side of the compiler: what a prop is made of, the checks, and the button that writes it to a folder. */
export function createPropCompilerUi(host: PropCompilerHost) {
  const session = new PropSession(host.io);
  const element = h("div", { className: "cmpProp" });
  /** The panel that slides out over the view beside the left panel, as the cosmetic side's: the materials. */
  const flyoutEl = h("div", { className: "cmpPropFlyout" });
  let active = false;
  let loaded = false;
  let building = false;
  let status = "";
  let builtPath = "";
  let timer = 0;
  let poll = 0;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) session.restore(JSON.parse(saved));
  } catch { /* a first run, or storage is not available */ }
  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session.toJSON())); } catch { /* not remembered */ } };

  /** A change: remembered, the preview follows shortly (typing a number should not rebuild the mesh on each key), the panel is redrawn when `redraw`. */
  function changed(redraw: boolean) {
    save();
    status = ""; // what the last build said is about what was there then
    if (redraw) render();
    schedule();
  }
  session.onChange = () => { save(); if (active) render(); schedule(); };

  function schedule() {
    if (!active) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => host.setPreview(session.preview()), 150);
  }

  function fileRow(label: string, path: string, kind: "fbx" | "tga" | "smd", set: (path: string) => void, problem = "") {
    const input = h("input", { className: "text", type: "text", value: path, placeholder: kind === "tga" ? "texture (.tga)" : kind === "smd" ? "collision model (.smd)" : "model (.fbx, .smd, .dmx)", spellcheck: false });
    input.onchange = () => set(input.value.trim());
    endAligned(input);
    const browse = h("button", { textContent: "…", title: `Choose a file` });
    browse.onclick = async () => { const chosen = await host.pick(kind, path); if (chosen) set(chosen); };
    const clear = h("button", { textContent: "×", title: "Remove", disabled: !path });
    clear.onclick = () => set("");
    const row = h("div", { className: "cmpRow" }, h("label", { textContent: label }), h("div", { className: "row2" }, input, browse, clear), problem ? h("div", { className: "dim hint err", textContent: problem }) : null);
    // a file dragged from the file explorer onto the row
    row.dataset.fileDrop = kind;
    row.addEventListener(FILE_DROP_EVENT, (e) => { const dropped = acceptedPath(kind, (e as CustomEvent<FileDropDetail>).detail.paths); if (dropped) set(dropped); });
    return row;
  }

  function check(label: string, on: boolean, change: (on: boolean) => void, title = "") {
    const input = h("input", { type: "checkbox", checked: on });
    input.onchange = () => change(input.checked);
    return h("label", { className: "cmpCheck", title }, input, ` ${label}`);
  }

  function pick<T extends string>(label: string, value: T, options: { value: T; label: string }[], change: (v: T) => void, title = "") {
    const el = h("select", {});
    for (const o of options) el.append(h("option", { value: o.value, textContent: o.label, selected: o.value === value }));
    el.onchange = () => change(el.value as T);
    return h("label", { className: "cmpNum", title }, h("span", { textContent: label }), el);
  }

  function number(label: string, value: number, min: number, max: number, step: number, change: (v: number) => void, title = "") {
    const input = h("input", { className: "ui-num", type: "number", min: String(min), max: String(max), step: String(step), value: String(value) });
    input.onchange = () => { const v = Number(input.value); if (Number.isFinite(v)) change(Math.min(max, Math.max(min, v))); };
    return h("label", { className: "cmpNum", title }, h("span", { textContent: label }), input);
  }

  /** The proxies the artist adds to a material (a pulsing glow, a flicker): the same editor as the cosmetic side's, run by the preview and written into the VMT. */
  function proxySection(m: ReturnType<typeof blankPropMaterial>) {
    const body = createProxyEditor({
      proxies: () => m.settings.customProxies,
      commit: (next, rebuild) => { m.settings.customProxies = next; changed(rebuild); },
      selfIllum: () => m.settings.selfIllum,
    });
    const count = m.settings.customProxies.length;
    return h("details", { className: "cmpPropProxies", open: count > 0 }, h("summary", { textContent: count ? `Proxies (${count})` : "Proxies" }), body);
  }

  /** Material lines written by hand: what the panel has no switch for (`$detail`, the variables a proxy writes to). */
  function extraSection(m: ReturnType<typeof blankPropMaterial>, problem: string) {
    const box = h("textarea", { className: "text cmpExtra", value: m.settings.extra, rows: 4, spellcheck: false, placeholder: '"$detail"  "models/props/noise"\n"$detailblendmode"  "8"\n"$translate"  "[0 0]"' });
    box.oninput = () => { m.settings.extra = box.value; changed(false); };
    box.onchange = () => changed(true);
    const lines = m.settings.extra.split(/\r?\n/).filter((l) => l.trim()).length;
    const title = 'Lines of the material written as they are in a VMT: "$detail" "path", the variables a proxy writes to. A key the panel writes too is replaced by yours; a Proxies block joins the proxies above';
    return h("details", { className: "cmpPropProxies", open: lines > 0 }, h("summary", { textContent: lines ? `Extra lines (${lines})` : "Extra lines", title }), box, problem ? h("div", { className: "cmpNote error", textContent: problem }) : null);
  }

  function material(name: string, issues: ReturnType<PropSession["issues"]>) {
    const d = session.data;
    const m = (d.materials[name] ??= blankPropMaterial());
    const set = (patch: Partial<PropMaterialSettings>) => { Object.assign(m.settings, patch); changed(true); };
    const problem = (key: string) => issues.find((i) => i.key === `${key}:${name}`)?.text ?? "";
    return h("div", { className: "cmpMaterial" },
      h("h4", { textContent: `${name}  →  ${session.stem(name)}` }),
      fileRow("Colour", m.color, "tga", (p) => void session.setTexture(name, "color", p), problem("color") || problem("texture")),
      fileRow("Normal", m.normal, "tga", (p) => void session.setTexture(name, "normal", p)),
      fileRow("Phong exponent", m.phongexponent, "tga", (p) => void session.setTexture(name, "phongexponent", p)),
      m.settings.selfIllum ? fileRow("Glow mask", m.illum, "tga", (p) => void session.setTexture(name, "illum", p)) : null,
      h("div", { className: "cmpChecks" },
        check("Phong", m.settings.phong, (on) => set({ phong: on, rimLight: on ? m.settings.rimLight : false }), "A shiny highlight; the exponent and boost are below"),
        check("Rim light", m.settings.rimLight, (on) => set({ rimLight: on, phong: on ? true : m.settings.phong }), "A glow along the edges that face away from the viewer (needs phong, which it switches on)"),
        check("Translucent", m.settings.translucent, (on) => set({ translucent: on, alphaTest: on ? false : m.settings.alphaTest }), "Blends by the alpha of the colour texture"),
        check("Alpha test", m.settings.alphaTest, (on) => set({ alphaTest: on, translucent: on ? false : m.settings.translucent }), "Cuts out by the alpha of the colour texture (leaves, grates, fences)"),
        check("Two-sided", m.settings.twoSided, (on) => set({ twoSided: on }), "Draws the back of the faces too ($nocull)"),
        check("Glow", m.settings.selfIllum, (on) => set({ selfIllum: on }), "The base alpha (or the glow mask) is lit regardless of the light")),
      m.settings.phong ? h("div", { className: "cmpChecks" }, number("Exponent", m.settings.phongExponent, 1, 150, 1, (v) => set({ phongExponent: v }), "Higher: a tighter highlight (ignored when there is a phong exponent texture)"), number("Boost", m.settings.phongBoost, 0, 10, 0.1, (v) => set({ phongBoost: v }))) : null,
      m.settings.rimLight ? h("div", { className: "cmpChecks" }, number("Rim exponent", m.settings.rimExponent, 1, 20, 0.5, (v) => set({ rimExponent: v }), "Higher: a thinner rim"), number("Rim boost", m.settings.rimBoost, 0, 10, 0.1, (v) => set({ rimBoost: v }))) : null,
      pick("Reflection", m.settings.envmap, PROP_ENVMAPS.map((e) => ({ value: e.path, label: e.name })), (v) => set({ envmap: v })),
      proxySection(m),
      extraSection(m, problem("extra")));
  }

  function render() {
    const d = session.data;
    const issues = session.issues();
    const note = (key: string) => issues.find((i) => i.key === key || i.key.startsWith(key + ":"))?.text ?? "";
    const names = session.materialNames();
    const name = h("input", { className: "text", type: "text", value: d.name, placeholder: "prop name (crate_wood_a)", spellcheck: false });
    name.onchange = () => { d.name = name.value.trim(); changed(true); };
    const folder = h("input", { className: "text", type: "text", value: d.folder, placeholder: "folder below models/ (props_custom)", spellcheck: false });
    folder.onchange = () => { d.folder = folder.value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); changed(true); };
    const open = h("button", { textContent: "Open", title: "Open a prop from the file the compiler wrote beside it (<name>.prop.txt), or drop that file here" });
    open.onclick = () => void openSession();
    const reset = h("button", { textContent: "New", title: "Start a new prop" });
    reset.onclick = () => { session.restore(null); status = ""; builtPath = ""; host.setPreview(null); changed(true); };

    const outRow = h("div", { className: "cmpRow" }, h("label", { textContent: "Write to" }), h("div", { className: "row2" },
      (() => { const input = h("input", { className: "text", type: "text", value: d.outDir, placeholder: "a folder, e.g. tf/custom/my_props", spellcheck: false }); input.onchange = () => { d.outDir = input.value.trim(); changed(true); }; endAligned(input); return input; })(),
      (() => { const b = h("button", { textContent: "…", title: "Choose the folder" }); b.onclick = async () => { const chosen = await host.pickFolder(d.outDir); if (chosen) { d.outDir = chosen; changed(true); } }; return b; })()));

    // a folder dragged from the file explorer onto the output row
    outRow.dataset.fileDrop = "folder";
    outRow.addEventListener(FILE_DROP_EVENT, (e) => { const dropped = acceptedPath("folder", (e as CustomEvent<FileDropDetail>).detail.paths); if (dropped) { d.outDir = dropped; changed(true); } });
    const list = h("div", { className: "cmpIssues" });
    const missing = session.failedPaths().length;
    if (missing) {
      const drop = h("button", { textContent: `Remove the ${missing} file${missing === 1 ? "" : "s"} that could not be read`, title: "Take the missing or unreadable files out of the prop" });
      drop.onclick = () => { session.dropFailed(); changed(true); };
      list.append(drop);
    }
    if (!issues.length) list.append(h("div", { className: "dim hint", textContent: "Ready to build." }));
    for (const i of issues) list.append(h("div", { className: "cmpIssue " + i.level, textContent: (i.level === "error" ? "✖ " : "⚠ ") + i.text }));
    const blocked = issues.some((i) => i.level === "error") || !d.outDir;
    const build = h("button", { className: "primary", textContent: building ? "Building…" : "Build", disabled: building || blocked, title: blocked ? "Fix what the checks list first" : "Compile the prop into the folder" });
    build.onclick = () => void runBuild();

    const parts: (Node | null | false)[] = [
      (() => {
        const head = h("h3", { className: "first" }, "Prop ", open, reset);
        // a session file dragged from the file explorer onto the heading
        head.dataset.fileDrop = "txt";
        head.addEventListener(FILE_DROP_EVENT, (e) => { const dropped = acceptedPath("txt", (e as CustomEvent<FileDropDetail>).detail.paths); if (dropped) void openSession(dropped); });
        return head;
      })(),
      name,
      h("div", { className: "cmpTopMain" },
        pick("Surface", d.surfaceprop, PROP_SURFACES.map((s) => ({ value: s, label: s })), (v) => { d.surfaceprop = v; changed(true); }, "What the prop is made of: its sound, and what bullets do to it"),
        number("Mass (kg)", d.mass, 0.1, 50000, 1, (v) => { d.mass = v; changed(true); }, "How heavy it is, for a prop that is solid"),
        check("Static prop", d.staticProp, (on) => { d.staticProp = on; changed(true); }, "$staticprop: a prop that never moves, drawn as part of the map"),
        check("Smart fill", d.smartFill, (on) => { d.smartFill = on; changed(false); }, "Picking a model brings its other LODs and the textures named after its materials; picking a colour texture brings the normal and exponent"),
        pick<"dxt" | "none">("Compression", d.compression, [{ value: "none", label: "None" }, { value: "dxt", label: "DXT" }], (v) => { d.compression = v; changed(true); }, "How the textures of every material are stored. DXT is a quarter to an eighth of the size but blocky on smooth gradients and fine detail (the item importer always uses it). None keeps every pixel as you made it, at four times the size (three without alpha)")),
      folder, note("folder") ? h("div", { className: "dim hint err", textContent: note("folder") }) : null,
      h("h3", {}, "Model"),
      ...Array.from({ length: PROP_NUM_LODS }, (_, i) => fileRow(`LOD ${i}`, d.lods[i], "fbx", (p) => void session.setLod(i, p), note(`lod:${i}`))),
      h("h3", {}, "Collision"),
      h("div", { className: "cmpTopMain" },
        pick<CollisionMode>("Collision", d.collision, [
          { value: "hull", label: "Hull of the mesh" }, { value: "box", label: "Box" }, { value: "file", label: "My own model (.smd)" }, { value: "none", label: "None (decoration)" },
        ], (v) => { d.collision = v; changed(true); }, "A hull is one convex solid around the model: right for a crate, a barrel, a lamp. A chair or a table wants a model of its own"),
        check("Concave", d.concave, (on) => { d.concave = on; changed(true); }, "$concave: studiomdl cuts a collision model that is not convex into convex pieces")),
      d.collision === "file" ? fileRow("Collision", d.collisionFile, "smd", (p) => void session.setCollisionFile(p), note("collision")) : note("collision") ? h("div", { className: "dim hint err", textContent: note("collision") }) : null,
      h("div", { className: "dim hint", textContent: names.length ? `${names.length} material${names.length === 1 ? "" : "s"}: set them in the panel beside this one.` : "Pick the model to see its materials." }),
      h("h3", {}, "Output"),
      outRow,
      h("h3", {}, "Check"), list,
      h("div", { className: "row2" }, build, status ? h("span", { className: "dim hint", textContent: status }) : null,
        builtPath && host.reveal ? (() => { const show = h("button", { textContent: "Show", title: "Show the folder" }); show.onclick = () => host.reveal?.(builtPath); return show; })() : null),
    ];
    element.replaceChildren(...parts.filter((c): c is Node => !!c));
    flyoutEl.replaceChildren(
      h("div", { className: "cmpTabs", role: "tablist" }, h("button", { textContent: "Materials", className: "on" })),
      pick("Texture limit", String(d.maxTexture), PROP_TEXTURE_LIMITS.map((n) => ({ value: String(n), label: `${n} × ${n}` })), (v) => { d.maxTexture = Number(v); changed(true); }, "The largest side a texture may have"),
      names.length ? h("div", { className: "cmpMaterials" }, ...names.map((n) => material(n, issues))) : h("div", { className: "dim hint", textContent: "Pick the model to see its materials." }));
  }

  /** Opens a prop from its session file: its data comes back, and its files are read again. */
  async function openSession(path?: string) {
    try {
      const text = await host.openSession(path);
      if (text === null) return;
      session.restore(PropSession.readSession(text));
      status = ""; builtPath = "";
      render();
      await session.loadAll();
      host.setPreview(session.preview());
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      render();
    }
  }

  async function runBuild() {
    if (building) return;
    building = true; status = ""; builtPath = "";
    render();
    try {
      const result = await host.build(session.request());
      status = result.message;
      builtPath = result.ok ? result.path ?? "" : "";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      building = false;
      render();
    }
  }

  return {
    session,
    element,
    flyout: flyoutEl,
    /** The Prop side was opened. */
    async show() {
      active = true;
      render();
      if (!loaded) { loaded = true; await session.loadAll(); }
      render();
      host.setPreview(session.preview());
      window.clearInterval(poll);
      // a file changed on disk is read again, and an error about it goes when it is fixed
      poll = window.setInterval(() => { if (active) void session.refresh().catch((e) => console.error(e)); }, 1500);
    },
    /** It was left: the prop comes out of the scene. */
    hide() {
      active = false;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      host.setPreview(null);
    },
    render,
    /** The scene changed under the preview: the prop is shown again. */
    refresh() { if (active) schedule(); },
  };
}
