/** The Ground section of the World panel: a plane at the floor with a colour, an opacity and a fade with the distance. */
import { DEFAULT_GROUND, type GroundState } from "./groundPlane";

interface GroundHost {
  get(): GroundState;
  set(state: GroundState): void;
}

export function createGroundUi(section: HTMLElement, host: GroundHost) {
  section.innerHTML = `<h3>Ground <button data-action="reset" title="Back to the usual ground">Reset</button></h3>
<div class="checks"><label title="A plane at the floor, so that there is something below the horizon of the sky"><input type="checkbox" data-control="groundOn" /> Ground plane</label><label title="Shade the background (gradient, picture or sky) instead of covering it: the colour darkens what is behind, white not at all"><input type="checkbox" data-control="groundBlend" /> Blend with background</label></div>
<label class="colorRow">Colour <input type="color" data-control="groundColor" /></label>
<label class="slider">Opacity <output></output><input type="range" data-control="groundOpacity" min="0" max="1" step=".01" /></label>
<label class="slider" title="How far from the scene the ground has faded away, in character heights">Fade distance <output></output><input type="range" data-control="groundDistance" min="1" max="60" step=".5" /></label>
<label class="slider" title="How much of that distance the fade takes: low is a clear edge, high a slow fade from the middle">Fade softness <output></output><input type="range" data-control="groundSoftness" min="0" max="1" step=".01" /></label>`;
  const q = <T extends HTMLElement>(key: string) => section.querySelector<T>(`[data-control="${key}"]`)!;
  const on = q<HTMLInputElement>("groundOn"), color = q<HTMLInputElement>("groundColor"), opacity = q<HTMLInputElement>("groundOpacity"), distance = q<HTMLInputElement>("groundDistance"), softness = q<HTMLInputElement>("groundSoftness"), blend = q<HTMLInputElement>("groundBlend");
  const out = (input: HTMLInputElement, text: string) => { input.parentElement!.querySelector("output")!.textContent = text; };

  const sync = () => {
    const g = host.get();
    on.checked = g.enabled;
    blend.checked = g.blend;
    color.title = g.blend ? "How much it darkens the background: white not at all" : "";
    color.value = g.color;
    opacity.value = String(g.opacity);
    distance.value = String(g.distance);
    softness.value = String(g.softness);
    out(opacity, g.opacity.toFixed(2));
    out(distance, g.distance.toFixed(1));
    out(softness, g.softness.toFixed(2));
    for (const input of [color, opacity, distance, softness, blend]) input.disabled = !g.enabled;
  };
  const change = () => { host.set({ enabled: on.checked, color: color.value, opacity: +opacity.value, distance: +distance.value, softness: +softness.value, blend: blend.checked }); sync(); };
  on.oninput = blend.oninput = color.oninput = opacity.oninput = distance.oninput = softness.oninput = change;
  section.querySelector<HTMLButtonElement>('[data-action="reset"]')!.onclick = () => { host.set({ ...DEFAULT_GROUND, enabled: on.checked, blend: blend.checked }); sync(); };
  sync();
  return { sync };
}
