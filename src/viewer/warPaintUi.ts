import type { WarPaint } from "./warPaintCompositor";
import { randomSeed, WEARS } from "./warPaints";

export interface WarPaintHooks {
  /** The held weapon's war paint key (`sniperrifle`, null when it can't be painted) and its war paint. */
  current(): { weapon: string | null; paint: WarPaint | null };
  /** The war paints made for a weapon, by name (they are read from the game's files the first time). */
  kits(weapon: string): Promise<{ id: number; name: string }[]>;
  /** A war paint chosen (null: none). */
  set(paint: WarPaint | null): void;
}

/**
 * The War paint row of the Weapons panel, shown while the held weapon can be painted: the paint (from the game's paint kits for that
 * weapon), its wear and its seed (the one number the game's inspect panel shows; a random one with Random).
 */
export function createWarPaintUi(host: HTMLElement, hooks: WarPaintHooks) {
  host.classList.add("warPaint");
  const kit = document.createElement("select");
  kit.title = "The war paint on the held weapon (the game's own paint kits for it)";
  const wear = document.createElement("select");
  wear.title = "How worn it is: the scratches and dirt the paint shows";
  WEARS.forEach((w, i) => wear.add(new Option(w, String(i + 1))));
  const seed = document.createElement("input");
  seed.className = "text";
  seed.inputMode = "numeric";
  seed.spellcheck = false;
  seed.placeholder = "Seed";
  seed.title = "The seed (as the game's inspect panel shows it): it decides where the paint's random parts land, so the same seed gives the same skin";
  const random = document.createElement("button");
  random.textContent = "Random";
  random.title = "A random seed";
  const label = (text: string, el: HTMLElement) => {
    const row = document.createElement("label");
    row.className = "warPaintRow";
    const span = document.createElement("span");
    span.textContent = text;
    row.append(span, el);
    return row;
  };
  const seedRow = document.createElement("div");
  seedRow.className = "warPaintSeed";
  seedRow.append(seed, random);
  host.append(label("War paint", kit), label("Wear", wear), label("Seed", seedRow));

  let shownWeapon: string | null = null;
  let token = 0;

  const changed = () => {
    const id = Number(kit.value);
    if (!kit.value || !id) { hooks.set(null); syncEnabled(); return; }
    const digits = seed.value.replace(/\D/g, "");
    if (digits !== seed.value) seed.value = digits;
    hooks.set({ kit: id, wear: Number(wear.value) || 1, seed: digits || "0" });
    syncEnabled();
  };
  const syncEnabled = () => {
    const on = !!kit.value;
    wear.disabled = seed.disabled = random.disabled = !on;
  };
  kit.onchange = changed;
  wear.onchange = changed;
  seed.onchange = changed;
  seed.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); changed(); } };
  random.onclick = () => { seed.value = randomSeed(); changed(); };

  /** Shows the held weapon's war paint (hidden when it can't be painted). */
  async function refresh() {
    const { weapon, paint } = hooks.current();
    host.hidden = !weapon;
    if (!weapon) { shownWeapon = null; return; }
    const mine = ++token;
    if (weapon !== shownWeapon) {
      kit.innerHTML = "";
      kit.add(new Option("None", ""));
      kit.disabled = true;
      let kits: { id: number; name: string }[] = [];
      try {
        kits = await hooks.kits(weapon);
      } catch (err) {
        if (mine !== token) return;
        kit.innerHTML = "";
        kit.add(new Option("War paints unavailable", ""));
        kit.title = `Could not read the game's war paints: ${String(err)}`;
        return;
      }
      if (mine !== token) return;
      for (const k of kits) kit.add(new Option(k.name, String(k.id)));
      kit.disabled = false;
      shownWeapon = weapon;
    }
    kit.value = paint && [...kit.options].some((o) => o.value === String(paint.kit)) ? String(paint.kit) : "";
    wear.value = String(paint?.wear ?? 1);
    if (document.activeElement !== seed) seed.value = paint?.seed ?? "0";
    syncEnabled();
  }

  return { refresh };
}
