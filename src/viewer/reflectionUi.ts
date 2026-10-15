/** The Reflections section of the World panel: which cubemap of the game the shiny materials of the scene reflect, and how brightly. */
import { cubemapLabel, listCubemaps } from "./reflection";

const isMap = (name: string) => name.startsWith("maps/");
import type { ReflectionState } from "./reflectionState";

interface ReflectionHost {
  get(): ReflectionState;
  /** Changes the reflections; resolves when they are shown (rejects when the cubemap could not be made). */
  set(state: ReflectionState): Promise<void>;
}

export function createReflectionUi(section: HTMLElement, host: ReflectionHost) {
  section.innerHTML = `<h3>Reflections</h3>
<label class="skyPick" title="What the shiny materials that reflect the cubemap of the level (the metal and glass of items, the eyes) show: one of the game's own cubemaps">Cubemap <select data-control="cubemap"><option value="">Default</option></select></label>
<label class="slider" title="How bright the reflections are">Brightness <output></output><input type="range" data-control="reflectionBrightness" min="0" max="2" step=".01" /></label>
<div class="dim hint reflectionStatus" role="status"></div>`;
  const pick = section.querySelector<HTMLSelectElement>('[data-control="cubemap"]')!;
  const brightness = section.querySelector<HTMLInputElement>('[data-control="reflectionBrightness"]')!;
  const status = section.querySelector<HTMLElement>(".reflectionStatus")!;

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

  // the list comes from the game files, which may not be indexed yet when the panel is made: it is asked for again until it is there
  let listed = false, tries = 0;
  const fill = () => {
    if (listed) return;
    void listCubemaps().then((found) => {
      listed = true;
      const current = host.get().cubemap;
      // the game's own, then the maps' in a group of their own
      const maps = document.createElement("optgroup");
      maps.label = "Maps";
      maps.append(...found.filter(isMap).map((n) => new Option(cubemapLabel(n), n)));
      pick.replaceChildren(new Option("Default", ""), ...found.filter((n) => !isMap(n)).map((n) => new Option(cubemapLabel(n), n)), ...(maps.children.length ? [maps] : []));
      if (current && !found.includes(current)) pick.append(new Option(cubemapLabel(current), current));
      status.textContent = "";
      sync();
    }).catch(() => {
      status.textContent = "Waiting for the game to be indexed to list its cubemaps…";
      if (++tries < 120) setTimeout(fill, 2000);
    });
  };
  pick.onmousedown = pick.onfocus = fill;
  fill();
  sync();
  return { sync };
}
