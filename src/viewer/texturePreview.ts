import type { TextureData } from "./payload";

/** One material of a cosmetic with the textures worth looking at. */
export interface PreviewMaterial {
  path: string;
  textures: { base?: TextureData; bump?: TextureData; exponent?: TextureData };
  /** The meshes drawn with this material: their UVs (two per vertex, v = 0 at the top like the pixels) and triangles. */
  meshes: { uvs: Float32Array; indices: Uint32Array }[];
}

/** A worn cosmetic and its materials. */
export interface PreviewItem {
  label: string;
  materials: PreviewMaterial[];
}

type Slot = "base" | "bump" | "exponent";
type Channel = "rgb" | "r" | "g" | "b" | "a";

const SLOTS: { id: Slot; label: string; title: string }[] = [
  { id: "base", label: "Diffuse", title: "$basetexture (its alpha is often the paint / phong mask)" },
  { id: "bump", label: "Normal", title: "$bumpmap" },
  { id: "exponent", label: "Exp mask", title: "$phongexponenttexture: the exponent, the tint mask and the rim mask in its channels" },
];
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
export function createTexturePreview(root: HTMLElement): { show: (items: PreviewItem[]) => void } {
  root.innerHTML = `<div class="texPick"><select class="texItem"></select><select class="texMat"></select></div>
    <div class="texTabs"></div>
    <div class="texStage"><canvas class="texImage"></canvas><canvas class="texWire"></canvas><div class="texNone dim" hidden></div></div>
    <div class="texChans"></div>
    <div class="texWireRow"><label title="Draw the UV layout of the meshes over the texture"><input type="checkbox" class="texWireOn" /> UV wireframe</label><input type="color" class="texWireColor" value="#00e5ff" title="Wireframe colour" /><input type="range" class="texWireOpacity" min="0.05" max="1" step="0.05" value="0.6" title="Wireframe opacity" /></div>
    <div class="texInfo dim hint"></div>`;
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
  const markTabs = buttons(tabs, SLOTS, () => slot, (id) => (slot = id as Slot));
  const markChans = buttons(chans, CHANNELS, () => channel, (id) => (channel = id as Channel));
  const mark = () => {
    markTabs();
    markChans();
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
      none.textContent = `This material has no ${SLOTS.find((s) => s.id === slot)!.label.toLowerCase()} texture`;
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
    info.textContent = `${m.path.replace(/^materials\//, "")} · ${tex.width}×${tex.height}`;
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
    item?.materials.forEach((m, i) => matSelect.add(new Option(m.path.replace(/^materials\//, "").split("/").pop() ?? m.path, String(i))));
    matSelect.selectedIndex = Math.min(Math.max(0, previous), Math.max(0, (item?.materials.length ?? 1) - 1));
    matSelect.hidden = (item?.materials.length ?? 0) < 2;
  }

  itemSelect.onchange = () => {
    matSelect.selectedIndex = 0;
    fillMaterials();
    draw();
  };
  matSelect.onchange = draw;
  wireOn.onchange = draw;
  wireColor.oninput = draw;
  wireOpacity.oninput = () => (wire.style.opacity = wireOpacity.value); // only the opacity: no need to draw the lines again

  return {
    show(next) {
      const wasLabel = items[itemSelect.selectedIndex]?.label;
      items = next;
      itemSelect.replaceChildren();
      items.forEach((it, i) => itemSelect.add(new Option(it.label, String(i))));
      const keep = items.findIndex((it) => it.label === wasLabel);
      itemSelect.selectedIndex = keep >= 0 ? keep : 0;
      itemSelect.hidden = items.length < 2;
      fillMaterials();
      mark();
      draw();
    },
  };
}
