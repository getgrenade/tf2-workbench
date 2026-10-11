import { flexKey, flexRawValue, flexRealValue, type FlexGlobals } from "./flex";
import type { ModelData } from "./payload";

export interface FlexEls {
  list: HTMLElement;
  reset: HTMLButtonElement;
}

/** The flex globals (by controller name, real values) of a model for the given controller values. */
export function flexGlobalsFor(model: ModelData | null, values: Map<string, number>): FlexGlobals {
  const g: FlexGlobals = new Map();
  for (const c of model?.flexControllers ?? []) {
    const real = values.get(flexKey(c.name)) ?? 0;
    g.set(flexKey(c.name), flexRealValue(c, flexRawValue(c, Number.isFinite(real) ? real : 0)));
  }
  return g;
}

/**
 * Flex sliders for the displayed class model (hlmv's Flex tab). Values are kept by controller name, so an
 * expression carries over when switching class, and bonemerged cosmetics read the same names.
 * Each slider spans its controller's own range (0..1 for most, -1..1 for the eyelids, -45..45 degrees for the eye aim).
 */
export function createFlexUi(els: FlexEls, onChange: (globals: FlexGlobals) => void) {
  /** Real controller values by lowercase name; unlisted controllers are at 0. */
  const values = new Map<string, number>();
  let model: ModelData | null = null;

  function globals(): FlexGlobals {
    return flexGlobalsFor(model, values);
  }

  /** The slider rows of the controllers shown, to keep them in step when a value is set from code. */
  const rows = new Map<string, { input: HTMLInputElement; output: HTMLInputElement }>();

  function build() {
    els.list.innerHTML = "";
    rows.clear();
    if (!model) return;
    if (model.flexControllers.length === 0) {
      els.list.textContent = "This model has no flex controllers.";
      return;
    }
    for (const c of model.flexControllers) {
      const row = document.createElement("div");
      row.className = "ui-prop";
      const real = flexRealValue(c, flexRawValue(c, values.get(flexKey(c.name)) ?? 0));
      const label = document.createElement("span"); label.className = "ui-key"; label.textContent = c.name; label.title = c.name;
      const output = document.createElement("input"); output.type = "number"; output.className = "ui-num";
      output.setAttribute("aria-label", `${c.name} value`); output.value = real.toFixed(2);
      const input = document.createElement("input");
      input.type = "range"; input.className = "ui-range";
      const [lo, hi] = c.min === c.max ? [0, 1] : [c.min, c.max];
      input.min = output.min = String(lo);
      input.max = output.max = String(hi);
      input.step = ".01"; output.step = "any";
      input.setAttribute("aria-label", c.name);
      input.value = String(real);
      input.oninput = () => {
        values.set(flexKey(c.name), +input.value);
        output.value = (+input.value).toFixed(2);
        onChange(globals());
      };
      input.ondblclick = () => {
        input.value = "0";
        input.oninput?.(new Event("input"));
      };
      output.onfocus = () => output.select();
      const save = () => {
        const n = output.valueAsNumber;
        if (Number.isFinite(n)) {
          const v = Math.max(lo, Math.min(hi, n)); values.set(flexKey(c.name), v);
          input.value = String(v); onChange(globals());
        }
        output.value = (values.get(flexKey(c.name)) ?? 0).toFixed(2);
      };
      output.onchange = save;
      output.onkeydown = event => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); save(); output.blur(); }
        else if (event.key === "Escape") { event.preventDefault(); output.value = (values.get(flexKey(c.name)) ?? 0).toFixed(2); output.blur(); }
      };
      output.onblur = () => { output.value = (values.get(flexKey(c.name)) ?? 0).toFixed(2); };
      const value = document.createElement("div"); value.className = "ui-val";
      value.append(input, output);
      row.append(label, value);
      els.list.appendChild(row);
      rows.set(flexKey(c.name), { input, output });
    }
  }

  els.reset.onclick = () => {
    values.clear();
    build();
    onChange(globals());
  };

  return {
    /** Sets one controller (real value) from code, e.g. the eye aim, and applies it. */
    set(name: string, real: number) {
      const c = model?.flexControllers.find((x) => flexKey(x.name) === flexKey(name));
      if (!c) return;
      const v = Math.min(Math.max(real, c.min), c.max);
      values.set(flexKey(name), v);
      const row = rows.get(flexKey(name));
      if (row) {
        row.input.value = String(v);
        row.output.value = v.toFixed(2);
      }
      onChange(globals());
    },
    /** The value of one controller (real units; 0 when unset). */
    get(name: string): number {
      return values.get(flexKey(name)) ?? 0;
    },
    /** A copy of the controller values (a character's expression). */
    state: (): Map<string, number> => new Map(values),
    /** Shows another character's expression: its values and class model. Nothing is applied (the character already has it). */
    restore(v: Map<string, number>, data: ModelData | null) {
      values.clear();
      for (const [k, x] of v) {
        const c = data?.flexControllers.find(c => flexKey(c.name) === k);
        values.set(k, c ? flexRealValue(c, flexRawValue(c, x)) : x);
      }
      model = data;
      build();
    },
    /** Call after the class model changes: rebuilds the sliders and applies the current values. */
    attach(data: ModelData) {
      model = data;
      build();
      onChange(globals());
    },
  };
}
