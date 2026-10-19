import type { ItemInfo, PaintInfo } from "./payload";

/**
 * Random loadouts: "must include one shirt, must include my hat, must not include medals", rolled again with every press. The roll
 * itself ({@link rollLoadout}) is plain data in and out; {@link openRandomLoadout} is the window with the rules and the Roll button.
 */

/** What a rule looks at: an equip region (`shirt`, `hat`), one item (by id), or medals as a whole (thousands of them). */
export type RuleKind = "region" | "item" | "medal";

export interface LoadoutRule {
  mode: "include" | "exclude";
  kind: RuleKind;
  /** The region's name, or the item's id (as text); unused for medals. */
  value: string;
}

export interface RollOptions {
  /** How many cosmetics to aim for (the ones the rules ask for come first, and can make it more). */
  count: number;
  /** 0..1: how likely a paintable item is painted. */
  paintChance: number;
  /** Pick a random style of an item that has several. */
  styles: boolean;
  /** Workshop cosmetics can come up too (an item asked for by name always can). */
  workshop: boolean;
}

export interface RollSettings extends RollOptions {
  rules: LoadoutRule[];
  /** How many characters the scene has, each with a roll of its own. */
  copies: number;
  /** What each character does: keep its animation, a random taunt, a random animation, or one of those two at random. */
  pose: "keep" | "taunt" | "anim" | "mix";
  /** A random face for the poses and taunts that have none of their own: a mouth shape and one or two emotions. */
  flex: boolean;
  /** Every character the class of the selected one, or a random class each. */
  classes: "same" | "random";
}

export interface Rolled {
  item: ItemInfo;
  paint: PaintInfo | null;
  style: number;
}

/** A medal is rarely picked by chance: there are thousands of them and a few hundred of everything else. */
const MEDAL_WEIGHT = 0.02;

export function ruleMatches(rule: LoadoutRule, item: ItemInfo): boolean {
  if (rule.kind === "medal") return item.medal;
  if (rule.kind === "item") return String(item.id) === rule.value;
  return item.equipRegions.includes(rule.value);
}

function pickWeighted<T>(list: T[], weight: (x: T) => number, rand: () => number): T | undefined {
  let total = 0;
  for (const x of list) total += weight(x);
  if (!(total > 0)) return list[Math.floor(rand() * list.length)];
  let r = rand() * total;
  for (const x of list) {
    r -= weight(x);
    if (r <= 0) return x;
  }
  return list.at(-1);
}

/**
 * Rolls one loadout from `pool` (the cosmetics the class can wear). The "must include" rules are met first (an item named by a rule
 * even when another rule leaves its kind out), then random items fill up to `count`; nothing picked shares an equip region with
 * another (`conflicts`). Returns the items, or the rule that could not be met.
 */
export function rollLoadout(pool: ItemInfo[], paints: PaintInfo[], conflicts: (a: ItemInfo, b: ItemInfo) => boolean, rules: LoadoutRule[], o: RollOptions, rand: () => number = Math.random): { items: Rolled[] } | { failed: LoadoutRule } {
  const excludes = rules.filter((r) => r.mode === "exclude");
  const includes = rules.filter((r) => r.mode === "include");
  const left = (item: ItemInfo) => excludes.some((r) => ruleMatches(r, item));
  const asked = new Set(includes.filter((r) => r.kind === "item").map((r) => r.value));
  const allowed = (item: ItemInfo) => asked.has(String(item.id)) || ((o.workshop || !item.workshop) && !left(item));
  const picked: ItemInfo[] = [];
  const fits = (item: ItemInfo) => !picked.includes(item) && !picked.some((p) => conflicts(p, item));
  const medalsAsked = includes.some((r) => r.kind === "medal" || (r.kind === "region" && r.value === "medal"));
  const weight = (item: ItemInfo) => (item.medal && !medalsAsked ? MEDAL_WEIGHT : 1);
  // the named items first (they decide the most), then the regions and medals
  const ordered = [...includes.filter((r) => r.kind === "item"), ...includes.filter((r) => r.kind !== "item")];
  for (const rule of ordered) {
    if (picked.some((p) => ruleMatches(rule, p))) continue;
    const item = pickWeighted(pool.filter((x) => ruleMatches(rule, x) && allowed(x) && fits(x)), weight, rand);
    if (!item) return { failed: rule };
    picked.push(item);
  }
  while (picked.length < o.count) {
    const item = pickWeighted(pool.filter((x) => allowed(x) && fits(x)), weight, rand);
    if (!item) break;
    picked.push(item);
  }
  return {
    items: picked.map((item) => ({
      item,
      paint: item.paintable && paints.length && rand() < o.paintChance ? paints[Math.floor(rand() * paints.length)] : null,
      style: o.styles && item.styles.length > 1 ? Math.floor(rand() * item.styles.length) : 0,
    })),
  };
}

// --- the window ------------------------------------------------------------------------------------------------------------------

/** What the window asks of the program. */
export interface RandomLoadoutHost {
  /** The class of the selected character ("Engineer"), for the labels. */
  className(): string;
  /** The equip regions there are, and the cosmetics (for the rules that name one). */
  catalog(): Promise<{ regions: string[]; items: ItemInfo[] }>;
  /** Rolls the scene; resolves to what to say under the button. */
  roll(settings: RollSettings): Promise<string>;
}

const KEY = "randomLoadoutOptions";
const DEFAULTS: RollSettings = { rules: [{ mode: "exclude", kind: "medal", value: "" }], count: 3, paintChance: 0.5, styles: true, workshop: false, copies: 1, flex: true, pose: "keep", classes: "same" };

/** "whole_head" → "Whole head". */
export const regionLabel = (region: string) => (region.charAt(0).toUpperCase() + region.slice(1)).replace(/_/g, " ");

let closeOpen: (() => void) | null = null;

export function closeRandomLoadout() {
  closeOpen?.();
}

/** Opens the random loadout window (non-modal, beside the view: orbit and frame the scene while rolling). */
export function openRandomLoadout(host: RandomLoadoutHost) {
  if (closeOpen) return;
  const state: RollSettings = structuredClone(DEFAULTS);
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch { /* the defaults */ }
  const remember = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not kept */ } };

  const win = document.createElement("div");
  win.className = "chartWindow rollWindow";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "Random loadout");
  win.innerHTML = `<div class="chartHead"><span>Random loadout</span><button class="chartClose" title="Close" aria-label="Close">×</button></div><div class="rollBody"></div>`;
  const head = win.querySelector(".chartHead") as HTMLElement;
  const body = win.querySelector(".rollBody") as HTMLElement;

  let regions: string[] = [];
  let items: ItemInfo[] = [];
  const byId = new Map<string, ItemInfo>();
  const byName = new Map<string, ItemInfo>();
  const names = document.createElement("datalist");
  names.id = `rollItems${Date.now()}`;

  const heading = (text: string) => {
    const h = document.createElement("h3");
    h.textContent = text;
    body.appendChild(h);
  };

  // --- the rules ---
  heading("Rules");
  const ruleList = document.createElement("div");
  ruleList.className = "rollRules";
  body.appendChild(ruleList);
  const addRule = document.createElement("button");
  addRule.textContent = "+ Add rule";
  addRule.className = "rollAdd";
  addRule.onclick = () => { state.rules.push({ mode: "include", kind: "region", value: regions.includes("shirt") ? "shirt" : regions[0] ?? "" }); remember(); renderRules(); };
  body.appendChild(addRule);

  function renderRules() {
    ruleList.innerHTML = "";
    if (!state.rules.length) {
      const none = document.createElement("p");
      none.className = "dim hint";
      none.textContent = "No rules: anything the class can wear.";
      ruleList.appendChild(none);
    }
    state.rules.forEach((rule, i) => {
      const row = document.createElement("div");
      row.className = "rollRule";
      const mode = document.createElement("select");
      mode.add(new Option("Must include", "include"));
      mode.add(new Option("Must not include", "exclude"));
      mode.value = rule.mode;
      mode.onchange = () => { rule.mode = mode.value as LoadoutRule["mode"]; remember(); };
      const what = document.createElement("select");
      what.add(new Option("Medals", "medal"));
      what.add(new Option("This item…", "item"));
      const group = document.createElement("optgroup");
      group.label = "Equip region";
      for (const r of regions) group.appendChild(new Option(regionLabel(r), `region:${r}`));
      what.appendChild(group);
      what.value = rule.kind === "region" ? `region:${rule.value}` : rule.kind;
      // a region the catalog does not have (any more) is still shown, so the rule is not silently changed
      if (rule.kind === "region" && what.value !== `region:${rule.value}`) {
        group.appendChild(new Option(regionLabel(rule.value), `region:${rule.value}`));
        what.value = `region:${rule.value}`;
      }
      const item = document.createElement("input");
      item.type = "search";
      item.placeholder = "Item name";
      item.setAttribute("list", names.id);
      item.hidden = rule.kind !== "item";
      item.value = rule.kind === "item" ? byId.get(rule.value)?.displayName ?? "" : "";
      const mark = () => item.classList.toggle("bad", rule.kind === "item" && !byId.has(rule.value));
      item.oninput = () => {
        const hit = byName.get(item.value.trim().toLowerCase());
        rule.value = hit ? String(hit.id) : "";
        mark();
        remember();
      };
      mark();
      what.onchange = () => {
        const v = what.value;
        if (v.startsWith("region:")) { rule.kind = "region"; rule.value = v.slice(7); }
        else { rule.kind = v as RuleKind; rule.value = ""; item.value = ""; }
        item.hidden = rule.kind !== "item";
        mark();
        if (rule.kind === "item") item.focus();
        remember();
      };
      const remove = document.createElement("button");
      remove.className = "rollRemove";
      remove.textContent = "×";
      remove.title = "Remove this rule";
      remove.setAttribute("aria-label", "Remove this rule");
      remove.onclick = () => { state.rules.splice(i, 1); remember(); renderRules(); };
      row.append(mode, what, remove, item);
      ruleList.appendChild(row);
    });
  }

  // --- the options ---
  const row = (label: string, control: HTMLElement, inline = true) => {
    const r = document.createElement("label");
    r.className = `chartRow${inline ? " inline" : ""}`;
    r.append(label, control);
    body.appendChild(r);
    return r;
  };
  const select = <T extends string | number>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
    const s = document.createElement("select");
    options.forEach(([, text], i) => s.add(new Option(text, String(i))));
    s.value = String(Math.max(0, options.findIndex(([v]) => v === get())));
    s.onchange = () => { set(options[Number(s.value)][0]); remember(); };
    return row(label, s);
  };
  const check = (label: string, get: () => boolean, set: (on: boolean) => void) => {
    const r = document.createElement("label");
    r.className = "chartRow inline check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = get();
    box.onchange = () => { set(box.checked); remember(); };
    r.append(box, label);
    body.appendChild(r);
    return r;
  };

  heading("Cosmetics");
  select("How many", [[1, "1"], [2, "2"], [3, "3"]], () => state.count, (v) => (state.count = v));
  select("Paint", [[0, "Never"], [0.5, "Sometimes"], [1, "Always"]], () => state.paintChance, (v) => (state.paintChance = v));
  check("Random styles", () => state.styles, (on) => (state.styles = on));
  const flexBox = check("Randomize flexes", () => state.flex, (on) => (state.flex = on));
  flexBox.title = "A random mouth shape and one or two emotions (the flexes add up to at most 1, upper ones to at most 0.15) on every random animation and every taunt that has no face of its own (a taunt whose scene drives the face keeps it)";
  check("Workshop items too", () => state.workshop, (on) => (state.workshop = on));
  heading("Scene");
  select("Characters", [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]], () => state.copies, (v) => (state.copies = v));
  const classRow = select("Class", [["same", ""], ["random", "Random for each"]], () => state.classes, (v) => (state.classes = v));
  const syncClass = () => ((classRow.querySelector("option") as HTMLOptionElement).textContent = `${host.className() || "This class"} for all`);
  syncClass();
  select("Pose", [["keep", "Keep the animation"], ["taunt", "Random taunt"], ["anim", "Random animation"], ["mix", "Taunt or animation"]], () => state.pose, (v) => (state.pose = v));
  const hint = document.createElement("p");
  hint.className = "dim hint";
  hint.textContent = "A random animation is a weapon animation (standing or running) with a weapon of it in the hands and its run direction and aim varied a little (body pitch from 12° down to 4° up). A random pose is stopped on a frame where the character keeps a comfortable shape on screen (not sprawled or squashed).";
  body.appendChild(hint);

  const buttons = document.createElement("div");
  buttons.className = "btns";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  const rollBtn = document.createElement("button");
  rollBtn.className = "primary";
  rollBtn.textContent = "Roll";
  rollBtn.title = "Roll a new loadout (R while this window has focus)";
  buttons.append(closeBtn, rollBtn);
  body.appendChild(buttons);
  const status = document.createElement("p");
  status.className = "chartInfo";
  status.setAttribute("role", "status");
  body.appendChild(status);
  body.appendChild(names);

  let rolling = false;
  const roll = async () => {
    if (rolling) return;
    // an item rule whose name was not found would quietly do nothing
    const unnamed = state.rules.find((r) => r.kind === "item" && !byId.has(r.value));
    if (unnamed) { status.textContent = "Pick an item from the list for each “This item…” rule (or remove it)."; return; }
    rolling = true;
    rollBtn.disabled = true;
    status.textContent = "Rolling…";
    try {
      status.textContent = await host.roll(structuredClone(state));
    } catch (err) {
      status.textContent = `Could not roll: ${String(err)}`;
    } finally {
      rolling = false;
      rollBtn.disabled = false;
      syncClass();
    }
  };
  rollBtn.onclick = () => void roll();

  // dragged by its title bar
  head.onpointerdown = (ev) => {
    if ((ev.target as HTMLElement).closest("button")) return;
    const r = win.getBoundingClientRect();
    const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    head.setPointerCapture(ev.pointerId);
    head.onpointermove = (m) => {
      win.style.left = `${Math.min(Math.max(0, m.clientX - dx), innerWidth - 80)}px`;
      win.style.top = `${Math.min(Math.max(0, m.clientY - dy), innerHeight - 40)}px`;
      win.style.right = "auto";
    };
    head.onpointerup = () => (head.onpointermove = null);
  };
  const close = () => {
    win.remove();
    closeOpen = null;
  };
  (head.querySelector(".chartClose") as HTMLButtonElement).onclick = close;
  closeBtn.onclick = close;
  win.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
    else if ((ev.key === "r" || ev.key === "R") && !(ev.target as HTMLElement).matches("input, select, textarea")) { ev.preventDefault(); void roll(); }
  });
  win.tabIndex = -1;
  document.body.appendChild(win);
  closeOpen = close;
  renderRules();
  void host.catalog().then((c) => {
    regions = c.regions;
    items = c.items;
    for (const it of items) {
      byId.set(String(it.id), it);
      const key = it.displayName.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, it);
        names.appendChild(new Option(it.displayName));
      }
    }
    renderRules();
  });
  rollBtn.focus();
}
