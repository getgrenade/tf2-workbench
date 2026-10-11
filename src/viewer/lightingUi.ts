import type { LightState } from "./viewer";
import { DEFAULT_SHADOW_QUALITY, MAX_LIGHTS, newRigLight, parseLightingRig, parseShadowQuality, removeRigLight, type RigLight } from "./lighting";
import type { Quaternion } from "three";
import { createLightSphere } from "./lightSphere";
import { createLightSetupsUi } from "./lightSetupsUi";
interface LightingHost {
  get(): LightState;
  set(value: LightState): void;
  spawn(): [
    number,
    number,
    number
  ];
  cameraRotation(): Quaternion;
  /** A light was picked in the list. */
  picked?(): void;
}
export function createLightingUi(pane: HTMLElement, host: LightingHost) {
  const root = document.createElement("div");
  root.className = "lightingEditor";
  root.innerHTML = `<section class="lightCol worldSky"></section>
<section class="lightCol worldGround"></section>
<section class="lightCol lightingAmbient"><h3>Ambient &amp; shadows</h3><div class="lightAmbientFields"><span>Ambient</span><input type="color" data-control="ambientColor" aria-label="Ambient colour" /><input type="range" data-control="ambient" aria-label="Ambient intensity" min="0" max="1" step=".01" /><input class="lightValue" type="number" data-value="ambient" aria-label="Ambient value" min="0" max="1" step="any" /></div>
<div class="lightShadowQuality"><label class="lightShadowRes" title="The size of the picture each light's shadows are drawn into (a bigger one is sharper and takes more memory)">Real shadows <select data-control="shadowRes"><option value="512">Low · 512</option><option value="1024">Medium · 1024</option><option value="2048">High · 2048</option><option value="4096">Ultra · 4096</option></select></label>
<label class="slider" title="How soft the edges of the shadows are">Softness <output></output><input type="range" data-control="shadowSoft" min="0" max="1" step=".01" /></label>
<label class="slider" title="Raise it when surfaces speckle or stripe, lower it when shadows come loose from what casts them">Bias <output></output><input type="range" data-control="shadowBias" min="0" max=".01" step=".0001" /></label></div>
</section>
<section class="lightCol lightingControls"><div class="lightDirectionRow"><div class="lightBall"></div><div class="lightDirectionFields"></div></div><div class="lightFields"></div><button class="lightReset" data-action="reset">Reset light</button></section>`;
  pane.prepend(root);
  // the controls section can be moved out of the editor (the properties panel shows it), so it is looked up on its own too
  const controlsSection = root.querySelector<HTMLElement>(".lightingControls")!;
  // the ambient section lives in the Light panel, outside the editor, like the controls section (the properties panel)
  const ambientSection = root.querySelector<HTMLElement>(".lightingAmbient")!;
  document.getElementById("lightSetupsPane")!.prepend(ambientSection);
  const query = <T extends HTMLElement>(selector: string) => (selector === ".lightingControls" ? controlsSection : root.querySelector(selector) ?? controlsSection.querySelector(selector) ?? ambientSection.querySelector(selector)) as T;
  const getRig = () => { const value = host.get(); return parseLightingRig(value.rig, value); };
  const selected = () => { const rig = getRig(); return rig.lights.find(l => l.id === rig.selected) ?? null; };
  const commit = (mutate: (value: LightState) => void) => { const value = host.get(); value.rig = parseLightingRig(value.rig,value); mutate(value); const primary = value.rig.lights.find(l => l.type === "directional") ?? value; Object.assign(value, { azimuth: primary.azimuth, elevation: primary.elevation, intensity: primary.intensity, color: primary.color, followCamera: true }); host.set(value); sync(); };
  const edit = (mutate: (light: RigLight) => void) => commit(value => { const rig = value.rig!; const light = rig.lights.find(l => l.id === rig.selected); if (light) mutate(light); });
  const sphere = createLightSphere(selected, () => host.get().ambient, (az, el) => edit(l => { l.azimuth = az; l.elevation = el; }));
  query(".lightBall").append(sphere.element);
  const inputs = new Map<string, HTMLInputElement>();
  const numbers = new Map<string, HTMLInputElement>();
  const bindNumber = (input: HTMLInputElement, apply: (value: number) => void) => {
    input.onfocus = () => input.select();
    const save = () => {
      const value = input.valueAsNumber;
      if (Number.isFinite(value)) apply(Math.max(+input.min, Math.min(+input.max, value)));
    };
    input.onchange = save;
    input.onblur = () => sync();
    input.onkeydown = event => {
      event.stopPropagation();
      if (event.key === "Enter") { event.preventDefault(); save(); input.blur(); }
      else if (event.key === "Escape") { event.preventDefault(); input.value = ""; input.blur(); }
    };
  };
  const ambientNumber = query<HTMLInputElement>('[data-value="ambient"]');
  bindNumber(ambientNumber, value => commit(state => { state.ambient = value; }));
  const addField = (parent: HTMLElement, key: string, label: string, min: number, max: number, step: number) => {
    const row = document.createElement("label");
    row.className = "slider";
    row.innerHTML = `${label}<input class="lightValue" type="number" data-value="${key}" aria-label="${label} value" title="${label}${key === "azimuth" || key === "elevation" || key === "cone" ? " (degrees)" : ""}: click to type" min="${min}" max="${max}" step="any" /><input type="range" min="${min}" max="${max}" step="${step}" />`;
    const input = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    const number = row.querySelector<HTMLInputElement>('input[type="number"]')!;
    inputs.set(key, input);
    numbers.set(key, number);
    bindNumber(number, value => edit(l => { (l as unknown as Record<string, unknown>)[key] = value; }));
    input.oninput = () => edit(l => { (l as unknown as Record<string, unknown>)[key] = +input.value; });
    parent.append(row);
  };
  addField(query(".lightDirectionFields"), "azimuth", "Azimuth", 0, 360, 1);
  addField(query(".lightDirectionFields"), "elevation", "Elevation", -90, 90, 1);
  const primary = document.createElement("div");
  primary.innerHTML = '<div class="checks"><label class="lightShadows"><input type="checkbox" data-control="shadows" /> Cast real shadows</label><label class="lightFollow" title="The direction is relative to the view, so the light turns with the camera, as in hlmv"><input type="checkbox" data-control="followCamera" /> Follow camera (HLMV)</label></div><label class="colorRow">Colour <input type="color" data-control="color" /></label>';
  query(".lightDirectionFields").append(primary);
  addField(primary, "intensity", "Intensity", 0, 6, .05);
  const fields = query(".lightFields");
  fields.innerHTML = '<div class="lightPosition"></div>';
  addField(fields, "range", "Radius", 1, 1000, 1);
  addField(fields, "falloff", "Falloff", .2, 6, .1);
  addField(fields, "cone", "Cone", 5, 85, 1);
  const position = query(".lightPosition");
  position.innerHTML = '<span>Location</span>';
  const coordinates: Array<HTMLInputElement> = [];
  for (const [i, axis] of ["X", "Y", "Z"].entries()) {
    const label = document.createElement("label"), input = document.createElement("input");
    input.type = "number";
    input.step = "1";
    input.oninput = () => { const n = Number(input.value); if (Number.isFinite(n))
      edit(l => { l.position[i] = n; }); };
    label.append(axis, input);
    position.append(label);
    coordinates.push(input);
  }
  for (const key of ["ambient", "ambientColor", "shadows", "followCamera", "color"]) {
    const input = query<HTMLInputElement>(`[data-control="${key}"]`);
    input.oninput = () => {
      if (key === "ambient" || key === "ambientColor")
        commit(value => { if (key === "ambient")
          value.ambient = +input.value;
        else
          value.ambientColor = input.value; });
      else
        edit(l => {
          if (key === "color") l.color = input.value;
          else if (key === "followCamera") { if (input.checked) l.followCamera = true; else delete l.followCamera; }
          else l.shadows = input.checked;
        });
    };
  }
  query<HTMLButtonElement>('[data-action="reset"]').onclick = () => edit(l => { const { name, group } = l; Object.assign(l, newRigLight(l.id, l.type, host.spawn()), { name }); if (group) l.group = group; else delete l.group; delete l.followCamera; delete l.pivot; delete l.rotation; });
  // how the real shadows are made (it is the same for every light)
  const shadowRes = query<HTMLSelectElement>('[data-control="shadowRes"]'), shadowSoft = query<HTMLInputElement>('[data-control="shadowSoft"]'), shadowBias = query<HTMLInputElement>('[data-control="shadowBias"]');
  const setQuality = () => commit(value => { value.rig!.shadow = parseShadowQuality({ resolution: +shadowRes.value, softness: +shadowSoft.value, bias: +shadowBias.value }); });
  shadowRes.onchange = shadowSoft.oninput = shadowBias.oninput = setQuality;
  /** Adds a light of this type (a copy of the selected one when asked). */
  const addLight = (type: RigLight["type"], duplicate = false) => commit(value => {
    const rig = value.rig!;
    if (rig.lights.length >= MAX_LIGHTS) return;
    const source = duplicate ? rig.lights.find(l => l.id === rig.selected) : undefined;
    const l = source ? structuredClone(source) : newRigLight(`light-${rig.lights.length}`, type, host.spawn());
    l.id = `light-${rig.lights.length}`;
    if (source) {
      const base = `${source.name} copy`;
      l.name = base;
      for (let i = 2; rig.lights.some(existing => existing.name === l.name); i++) l.name = `${base} ${i}`;
    }
    rig.lights.push(l); rig.selected = l.id;
  });
  function sync() {
    const value = host.get(), rig = parseLightingRig(value.rig, value), light = rig.lights.find(l => l.id === rig.selected) ?? null;
    query<HTMLInputElement>('[data-control="ambient"]').value = String(value.ambient);
    if (document.activeElement !== ambientNumber) ambientNumber.value = value.ambient.toFixed(2);
    query<HTMLInputElement>('[data-control="ambientColor"]').value = value.ambientColor;
    const quality = rig.shadow ?? DEFAULT_SHADOW_QUALITY;
    shadowRes.value = String(quality.resolution);
    shadowSoft.value = String(quality.softness);
    shadowBias.value = String(quality.bias);
    shadowSoft.parentElement!.querySelector("output")!.textContent = quality.softness.toFixed(2);
    shadowBias.parentElement!.querySelector("output")!.textContent = (quality.bias * 1000).toFixed(1);
    query(".lightingControls").hidden = !light;
    query(".lightBall").title = "Drag to rotate the light";
    if (!light)
      return;
    const point = light.type === "point";
    query(".lightBall").hidden = point;
    query<HTMLInputElement>('[data-control="shadows"]').checked = light.shadows;
    query(".lightFollow").hidden = light.type !== "directional";
    query<HTMLInputElement>('[data-control="followCamera"]').checked = light.followCamera === true;
    query<HTMLInputElement>('[data-control="color"]').value = light.color;
    for (const [key, input] of inputs) {
      const value = (light as unknown as Record<string, number>)[key];
      input.value = String(value);
      const number = numbers.get(key)!;
      if (document.activeElement !== number) number.value = key === "intensity" || key === "falloff" ? value.toFixed(2) : String(Math.round(value * 100) / 100);
      input.parentElement!.hidden = (key === "range" || key === "falloff") ? light.type === "directional" : key === "cone" ? light.type !== "spot" : key === "azimuth" || key === "elevation" ? point : false;
    }
    position.hidden = light.type === "directional";
    coordinates.forEach((input, i) => { if (document.activeElement !== input)
      input.value = String(Math.round(light.position[i] * 100) / 100); });
    sphere.draw();
  }
  sync();
  createLightSetupsUi(document.getElementById("lightSetupsBody")!, host.get, value => { host.set(value); sync(); });
  const find = (rig: ReturnType<typeof getRig>, id: string) => rig.lights.find(l => l.id === id);
  return {
    sync,
    /** The light the controls show, and a change to it. */
    selected,
    edit,
    /** What the outliner does with a light: the same as the buttons of the list above. */
    select: (id: string) => commit(v => { const rig = v.rig!, l = find(rig, id); if (!l) return; rig.selected = id; if (l.enabled) rig.marker = true; }),
    setEnabled: (id: string, on: boolean) => commit(v => {
      const rig = v.rig!, l = find(rig, id);
      if (!l) return;
      l.enabled = on;
    }),
    rename: (id: string, name: string) => commit(v => { const l = find(v.rig!, id); if (l) l.name = name; }),
    remove: (id: string) => commit(v => removeRigLight(v.rig!, id)),
    /** Puts lights in an outliner folder (undefined: out of any folder). */
    setGroup: (ids: string[], group: string | undefined) => commit(v => {
      const rig = v.rig!;
      for (const l of rig.lights) if (ids.includes(l.id)) { if (group) l.group = group; else delete l.group; }
    }),
    /** Adds a copy of each of these lights (the last copy is the selected light afterwards) and returns the ids of the copies. */
    duplicate: (ids: string[]) => {
      const made: string[] = [];
      commit(value => {
        const rig = value.rig!;
        for (const id of ids) {
          const source = rig.lights.find(l => l.id === id);
          if (!source || rig.lights.length >= MAX_LIGHTS) continue;
          const l = structuredClone(source);
          l.id = `light-${rig.lights.length}`;
          const base = `${source.name} copy`;
          l.name = base;
          for (let i = 2; rig.lights.some(existing => existing.name === l.name); i++) l.name = `${base} ${i}`;
          rig.lights.push(l); rig.selected = l.id; made.push(l.id);
        }
      });
      return made;
    },
    /** Adds a light of a type (the new light is the selected one afterwards). */
    add: (type: RigLight["type"], duplicate = false) => addLight(type, duplicate),
  };
}
