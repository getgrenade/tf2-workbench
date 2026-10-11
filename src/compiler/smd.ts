import * as THREE from "three";
import type { ImportedModel, ImportedPart } from "./fbx";
import { turnedWorld, type BoneTurn } from "./boneAxes";

/**
 * Writes an imported model as a Studiomdl Data file (.smd), the text format the game's studiomdl compiles: the bones with their bind
 * pose, and the triangles with their skin. The importer feeds studiomdl a .dmx made from the FBX; an .smd of the same geometry in the
 * same Y-up frame compiles to the same model, and unlike a .dmx it can be written in a few milliseconds.
 */

/** The bones of the file the skin refers to, with their ancestors (an SMD's bone list must be closed under parent). */
function usedBones(model: ImportedModel, parts: ImportedPart[]) {
  const byName = new Map(model.skeleton.map((b) => [b.name, b]));
  const keep = new Set<string>();
  for (const part of parts) {
    for (let v = 0; v < part.skinIndices.length; v++) {
      if (part.skinWeights[v] <= 1e-5) continue;
      for (let n: string | null = part.boneNames[part.skinIndices[v]] ?? null; n && byName.has(n) && !keep.has(n); n = byName.get(n)!.parent) keep.add(n);
    }
  }
  // keep the file's own order, parents first
  const ordered: string[] = [];
  const visit = (name: string) => {
    if (ordered.includes(name)) return;
    const parent = byName.get(name)?.parent;
    if (parent && keep.has(parent)) visit(parent);
    ordered.push(name);
  };
  for (const b of model.skeleton) if (keep.has(b.name)) visit(b.name);
  return { ordered, byName };
}

const num = (v: number) => (Math.abs(v) < 1e-7 ? 0 : v).toFixed(6);

/**
 * The .smd text of a model. `fallbackBone` is the bone a mesh with no skin of its own follows (the item compiler's choice, the head);
 * a model whose skeleton lacks it falls back to the first bone. `turns` gives bones other axes (see boneAxes.ts): the bone keeps its place,
 * its children keep theirs, and only the offsets that say so are written differently.
 */
export function writeSmd(model: ImportedModel, materialName: (material: string) => string, fallbackBone = "bip_head", turns: Record<string, BoneTurn> = {}): string {
  const parts = model.parts;
  const { ordered, byName } = usedBones(model, parts);
  // a model with no skeleton at all still needs one bone
  const names = ordered.length ? ordered : [fallbackBone];
  const index = new Map(names.map((n, i) => [n, i]));
  const lines: string[] = ["version 1", "nodes"];
  for (const [i, name] of names.entries()) {
    const parent = byName.get(name)?.parent;
    lines.push(`  ${i} "${name}" ${parent !== null && parent !== undefined && index.has(parent) ? index.get(parent) : -1}`);
  }
  lines.push("end", "skeleton", "time 0");
  const world = names.map((n) => turnedWorld(new THREE.Matrix4().fromArray(byName.get(n)?.world ?? new THREE.Matrix4().toArray()), turns[n]));
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), local = new THREE.Matrix4(), e = new THREE.Euler();
  for (const [i, name] of names.entries()) {
    const parent = byName.get(name)?.parent;
    const pi = parent !== null && parent !== undefined ? index.get(parent) : undefined;
    if (pi === undefined) local.copy(world[i]); else local.copy(world[pi]).invert().multiply(world[i]);
    local.decompose(p, q, s);
    // Source's Euler angles: roll about X, pitch about Y, yaw about Z, composed Rz * Ry * Rx
    e.setFromQuaternion(q, "ZYX");
    lines.push(`  ${i}  ${num(p.x)} ${num(p.y)} ${num(p.z)}  ${num(e.x)} ${num(e.y)} ${num(e.z)}`);
  }
  lines.push("end", "triangles");
  const fallback = index.get(fallbackBone) ?? 0;
  for (const part of parts) {
    const material = materialName(part.material);
    for (let t = 0; t < part.indices.length; t++) {
      if (t % 3 === 0) lines.push(material);
      const v = part.indices[t];
      const links: [number, number][] = [];
      for (let k = 0; k < 4; k++) {
        const w = part.skinWeights[v * 4 + k];
        if (w <= 1e-5) continue;
        const bone = index.get(part.boneNames[part.skinIndices[v * 4 + k]] ?? "") ?? fallback;
        const same = links.find((l) => l[0] === bone);
        if (same) same[1] += w; else links.push([bone, w]);
      }
      if (!links.length) links.push([fallback, 1]);
      const total = links.reduce((sum, l) => sum + l[1], 0) || 1;
      // SMD texture coordinates run up from the bottom; ours (the game's compiled ones) run down from the top
      lines.push(`  ${links[0][0]}  ${num(part.positions[v * 3])} ${num(part.positions[v * 3 + 1])} ${num(part.positions[v * 3 + 2])}  ${num(part.normals[v * 3])} ${num(part.normals[v * 3 + 1])} ${num(part.normals[v * 3 + 2])}  ${num(part.uvs[v * 2])} ${num(1 - part.uvs[v * 2 + 1])}  ${links.length} ${links.map(([b, w]) => `${b} ${num(w / total)}`).join(" ")}`);
    }
  }
  lines.push("end", "");
  return lines.join("\n");
}

/** What the compiler must know of a written model: its own bones (not in the class) after the stripping studiomdl does. */
export function smdBoneNames(model: ImportedModel): string[] {
  return usedBones(model, model.parts).ordered;
}
