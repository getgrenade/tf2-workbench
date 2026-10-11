/** The Sky section of the World panel: which skybox of the game is behind the scene, how it is turned and how bright it is. */
import { listSkies, skyLabel, type SkyState } from "./skybox";

interface SkyHost {
  get(): SkyState;
  /** Changes the sky; resolves when it is shown (rejects when its pictures could not be made). */
  set(state: SkyState): Promise<void>;
}

export function createSkyUi(section: HTMLElement, host: SkyHost) {
  section.innerHTML = `<h3>Sky</h3>
<label class="skyPick" title="The skyboxes of the game: six pictures around the scene, as the game draws them far behind everything">Skybox <select data-control="skyName"><option value="">None</option></select></label>
<label class="slider" title="Turns the sky around the scene">Rotation <output></output><input type="range" data-control="skyRotation" min="-180" max="180" step="1" /></label>
<label class="slider" title="How bright the sky is">Brightness <output></output><input type="range" data-control="skyBrightness" min="0" max="2" step=".01" /></label>
<div class="dim hint skyStatus" role="status"></div>`;
  const name = section.querySelector<HTMLSelectElement>('[data-control="skyName"]')!;
  const rotation = section.querySelector<HTMLInputElement>('[data-control="skyRotation"]')!;
  const brightness = section.querySelector<HTMLInputElement>('[data-control="skyBrightness"]')!;
  const status = section.querySelector<HTMLElement>(".skyStatus")!;

  const sync = () => {
    const s = host.get();
    if (![...name.options].some((o) => o.value === s.name)) name.append(new Option(skyLabel(s.name) || s.name, s.name));
    name.value = s.name;
    rotation.value = String(s.rotation);
    brightness.value = String(s.brightness);
    rotation.parentElement!.querySelector("output")!.textContent = `${Math.round(s.rotation)}°`;
    brightness.parentElement!.querySelector("output")!.textContent = s.brightness.toFixed(2);
    rotation.disabled = brightness.disabled = !s.name;
  };
  const change = async () => {
    status.textContent = name.value ? "Making the sky…" : "";
    try {
      await host.set({ name: name.value, rotation: +rotation.value, brightness: +brightness.value });
      status.textContent = "";
    } catch (e) {
      status.textContent = `The sky could not be made: ${e instanceof Error ? e.message : e}`;
    }
    sync();
  };
  name.onchange = rotation.oninput = brightness.oninput = () => void change();

  // the list comes from the game files, which may not be indexed yet when the panel is made: it is asked for again until it is there
  let listed = false, tries = 0;
  const fill = () => {
    if (listed) return;
    void listSkies().then((names) => {
      if (!names.length) throw new Error("no skyboxes yet");
      listed = true;
      const current = host.get().name;
      name.replaceChildren(new Option("None", ""), ...names.map((n) => new Option(skyLabel(n), n)));
      if (current && !names.includes(current)) name.append(new Option(skyLabel(current) || current, current));
      status.textContent = "";
      sync();
    }).catch(() => {
      status.textContent = "Waiting for the game to be indexed to list its skyboxes…";
      if (++tries < 120) setTimeout(fill, 2000);
    });
  };
  name.onmousedown = name.onfocus = fill;
  fill();
  sync();
  return { sync };
}
