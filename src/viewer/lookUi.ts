/**
 * The settings of the look effects in the properties panel. Their controls come from the list in look.ts, so a new setting there
 * gets its slider here without more markup. Every effect is a section that the panel shows while that effect is the picked one.
 */
import { LOOK_DEFS, LOOK_KINDS, defaultLook, type LookKind } from "./look";
import { POST_KINDS } from "./postStack";

type State = { enabled: boolean; [key: string]: unknown };

export function createLookEditors(host: HTMLElement, edited: (kind: LookKind, state: State) => void) {
  const shows = new Map<LookKind, (state: State) => void>();
  for (const kind of LOOK_KINDS) {
    const def = LOOK_DEFS[kind];
    const section = document.createElement("section");
    section.className = "lightCol";
    section.dataset.effect = kind;
    section.hidden = true;
    const head = document.createElement("h3");
    const name = POST_KINDS[kind].label;
    head.textContent = name;
    const reset = document.createElement("button");
    reset.textContent = "Reset";
    reset.title = `Reset the settings of ${name.toLowerCase()}`;
    head.append(" ", reset);
    const onRow = document.createElement("div");
    onRow.className = "checks";
    const onLabel = document.createElement("label");
    onLabel.title = def.title;
    const on = document.createElement("input");
    on.type = "checkbox";
    onLabel.append(on, ` ${name}`);
    onRow.append(onLabel);
    section.append(head, onRow);

    const readers: (() => [string, unknown])[] = [];
    const writers: ((state: State) => void)[] = [];
    for (const c of def.controls) {
      if (c.type === "range") {
        const label = document.createElement("label");
        label.className = "slider";
        label.title = c.title;
        const out = document.createElement("output");
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(c.min);
        input.max = String(c.max);
        input.step = String(c.step);
        const show = () => { out.textContent = `${(+input.value).toFixed(c.digits)}${c.unit ?? ""}`; };
        label.append(`${c.label} `, out, input);
        section.append(label);
        readers.push(() => [c.key, +input.value]);
        writers.push((s) => { input.value = String(s[c.key]); show(); });
        input.addEventListener("input", show);
        input.addEventListener("dblclick", () => { input.value = String(def.defaults[c.key]); show(); input.dispatchEvent(new Event("input", { bubbles: true })); });
      } else if (c.type === "seed") {
        const row = document.createElement("div");
        row.className = "lookSeed";
        row.title = c.title;
        const name = document.createElement("span");
        name.textContent = c.label;
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.max = "9999";
        input.step = "1";
        const dice = document.createElement("button");
        dice.textContent = "Randomise";
        dice.title = "Pick another random number";
        dice.onclick = () => { input.value = String(Math.floor(Math.random() * 10000)); input.dispatchEvent(new Event("input", { bubbles: true })); };
        row.append(name, input, dice);
        section.append(row);
        readers.push(() => [c.key, Math.min(9999, Math.max(0, Math.round(input.valueAsNumber || 0)))]);
        writers.push((s) => { input.value = String(s[c.key]); });
      } else if (c.type === "color") {
        const label = document.createElement("label");
        label.className = "colorRow";
        label.title = c.title;
        const input = document.createElement("input");
        input.type = "color";
        label.append(`${c.label} `, input);
        section.append(label);
        readers.push(() => [c.key, input.value]);
        writers.push((s) => { input.value = String(s[c.key]); });
      } else {
        const row = document.createElement("div");
        row.className = "checks";
        const label = document.createElement("label");
        label.title = c.title;
        const input = document.createElement("input");
        input.type = "checkbox";
        label.append(input, ` ${c.label}`);
        row.append(label);
        section.append(row);
        readers.push(() => [c.key, input.checked]);
        writers.push((s) => { input.checked = s[c.key] === true; });
      }
    }
    const read = (): State => Object.fromEntries([["enabled", on.checked], ...readers.map((r) => r())]) as State;
    section.addEventListener("input", () => edited(kind, read()));
    section.addEventListener("change", () => edited(kind, read()));
    reset.onclick = () => {
      const state = { ...defaultLook(kind), enabled: on.checked } as unknown as State;
      writers.forEach((w) => w(state));
      edited(kind, state);
    };
    shows.set(kind, (state) => {
      on.checked = state.enabled;
      writers.forEach((w) => w(state));
    });
    host.append(section);
  }
  return { show: (kind: LookKind, state: State) => shows.get(kind)?.(state) };
}
