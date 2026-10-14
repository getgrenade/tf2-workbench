import { CLASS_LOD_COMMANDS, type LodBoneCommand } from "./classLods";
import type { ImportedModel } from "./fbx";

/**
 * The bone commands a cosmetic needs at LOD 1 and LOD 2. A player class's model gives up some bones at those LODs (`bonetreecollapse`,
 * `replacebone` in its QC, see classLods.ts); a cosmetic that is skinned to one of them has to give it up the same way in its own QC, or
 * the game keeps moving it with a bone the class no longer has. Only the commands that touch a bone the cosmetic's skin uses are given.
 */

/** The bones a model's skin uses (the ones a vertex has weight on). */
export function usedBones(model: ImportedModel): Set<string> {
  const used = new Set<string>();
  for (const part of model.parts) {
    for (let v = 0; v < part.skinIndices.length; v++) {
      if (part.skinWeights[v] <= 1e-5) continue;
      const name = part.boneNames[part.skinIndices[v]];
      if (name) used.add(name);
    }
  }
  return used;
}

/** Whether a bone is `ancestor` or hangs below it in the model's skeleton. */
function under(skeleton: Map<string, string | null>, bone: string, ancestor: string): boolean {
  for (let name: string | null | undefined = bone, hops = 0; name && hops < 256; name = skeleton.get(name), hops++) if (name === ancestor) return true;
  return false;
}

/** The commands of the class for a LOD (1 or 2) that touch the bones in `used`, in the class's order. */
export function lodCommands(cls: string, lod: 1 | 2, models: ImportedModel[]): LodBoneCommand[] {
  const all = CLASS_LOD_COMMANDS[cls]?.[lod - 1] ?? [];
  if (!all.length) return [];
  const used = new Set<string>();
  const skeleton = new Map<string, string | null>();
  for (const model of models) {
    for (const b of usedBones(model)) used.add(b);
    for (const b of model.skeleton) if (!skeleton.has(b.name)) skeleton.set(b.name, b.parent);
  }
  return all.filter((c) => (c[0] === "collapse" ? [...used].some((b) => under(skeleton, b, c[1])) : used.has(c[1])));
}

/** The commands as QC lines (`bonetreecollapse "bip_head"`). */
export function lodCommandLines(commands: LodBoneCommand[]): string[] {
  return commands.map((c) => (c[0] === "collapse" ? `bonetreecollapse "${c[1]}"` : `replacebone "${c[1]}" "${c[2]}"`));
}

/**
 * Where each bone goes at the LOD: a collapsed bone, and everything that hangs on it in the skeleton, goes to the collapsed bone's parent; a
 * replaced one to its replacement. The commands are applied in order, and a bone that moved is followed to where it ended.
 */
export function boneRemap(commands: LodBoneCommand[], skeleton: { name: string; parent: string | null }[]): Map<string, string> {
  const parent = new Map(skeleton.map((b) => [b.name, b.parent] as const));
  const goes = new Map<string, string>();
  for (const c of commands) {
    if (c[0] === "replace") { goes.set(c[1], c[2]); continue; }
    const up = parent.get(c[1]);
    if (!up) continue;
    for (const b of parent.keys()) if (under(parent, b, c[1])) goes.set(b, up);
  }
  const final = new Map<string, string>();
  for (const from of goes.keys()) {
    let to = goes.get(from)!;
    for (let hops = 0; hops < 32 && goes.has(to) && goes.get(to) !== to; hops++) to = goes.get(to)!;
    if (to !== from) final.set(from, to);
  }
  return final;
}

/** The model with the skin of the bones the commands remove moved to the bones they go to (for the preview at that LOD). */
export function applyBoneRemap(model: ImportedModel, remap: Map<string, string>): ImportedModel {
  if (!remap.size) return model;
  return {
    ...model,
    parts: model.parts.map((part) => (part.boneNames.some((n) => remap.has(n)) ? { ...part, boneNames: part.boneNames.map((n) => remap.get(n) ?? n) } : part)),
  };
}
