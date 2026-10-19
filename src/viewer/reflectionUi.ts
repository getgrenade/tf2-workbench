/** The Reflections section of the World panel: which cubemap of the game the shiny materials of the scene reflect, and how brightly. */
import { cubemapsDir, revealFile } from "../api";
import { cubemapLabel, listCubemaps } from "./reflection";
import type { ReflectionState } from "./reflectionState";

interface ReflectionHost {
  get(): ReflectionState;
  /** Changes the reflections; resolves when they are shown (rejects when the cubemap could not be made). */
  set(state: ReflectionState): Promise<void>;
}

export function createReflectionUi(section: HTMLElement, host: ReflectionHost) {
  section.innerHTML = `<h3>Reflections</h3>
<label class="skyPick" title="What the shiny materials that reflect the cubemap of the level (the metal and glass of items, the eyes) show: one of the cubemaps of the cubemaps folder">Cubemap <select data-control="cubemap"><option value="">Default</option></select></label>
<div class="row"><button type="button" data-control="cubemapFolder" title="Opens the cubemaps folder: a .vtf cubemap that is put there is in the list">Open cubemaps folder</button></div>
<label class="slider" title="How bright the reflections are">Brightness <output></output><input type="range" data-control="reflectionBrightness" min="0" max="2" step=".01" /></label>
<div class="dim hint reflectionStatus" role="status"></div>`;
  const pick = section.querySelector<HTMLSelectElement>('[data-control="cubemap"]')!;
  const brightness = section.querySelector<HTMLInputElement>('[data-control="reflectionBrightness"]')!;
  const status = section.querySelector<HTMLElement>(".reflectionStatus")!;
  const folder = section.querySelector<HTMLButtonElement>('[data-control="cubemapFolder"]')!;
  folder.onclick = () => void cubemapsDir().then(revealFile).catch((e) => { status.textContent = `The folder could not be opened: ${e instanceof Error ? e.message : e}`; });

  const sync = () => {
    const s = host.get();
    if (![...pick.options].some((o) => o.value === s.cubemap)) pick.append(new Option(cubemapLabel(s.cubemap), s.cubemap));
    pick.value = s.cubemap;
    brightness.value = String(s.brightness);
    brightness.parentElement!.querySelector("output")!.textContent = s.brightness.toFixed(2);
    brightness.disabled = !s.cubemap;
  };
  const change = async () => {
    status.textContent = pick.value ? "Making the cubemap…" : "";
    try {
      await host.set({ cubemap: pick.value, brightness: +brightness.value });
      status.textContent = "";
    } catch (e) {
      status.textContent = `The cubemap could not be made: ${e instanceof Error ? e.message : e}`;
    }
    sync();
  };
  pick.onchange = brightness.oninput = () => void change();

  // the list is the folder: it is read again when the list opens, so that a cubemap that was just put there is in it
  const fill = () => {
    void listCubemaps().then((found) => {
      const current = host.get().cubemap;
      const wanted = ["", ...found, ...(current && !found.includes(current) ? [current] : [])];
      // (a list that is open is not touched when nothing changed)
      if (wanted.join("|") !== [...pick.options].map((o) => o.value).join("|")) {
        pick.replaceChildren(new Option("Default", ""), ...wanted.slice(1).map((n) => new Option(cubemapLabel(n), n)));
      }
      pick.value = current;
      status.textContent = "";
    }).catch((e) => { status.textContent = `The cubemaps could not be listed: ${e instanceof Error ? e.message : e}`; });
  };
  pick.onmousedown = pick.onfocus = fill;
  fill();
  sync();
  return { sync };
}
