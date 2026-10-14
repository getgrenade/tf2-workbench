import { open } from "@tauri-apps/plugin-dialog";
import { findBlender } from "../api";
import { RIG_CLASSES, addRig, blenderExe, loadRig, onRigsChange, reloadRig, removeRig, rigEntries, rigError, setBlenderExe, setRigClass, type RigEntry } from "./rigLibrary";

/**
 * The Rigs section of Settings (desktop): the Blender to read rig files with, and the rig files (.blend) that replace the built-in pose controls
 * for the characters of their class.
 */

type El<K extends keyof HTMLElementTagNameMap> = HTMLElementTagNameMap[K];
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): El<K> => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

export function createRigSettings(): HTMLElement {
  const box = make("div", "setGroup");
  box.append(make("h3", "", "Blender rigs"));
  const card = make("div", "setCard");
  box.append(card);

  // what each file is doing: reading, ready, or why not
  const state = new Map<string, string>();

  const blenderRow = () => {
    const row = make("div", "setRow");
    const text = make("span", "setText");
    text.append(make("b", "", "Blender"), make("span", "dim", "The Blender program that reads the rig files (any version from 4.1). Empty: the newest one found on this computer."));
    const controls = make("span", "setControls");
    controls.style.cssText = "display:flex;gap:6px;align-items:center;";
    const input = make("input");
    input.type = "text";
    input.placeholder = "blender.exe (found automatically)";
    input.value = blenderExe();
    input.style.cssText = "width:260px;";
    input.onchange = () => setBlenderExe(input.value);
    const browse = make("button", "", "Browse…");
    browse.onclick = async () => {
      const picked = await open({ multiple: false, filters: [{ name: "Program", extensions: ["exe"] }] });
      if (typeof picked === "string") { input.value = picked; setBlenderExe(picked); }
    };
    const detect = make("button", "", "Find");
    detect.title = "Look for Blender on this computer";
    detect.onclick = async () => {
      const found = await findBlender().catch(() => [] as string[]);
      if (!found.length) { detect.textContent = "None found"; setTimeout(() => (detect.textContent = "Find"), 2500); return; }
      input.value = found[0];
      setBlenderExe(found[0]);
    };
    controls.append(input, browse, detect);
    row.append(text, controls);
    return row;
  };

  const rigRow = (e: RigEntry) => {
    const row = make("div", "setRow");
    row.style.cursor = "default";
    const text = make("span", "setText");
    const name = make("b", "", e.path.split(/[\\/]/).pop() ?? e.path);
    name.title = e.path;
    const status = make("span", "dim", state.get(e.id) ?? "");
    const err = rigError(e.id);
    if (err) { status.textContent = err; status.style.color = "var(--bad, #e0584c)"; }
    text.append(name, status);
    const controls = make("span", "setControls");
    controls.style.cssText = "display:flex;gap:6px;align-items:center;";
    const cls = make("select");
    for (const c of ["all", ...RIG_CLASSES]) {
      const o = make("option", "", c === "all" ? "All classes" : c[0].toUpperCase() + c.slice(1));
      o.value = c;
      cls.append(o);
    }
    cls.value = e.cls;
    cls.title = "The characters this rig is used for";
    cls.onchange = () => setRigClass(e.id, cls.value);
    const reload = make("button", "", "Read again");
    reload.title = "Read the file with Blender again (it was changed)";
    reload.onclick = () => { reloadRig(e); void read(e); };
    const remove = make("button", "", "Remove");
    remove.onclick = () => removeRig(e.id);
    controls.append(cls, reload, remove);
    row.append(text, controls);
    return row;
  };

  const read = async (e: RigEntry) => {
    state.set(e.id, "Reading the file with Blender… (the first time takes a little while)");
    render();
    try {
      const data = await loadRig(e);
      state.set(e.id, `Ready: ${data.bones.length} bones, ${data.drivers.length} drivers`);
    } catch {
      state.set(e.id, "");
    }
    render();
  };

  const addRow = () => {
    const row = make("div", "setRow");
    row.style.cursor = "default";
    const text = make("span", "setText");
    text.append(make("b", "", "Rig files"), make("span", "dim", "A .blend file of a rig for the game's skeleton (the bip_ bones). While posing, a character of its class gets the rig's controls instead of the built-in ones; the pose panel switches it off."));
    const add = make("button", "", "Add rig (.blend)…");
    add.onclick = async () => {
      const picked = await open({ multiple: true, filters: [{ name: "Blender file", extensions: ["blend"] }] });
      const paths = typeof picked === "string" ? [picked] : Array.isArray(picked) ? picked : [];
      for (const p of paths) void read(addRig(p));
    };
    row.append(text, add);
    return row;
  };

  function render() {
    card.replaceChildren(blenderRow(), addRow(), ...rigEntries().map(rigRow));
  }
  onRigsChange(render);
  render();
  return box;
}
