/**
 * Flex (facial expression) evaluation, ported from the Source SDK 2013:
 *  - `CStudioHdr::RunFlexRules` (public/studio.cpp): the postfix programs that turn controller values into
 *    flex descriptor weights
 *  - `StudioModel::FlexVerts` (hlmv/studio_flex.cpp): the weight ramp (target0..target3) and vertex deltas
 *
 * Controllers are identified by name through a global table (`C_BaseFlex::AddGlobalFlexController`), which
 * is how a bonemerged cosmetic follows the class model's sliders: its own rules read the controllers that
 * share a name with the player's (case-insensitive) and everything else reads 0 (`CEconEntity::SetupWeights`).
 */
import type { MeshData, ModelData } from "./payload";

export type FlexGlobals = Map<string, number>;

// Op codes of studio.h (STUDIO_*).
const CONST = 1, FETCH1 = 2, FETCH2 = 3, ADD = 4, SUB = 5, MUL = 6, DIV = 7, NEG = 8, MAX = 13, MIN = 14;
const TWOWAY_0 = 15, TWOWAY_1 = 16, NWAY = 17, COMBO = 18, DOMINATE = 19, LOWER_EYELID = 20, UPPER_EYELID = 21;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Valve's `RemapValClamped`. */
function remapClamped(v: number, a: number, b: number, c: number, d: number): number {
  if (a === b) return v >= b ? d : c;
  return c + (d - c) * clamp((v - a) / (b - a), 0, 1);
}

/** The engine's controller key: names compare case-insensitively. */
export const flexKey = (name: string) => name.toLowerCase();

/** A controller's value in its real range for a raw 0..1 slider position. */
export const flexRealValue = (c: { min: number; max: number }, raw: number) => raw * (c.max - c.min) + c.min;

/** The raw slider position of a real value (hlmv `SetFlexController`): the default state is real value 0. */
export function flexRawValue(c: { min: number; max: number }, real: number): number {
  return c.min === c.max ? clamp(real, 0, 1) : clamp((real - c.min) / (c.max - c.min), 0, 1);
}

type Rules = Pick<ModelData, "flexControllers" | "flexRules" | "flexDescCount">;

/** Runs a model's flex rules against the global controller values and returns one weight per flex descriptor. */
export function runFlexRules(model: Rules, globals: FlexGlobals): Float32Array {
  const dest = new Float32Array(model.flexDescCount);
  const controllers = model.flexControllers;
  const src = (index: number) => globals.get(flexKey(controllers[index]?.name ?? "")) ?? 0;
  const stack = new Float32Array(32);

  for (const rule of model.flexRules) {
    if (rule.flex < 0 || rule.flex >= dest.length) continue;
    let k = 0;
    for (const [op, arg] of rule.ops) {
      switch (op) {
        case ADD: stack[k - 2] += stack[k - 1]; k--; break;
        case SUB: stack[k - 2] -= stack[k - 1]; k--; break;
        case MUL: stack[k - 2] *= stack[k - 1]; k--; break;
        case DIV: stack[k - 2] = stack[k - 1] > 0.0001 ? stack[k - 2] / stack[k - 1] : 0; k--; break;
        case NEG: stack[k - 1] = -stack[k - 1]; break;
        case MAX: stack[k - 2] = Math.max(stack[k - 2], stack[k - 1]); k--; break;
        case MIN: stack[k - 2] = Math.min(stack[k - 2], stack[k - 1]); k--; break;
        case CONST: stack[k++] = arg; break;
        case FETCH1: stack[k++] = src(arg); break;
        case FETCH2: stack[k++] = dest[arg] ?? 0; break;
        case COMBO: {
          const km = k - arg;
          for (let i = km + 1; i < k; i++) stack[km] *= stack[i];
          k = k - arg + 1;
          break;
        }
        case DOMINATE: {
          const km = k - arg;
          let dv = stack[km];
          for (let i = km + 1; i < k; i++) dv *= stack[i];
          stack[km - 1] *= 1 - dv;
          k -= arg;
          break;
        }
        case TWOWAY_0: stack[k++] = remapClamped(src(arg), -1, 0, 1, 0); break;
        case TWOWAY_1: stack[k++] = remapClamped(src(arg), 0, 1, 0, 1); break;
        case NWAY: {
          let value = src(stack[k - 1]);
          const [x, y, z, w] = [stack[k - 5], stack[k - 4], stack[k - 3], stack[k - 2]];
          if (value <= x || value >= w) value = 0;
          else if (value < y) value = remapClamped(value, x, y, 0, 1);
          else if (value > z) value = remapClamped(value, z, w, 1, 0);
          else value = 1;
          stack[k - 5] = value * src(arg);
          k -= 4;
          break;
        }
        case LOWER_EYELID:
        case UPPER_EYELID: {
          const ranged = (index: number, lo: number, hi: number) => {
            const c = controllers[index];
            return c ? remapClamped(src(index), c.min, c.max, lo, hi) : 0;
          };
          const closeLidV = ranged(arg, 0, 1);
          const closeLid = ranged(stack[k - 1], 0, 1);
          const upDownIndex = stack[k - 3];
          const eyeUpDown = upDownIndex >= 0 ? ranged(upDownIndex, -1, 1) : 0;
          if (op === LOWER_EYELID) {
            stack[k - 3] = eyeUpDown > 0 ? (1 - eyeUpDown) * (1 - closeLidV) * closeLid : (1 - closeLidV) * closeLid;
          } else {
            stack[k - 3] = eyeUpDown < 0 ? (1 + eyeUpDown) * closeLidV * closeLid : closeLidV * closeLid;
          }
          k -= 2;
          break;
        }
        default:
          break; // ops the compiler never emits
      }
    }
    dest[rule.flex] = stack[0];
  }
  return dest;
}

/** The ramp of `FlexVerts`: how strongly a flex with these targets applies at descriptor weight `w`. */
export function flexRamp(w: number, t: readonly [number, number, number, number]): number {
  if (w <= t[0] || w >= t[3]) return 0;
  if (w < t[1]) return (w - t[0]) / (t[1] - t[0]);
  if (w > t[2]) return (t[3] - w) / (t[3] - t[2]);
  return 1;
}

/**
 * Writes a mesh's flexed positions and normals into `positions` / `normals` (copies of the bind pose
 * are taken from `mesh`). Returns whether any flex was active.
 */
export function applyMeshFlexes(mesh: MeshData, weights: Float32Array, positions: Float32Array, normals: Float32Array): boolean {
  positions.set(mesh.positions);
  normals.set(mesh.normals);
  let active = false;
  for (const f of mesh.flexes) {
    const w = flexRamp(weights[f.desc] ?? 0, f.targets);
    if (w > -0.001 && w < 0.001) continue;
    active = true;
    for (let i = 0; i < f.vertices.length; i++) {
      const v = f.vertices[i] * 3;
      for (let c = 0; c < 3; c++) {
        positions[v + c] += w * f.deltas[i * 3 + c];
        normals[v + c] += w * f.normalDeltas[i * 3 + c];
      }
    }
  }
  if (active) {
    for (const f of mesh.flexes) {
      for (const idx of f.vertices) {
        const v = idx * 3;
        const l = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
        normals[v] /= l;
        normals[v + 1] /= l;
        normals[v + 2] /= l;
      }
    }
  }
  return active;
}
