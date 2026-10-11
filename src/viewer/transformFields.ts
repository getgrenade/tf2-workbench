import { attachNumberDrag } from "./numberDrag";

type Vec3 = [number, number, number];

export interface TransformState {
  /** Null: the thing has no location (the fields stay empty and off). */
  position: Vec3 | null;
  /** Degrees. Null: no rotation. */
  rotation: Vec3 | null;
  /** Null (or missing): the thing cannot be scaled. */
  scale?: Vec3 | null;
  /** Which rotation axes can be edited (default: all). */
  rotationAxes?: [boolean, boolean, boolean];
  /** Which location and scale axes can be edited (default: all): a 2D thing has no Z. */
  positionAxes?: [boolean, boolean, boolean];
  scaleAxes?: [boolean, boolean, boolean];
}

/** How a block differs from the one of a thing in the world: the unit of its location, and how fast scrubbing changes the values. */
export interface TransformOptions {
  positionLabel?: string;
  positionTitle?: string;
  speed?: Partial<Record<"position" | "rotation" | "scale", number>>;
}

export interface TransformHooks {
  position: (value: Vec3) => void;
  rotation: (value: Vec3) => void;
  /** Without it the scale fields stay off. */
  scale?: (value: Vec3) => void;
}

type Kind = "position" | "rotation" | "scale";
const KINDS: Kind[] = ["position", "rotation", "scale"];

const AXES = ["X", "Y", "Z"];

/**
 * The Location / Rotation / Scale fields of the properties panel, drawn the way the camera's are: click to type, drag sideways to
 * scrub (Shift: ten times finer). One block per kind of thing, each fed with `set` and reporting edits through the hooks.
 */
export function createTransformFields(hooks: TransformHooks, options: TransformOptions = {}) {
  const el = document.createElement("div");
  el.className = "cameraTransforms";
  const STEP: Record<Kind, string> = { position: ".1", rotation: "1", scale: ".01" };
  const column = (kind: Kind, label: string, title: string) =>
    `<fieldset><legend>${label}</legend>${AXES.map((axis) => `<label><span>${axis}</span><input data-field="${kind}-${axis}" type="number" step="${STEP[kind]}" aria-label="${label} ${axis}" title="${title}" /></label>`).join("")}</fieldset>`;
  el.innerHTML = `<div class="cameraTransformColumns">${column("position", options.positionLabel ?? "Location", options.positionTitle ?? "World position (Source units)")}${column("rotation", "Rotation (°)", "Degrees")}${column("scale", "Scale", "Size, 1 is the normal size")}</div>`;
  const inputs = Object.fromEntries(KINDS.map((k) => [k, AXES.map((a) => el.querySelector<HTMLInputElement>(`[data-field="${k}-${a}"]`)!)])) as Record<Kind, HTMLInputElement[]>;
  const scrubbing = new Set<HTMLInputElement>();
  let last: TransformState = { position: null, rotation: null };

  const show = () => {
    for (const kind of KINDS) {
      const value = last[kind] ?? null;
      inputs[kind].forEach((input, axis) => {
        const axes = kind === "rotation" ? last.rotationAxes : kind === "position" ? last.positionAxes : last.scaleAxes;
        input.disabled = !value || (kind === "scale" && !hooks.scale) || axes?.[axis] === false;
        if (!value) input.value = "";
        else if (!scrubbing.has(input) && document.activeElement !== input) input.value = String(+value[axis].toFixed(4));
      });
    }
  };

  for (const kind of KINDS) {
    const list = inputs[kind];
    const send = (value: Vec3) => (kind === "position" ? hooks.position(value) : kind === "rotation" ? hooks.rotation(value) : hooks.scale?.(value));
    list.forEach((input, axis) => {
      input.onchange = () => {
        if (list.some((field) => !field.value.trim() || !Number.isFinite(field.valueAsNumber))) { show(); return; }
        send(list.map((field) => field.valueAsNumber) as Vec3);
      };
      input.onblur = show;
      input.onkeydown = (event) => event.stopPropagation();
      let baseline: Vec3 = [0, 0, 0];
      attachNumberDrag(input, options.speed?.[kind] ?? (kind === "position" ? 0.1 : kind === "rotation" ? 0.25 : 0.01), {
        start() {
          baseline = list.map((field) => field.valueAsNumber) as Vec3;
          list.forEach((field) => scrubbing.add(field));
        },
        change(value) {
          const next: Vec3 = [...baseline];
          next[axis] = value;
          send(next);
        },
        end() {
          list.forEach((field) => scrubbing.delete(field));
          show();
        },
      });
    });
  }

  return {
    el,
    /** Shows the values (fields that are being typed in or scrubbed are left alone). */
    set(state: TransformState) {
      last = state;
      show();
    },
  };
}
