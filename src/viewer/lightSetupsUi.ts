import { deleteLightSetup, openLightSetupsFolder, readLightSetups, saveLightSetup } from "../api";
import type { LightState } from "./viewer";
import { captureLightSetup, lightSetupState, parseLightSetup, type LightSetup } from "./lightSetups";

export function createLightSetupsUi(root: HTMLElement, get: () => LightState, apply: (value: LightState) => void) {
  root.innerHTML = `<h3>Light setups <span><button data-action="refresh" title="Refresh light setups">↻</button><button data-action="folder" title="Open light setups folder">Folder</button></span></h3>
    <div class="lightSetupSave"><input class="text" aria-label="Light setup name" placeholder="Setup name" maxlength="80" /><button data-action="save" title="Save the current lighting without saving the scene">Save</button></div>
    <label class="lightSetupFilter"><input type="checkbox" /> Favorites only</label><div class="lightSetupList"></div><div class="dim hint" role="status"></div>`;
  const name = root.querySelector<HTMLInputElement>('.text')!, list = root.querySelector<HTMLElement>('.lightSetupList')!;
  const status = root.querySelector<HTMLElement>('[role="status"]')!, filter = root.querySelector<HTMLInputElement>('.lightSetupFilter input')!;
  let entries: { name: string; setup: LightSetup }[] = [], busy = false;
  const storedNames = new Set<string>();
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    busy = true; root.classList.add("busy");
    try { await action(); } catch (error) { status.textContent = String(error); }
    finally { busy = false; root.classList.remove("busy"); }
  };
  const render = () => {
    list.replaceChildren();
    const visible = entries.filter(e => !filter.checked || e.setup.favorite)
      .sort((a, b) => Number(b.setup.favorite) - Number(a.setup.favorite));
    for (const entry of visible) {
      const row = document.createElement("div"); row.className = "lightSetupRow";
      const use = document.createElement("button"); use.className = "lightSetupName"; use.textContent = entry.name;
      use.title = "Apply this setup, replacing the current lights";
      use.onclick = () => { apply(lightSetupState(entry.setup)); status.textContent = `Applied '${entry.name}'.`; };
      const star = document.createElement("button"); star.className = "lightSetupStar";
      star.textContent = entry.setup.favorite ? "★" : "☆";
      star.classList.toggle("on", entry.setup.favorite); star.setAttribute("aria-pressed", String(entry.setup.favorite));
      star.title = entry.setup.favorite ? "Remove from favorites" : "Add to favorites";
      star.setAttribute("aria-label", `${star.title}: ${entry.name}`);
      star.onclick = () => void run(async () => {
        const setup = { ...entry.setup, favorite: !entry.setup.favorite };
        await saveLightSetup(entry.name, JSON.stringify(setup, null, 2)); entry.setup = setup; render();
      });
      const remove = document.createElement("button"); remove.textContent = "×"; remove.title = "Delete light setup";
      remove.setAttribute("aria-label", `Delete light setup: ${entry.name}`);
      remove.onclick = () => void run(async () => {
        await deleteLightSetup(entry.name); entries = entries.filter(e => e !== entry); storedNames.delete(entry.name.toLowerCase()); render(); status.textContent = `Deleted '${entry.name}'.`;
      });
      row.append(use, star, remove); list.append(row);
    }
    if (!visible.length) { const empty = document.createElement("div"); empty.className = "dim hint"; empty.textContent = filter.checked ? "Star a saved setup to add it here." : "Save your lighting to reuse it in other scenes."; list.append(empty); }
  };
  const refresh = async () => {
    const files = await readLightSetups();
    storedNames.clear();
    for (const [name] of files) storedNames.add(name.toLowerCase());
    entries = []; let skipped = 0;
    for (const [name, text] of files) {
      try { entries.push({ name, setup: parseLightSetup(text) }); } catch { skipped++; }
    }
    render(); status.textContent = skipped ? `Skipped ${skipped} unsupported setup file(s).` : "";
  };
  const save = () => void run(async () => {
    let title = name.value.trim();
    if (!title) { let i = 1; do { title = `Light setup ${i++}`; } while (storedNames.has(title.toLowerCase())); }
    if (title.startsWith('.') || !/^[\p{L}\p{N} ._-]+$/u.test(title) || new TextEncoder().encode(title).length > 80) throw new Error("Use letters, digits, spaces, - _ or . (up to 80 bytes).");
    if (storedNames.has(title.toLowerCase())) throw new Error("That setup name already exists. Choose a new name.");
    const setup = captureLightSetup(get());
    await saveLightSetup(title, JSON.stringify(setup, null, 2)); storedNames.add(title.toLowerCase()); entries.unshift({ name: title, setup });
    name.value = ""; filter.checked = false; render(); status.textContent = `Saved '${title}'.`;
  });
  root.querySelector<HTMLButtonElement>('[data-action="save"]')!.onclick = save;
  name.onkeydown = event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); save(); } };
  root.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.onclick = () => void run(refresh);
  root.querySelector<HTMLButtonElement>('[data-action="folder"]')!.onclick = () => void run(async () => { status.textContent = await openLightSetupsFolder(); });
  filter.onchange = render;
  void run(refresh);
}
