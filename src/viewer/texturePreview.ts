import type { TextureData } from "./payload";
import { TEXTURE_SLOTS } from "./textureOverrides";

/** One material of a cosmetic with the textures worth looking at. */
export interface PreviewMaterial {
  path: string;
  /** Its maps by slot (`base`, `bump`, `exponent`, `envmask`, ...; see TEXTURE_SLOTS). */
  textures: Record<string, TextureData | undefined>;
  /** The meshes drawn with this material: their UVs (two per vertex, v = 0 at the top like the pixels) and triangles. */
  meshes: { uvs: Float32Array; indices: Uint32Array }[];
}

/** A worn cosmetic and its materials. */
export interface PreviewItem {
  label: string;
  /** What it is, for `focus`: "character", or "item:<id>". */
  id?: string;
  materials: PreviewMaterial[];
}

type Slot = string;
type Channel = "rgb" | "r" | "g" | "b" | "a";

/** What the panel asks of the app to replace maps (absent: the panel only shows them). */
export interface TextureEditHooks {
  /** Asks for an image and puts it in place of a map; whether it was replaced. */
  replace(path: string, slot: string): Promise<boolean>;
  reset(path: string, slot: string): void;
  resetAll(): void;
  /** The file a map was replaced with, or null when it is the game's. */
  file(path: string, slot: string): string | null;
  /** How many maps are replaced in all. */
  count(): number;
  /** The VMT editor (absent: no VMT section). */
  vmt?: {
    /** The text to show: the edit, or the game's. */
    text(path: string): Promise<string>;
    /** Draws the material from this text; the error when it does not parse (the last good text stays on the model). */
    apply(path: string, text: string): Promise<string | null>;
    /** Puts the game's material back; its text. */
    reset(path: string): Promise<string>;
    edited(path: string): boolean;
  };
}
const CHANNELS: { id: Channel; label: string }[] = [
  { id: "rgb", label: "RGB" },
  { id: "r", label: "R" },
  { id: "g", label: "G" },
  { id: "b", label: "B" },
  { id: "a", label: "A" },
];

/**
 * The texture viewer of the left bar: the diffuse, normal and exponent-mask textures of a worn cosmetic, with the channels one by one.
 * When two or more cosmetics (or materials) are shown, a drop-down switches between them. The UV layout of the meshes can be laid over the
 * texture as a wireframe, with its own opacity and colour.
 */
export function createTexturePreview(root: HTMLElement, edit?: TextureEditHooks): { show: (items: PreviewItem[]) => void; focus: (id: string) => void } {
  root.innerHTML = `<div class="texPick"><select class="texItem"></select><select class="texMat"></select></div>
    <div class="texTabs"></div>
    <div class="texStage"><canvas class="texImage"></canvas><canvas class="texWire"></canvas><div class="texNone dim" hidden></div></div>
    <div class="texChans"></div>
    <div class="texWireRow"><label title="Draw the UV layout of the meshes over the texture"><input type="checkbox" class="texWireOn" /> UV wireframe</label><input type="color" class="texWireColor" value="#00e5ff" title="Wireframe colour" /><input type="range" class="texWireOpacity" min="0.05" max="1" step="0.05" value="0.6" title="Wireframe opacity" /></div>
    <div class="texEdit row2"${edit ? "" : " hidden"}><button class="texReplace" title="Put an image of your own (.png, .tga, .vtf) in place of this map, wherever this material is drawn">Replace…</button><button class="texReset" title="Put the game's own map back">Reset</button><button class="texResetAll" title="Put back every map you replaced, of every material">Reset all</button></div>
    <div class="texInfo dim hint"></div>
    <div class="texVmt"${edit?.vmt ? "" : " hidden"}><div class="texVmtHead"><span>VMT</span><span class="texVmtState dim"></span><button class="texVmtReset" title="Put the game's own VMT back">Reset VMT</button></div>
    <textarea class="texVmtText" spellcheck="false" rows="12" title="The material's VMT: what you type is drawn on the model as you type it"></textarea>
    <div class="texVmtError hint"></div></div>`;
  const itemSelect = root.querySelector<HTMLSelectElement>(".texItem")!;
  const matSelect = root.querySelector<HTMLSelectElement>(".texMat")!;
  const tabs = root.querySelector<HTMLElement>(".texTabs")!;
  const chans = root.querySelector<HTMLElement>(".texChans")!;
  const canvas = root.querySelector<HTMLCanvasElement>(".texImage")!;
  const wire = root.querySelector<HTMLCanvasElement>(".texWire")!;
  const wireOn = root.querySelector<HTMLInputElement>(".texWireOn")!;
  const wireColor = root.querySelector<HTMLInputElement>(".texWireColor")!;
  const wireOpacity = root.querySelector<HTMLInputElement>(".texWireOpacity")!;
  const none = root.querySelector<HTMLElement>(".texNone")!;
  const info = root.querySelector<HTMLElement>(".texInfo")!;
  const replaceBtn = root.querySelector<HTMLButtonElement>(".texReplace")!;
  const resetBtn = root.querySelector<HTMLButtonElement>(".texReset")!;
  const resetAllBtn = root.querySelector<HTMLButtonElement>(".texResetAll")!;
  const vmtText = root.querySelector<HTMLTextAreaElement>(".texVmtText")!;
  const vmtState = root.querySelector<HTMLElement>(".texVmtState")!;
  const vmtError = root.querySelector<HTMLElement>(".texVmtError")!;
  const vmtReset = root.querySelector<HTMLButtonElement>(".texVmtReset")!;
  /** The material whose VMT the editor holds (its text is only loaded again when another one is shown). */
  let vmtFor = "";
  let vmtTimer = 0;
  let vmtToken = 0;
  const markVmt = () => {
    const m = material();
    const edited = !!m && !!edit?.vmt?.edited(m.path);
    vmtState.textContent = edited ? "edited" : "";
    vmtReset.disabled = !edited;
  };
  const loadVmt = () => {
    const vmt = edit?.vmt;
    const m = material();
    if (!vmt) return;
    if (!m) { vmtFor = ""; vmtText.value = ""; vmtText.disabled = true; markVmt(); return; }
    if (m.path === vmtFor) { markVmt(); return; }
    vmtFor = m.path;
    vmtText.disabled = true;
    vmtError.textContent = "";
    const token = ++vmtToken;
    void vmt.text(m.path).then((text) => {
      if (token !== vmtToken) return;
      vmtText.value = text;
      vmtText.disabled = false;
      markVmt();
    }).catch((error) => { if (token === vmtToken) { vmtText.value = ""; vmtError.textContent = `Cannot read the VMT: ${String(error)}`; } });
  };

  let items: PreviewItem[] = [];
  let slot: Slot = "base";
  let channel: Channel = "rgb";

  const buttons = (host: HTMLElement, defs: { id: string; label: string; title?: string }[], current: () => string, pick: (id: string) => void) => {
    for (const d of defs) {
      const b = document.createElement("button");
      b.textContent = d.label;
      if (d.title) b.title = d.title;
      b.dataset.id = d.id;
      b.onclick = () => {
        pick(d.id);
        mark();
        draw();
      };
      host.appendChild(b);
    }
    return () => host.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.id === current()));
  };
  /** The tabs of the maps the material has (a replaced one is marked), rebuilt when the material changes. */
  let tabsFor = "";
  const markTabs = () => {
    const m = material();
    const present = TEXTURE_SLOTS.filter((s) => m?.textures[s.id]);
    const shown = present.length ? present : TEXTURE_SLOTS.slice(0, 3);
    if (!shown.some((s) => s.id === slot)) slot = shown[0].id;
    const signature = m ? `${m.path}|${shown.map((s) => `${s.id}${edit?.file(m.path, s.id) ? "*" : ""}`).join(",")}` : "";
    if (signature !== tabsFor) {
      tabsFor = signature;
      tabs.replaceChildren();
      for (const d of shown) {
        const b = document.createElement("button");
        const replaced = m ? edit?.file(m.path, d.id) : null;
        b.textContent = replaced ? `${d.label} •` : d.label;
        b.title = replaced ? `${d.title}. Replaced with ${replaced}` : d.title;
        b.dataset.id = d.id;
        b.classList.toggle("edited", !!replaced);
        b.onclick = () => { slot = d.id; mark(); draw(); };
        tabs.appendChild(b);
      }
    }
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.id === slot));
  };
  const markChans = buttons(chans, CHANNELS, () => channel, (id) => (channel = id as Channel));
  const mark = () => {
    markTabs();
    markChans();
    markEdit();
    loadVmt();
  };
  /** The replace and reset buttons, for the map shown. */
  const markEdit = () => {
    if (!edit) return;
    const m = material();
    replaceBtn.disabled = !m?.textures[slot];
    resetBtn.disabled = !m || !edit.file(m.path, slot);
    resetAllBtn.disabled = edit.count() === 0;
  };

  function material(): PreviewMaterial | null {
    return items[itemSelect.selectedIndex]?.materials[matSelect.selectedIndex] ?? null;
  }

  function draw() {
    const m = material();
    const tex = m?.textures[slot];
    canvas.hidden = !tex;
    wire.hidden = !tex || !wireOn.checked;
    none.hidden = !!tex;
    if (!m) {
      none.textContent = "No cosmetic worn";
      info.textContent = "";
      return;
    }
    if (!tex) {
      none.textContent = `This material has no ${(TEXTURE_SLOTS.find((s) => s.id === slot)?.label ?? slot).toLowerCase()} texture`;
      info.textContent = m.path;
      return;
    }
    canvas.width = tex.width;
    canvas.height = tex.height;
    const out = new ImageData(tex.width, tex.height);
    const src = tex.rgba, dst = out.data;
    const at = channel === "r" ? 0 : channel === "g" ? 1 : channel === "b" ? 2 : 3;
    for (let i = 0; i < src.length; i += 4) {
      if (channel === "rgb") {
        dst[i] = src[i];
        dst[i + 1] = src[i + 1];
        dst[i + 2] = src[i + 2];
      } else {
        dst[i] = dst[i + 1] = dst[i + 2] = src[i + at];
      }
      dst[i + 3] = 255;
    }
    canvas.getContext("2d")!.putImageData(out, 0, 0);
    const replaced = edit?.file(m.path, slot);
    info.textContent = `${m.path.replace(/^materials\//, "")} · ${tex.width}×${tex.height}${replaced ? ` · replaced with ${replaced}` : ""}`;
    drawWire(m, tex);
  }

  /** The triangles of the meshes in UV space, over the texture (one stroke, so it stays quick for big meshes). */
  function drawWire(m: PreviewMaterial, tex: TextureData) {
    wire.hidden = !wireOn.checked;
    wire.style.opacity = wireOpacity.value;
    if (!wireOn.checked) return;
    wire.width = tex.width;
    wire.height = tex.height;
    const ctx = wire.getContext("2d")!;
    ctx.clearRect(0, 0, wire.width, wire.height);
    ctx.strokeStyle = wireColor.value;
    ctx.lineWidth = Math.max(1, Math.max(tex.width, tex.height) / 600);
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const mesh of m.meshes) {
      const { uvs, indices } = mesh;
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = indices[t] * 2, b = indices[t + 1] * 2, c = indices[t + 2] * 2;
        ctx.moveTo(uvs[a] * tex.width, uvs[a + 1] * tex.height);
        ctx.lineTo(uvs[b] * tex.width, uvs[b + 1] * tex.height);
        ctx.lineTo(uvs[c] * tex.width, uvs[c + 1] * tex.height);
        ctx.closePath();
      }
    }
    ctx.stroke();
  }

  function fillMaterials() {
    const item = items[itemSelect.selectedIndex];
    const previous = matSelect.selectedIndex;
    matSelect.replaceChildren();
    item?.materials.forEach((m, i) => {
      const name = m.path.replace(/^materials\//, "").split("/").pop() ?? m.path;
      const replaced = TEXTURE_SLOTS.some((s) => edit?.file(m.path, s.id)) || !!edit?.vmt?.edited(m.path);
      matSelect.add(new Option(replaced ? `${name} (edited)` : name, String(i)));
    });
    matSelect.selectedIndex = Math.min(Math.max(0, previous), Math.max(0, (item?.materials.length ?? 1) - 1));
    matSelect.hidden = (item?.materials.length ?? 0) < 2;
  }

  itemSelect.onchange = () => {
    matSelect.selectedIndex = 0;
    fillMaterials();
    mark();
    draw();
  };
  matSelect.onchange = () => { mark(); draw(); };
  if (edit) {
    replaceBtn.onclick = async () => {
      const m = material();
      if (!m?.textures[slot]) return;
      replaceBtn.disabled = true;
      try { await edit.replace(m.path, slot); } finally { markEdit(); }
    };
    resetBtn.onclick = () => { const m = material(); if (m) edit.reset(m.path, slot); };
    resetAllBtn.onclick = () => edit.resetAll();
    const vmt = edit.vmt;
    if (vmt) {
      // live: what is typed is drawn a moment after the typing stops
      vmtText.oninput = () => {
        const path = vmtFor;
        if (!path) return;
        window.clearTimeout(vmtTimer);
        vmtTimer = window.setTimeout(async () => {
          const error = await vmt.apply(path, vmtText.value);
          if (path !== vmtFor) return;
          vmtError.textContent = error ? `Not drawn: ${error}` : "";
          markVmt();
        }, 300);
      };
      // (Tab types a tab, as VMT files are indented)
      vmtText.onkeydown = (e) => {
        if (e.key !== "Tab") return;
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b, value } = vmtText;
        vmtText.value = value.slice(0, a) + "\t" + value.slice(b);
        vmtText.selectionStart = vmtText.selectionEnd = a + 1;
        vmtText.dispatchEvent(new Event("input"));
      };
      vmtReset.onclick = async () => {
        const path = vmtFor;
        if (!path) return;
        window.clearTimeout(vmtTimer);
        const text = await vmt.reset(path);
        if (path === vmtFor) { vmtText.value = text; vmtError.textContent = ""; markVmt(); }
      };
    }
  }
  wireOn.onchange = draw;
  wireColor.oninput = draw;
  wireOpacity.oninput = () => (wire.style.opacity = wireOpacity.value); // only the opacity: no need to draw the lines again

  return {
    /** Shows the textures of one of the listed models (the one last clicked in the view). */
    focus(id) {
      const i = items.findIndex((it) => it.id === id);
      if (i < 0 || i === itemSelect.selectedIndex) return;
      itemSelect.selectedIndex = i;
      matSelect.selectedIndex = 0;
      fillMaterials();
      mark();
      draw();
    },
    show(next) {
      const wasLabel = items[itemSelect.selectedIndex]?.label;
      items = next;
      itemSelect.replaceChildren();
      items.forEach((it, i) => {
        const replaced = it.materials.some((m) => TEXTURE_SLOTS.some((s) => edit?.file(m.path, s.id)) || !!edit?.vmt?.edited(m.path));
        itemSelect.add(new Option(replaced ? `${it.label} (edited)` : it.label, String(i)));
      });
      const keep = items.findIndex((it) => it.label === wasLabel);
      itemSelect.selectedIndex = keep >= 0 ? keep : 0;
      itemSelect.hidden = items.length < 2;
      fillMaterials();
      mark();
      draw();
    },
  };
}
