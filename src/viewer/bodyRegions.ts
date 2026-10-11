/**
 * The parts of a character that can be shown or hidden when an item is inspected alone (the same segments as the pose mode body map).
 * A mesh triangle belongs to the part of the bone that moves its vertices most; bones that are not a body part of their own (fingers,
 * the `prp_` detail bones) belong to the part of their nearest ancestor that is.
 */

export const REGION_KEYS = [
  "head", "neck", "shoulderR", "shoulderL", "spine3", "spine2", "spine1", "spine0", "pelvis",
  "upperArmR", "upperArmL", "forearmR", "forearmL", "handR", "handL",
  "thighR", "thighL", "shinR", "shinL", "footR", "footL",
] as const;

const BONE_REGION: Record<string, string> = {
  bip_head: "head",
  bip_neck: "neck",
  bip_spine_3: "spine3",
  bip_spine_2: "spine2",
  bip_spine_1: "spine1",
  bip_spine_0: "spine0",
  bip_pelvis: "pelvis",
};
for (const side of ["L", "R"]) {
  BONE_REGION[`bip_collar_${side}`.toLowerCase()] = `shoulder${side}`;
  BONE_REGION[`bip_upperarm_${side}`.toLowerCase()] = `upperArm${side}`;
  BONE_REGION[`bip_lowerarm_${side}`.toLowerCase()] = `forearm${side}`;
  BONE_REGION[`bip_hand_${side}`.toLowerCase()] = `hand${side}`;
  BONE_REGION[`bip_hip_${side}`.toLowerCase()] = `thigh${side}`;
  BONE_REGION[`bip_knee_${side}`.toLowerCase()] = `shin${side}`;
  BONE_REGION[`bip_foot_${side}`.toLowerCase()] = `foot${side}`;
  BONE_REGION[`bip_toe_${side}`.toLowerCase()] = `foot${side}`;
}

/** For every bone, the index in REGION_KEYS of the part it belongs to (the pelvis for bones above no part at all). */
export function boneRegions(names: string[], parents: number[]): number[] {
  const index = new Map<string, number>(REGION_KEYS.map((k, i) => [k, i]));
  const pelvis = index.get("pelvis")!;
  const own = names.map((n) => index.get(BONE_REGION[n.toLowerCase()] ?? "") ?? -1);
  return names.map((_, i) => {
    for (let b = i, guard = 0; b >= 0 && guard < 64; b = parents[b], guard++) if (own[b] >= 0) return own[b];
    return pelvis;
  });
}

/** A vertex mask (one byte per vertex, 0 or 1) as text: bit-packed, base64. */
export function packMask(mask: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

export function unpackMask(text: string, count: number): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (raw.charCodeAt(i >> 3) & (1 << (i & 7))) out[i] = 1;
  return out;
}

/**
 * For every vertex, how much of it belongs to hidden parts: the skin weights of its bones that belong to a part not in `keep`
 * (by REGION_KEYS index), 0..1. The shaders interpolate it across the triangle and drop what is above one half, so the edge of a hidden
 * part is cut through the triangles where the skinning changes over, not along triangle edges.
 */
export function hiddenWeights(skinIndices: ArrayLike<number>, skinWeights: ArrayLike<number>, bone: number[], keep: boolean[]): Float32Array {
  const n = Math.floor(skinIndices.length / 4);
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let hidden = 0;
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinWeights[v * 4 + k];
      total += w;
      if (!keep[bone[skinIndices[v * 4 + k]] ?? 0]) hidden += w;
    }
    out[v] = total > 0 ? hidden / total : 0;
  }
  return out;
}

const both = (...bases: string[]) => bases.flatMap((b) => [`${b}R`, `${b}L`]);
const HEAD = ["head", "neck"];
const TORSO = ["spine3", "spine2", "spine1", "spine0", "pelvis"];
const ARMS = [...both("shoulder", "upperArm", "forearm", "hand")];
const LEGS = [...both("thigh", "shin", "foot")];

/** Named selections for the picker. */
export const BODY_PRESETS: { label: string; regions: string[] }[] = [
  { label: "All", regions: [...REGION_KEYS] },
  { label: "None", regions: [] },
  { label: "Head", regions: HEAD },
  { label: "Torso", regions: [...TORSO, ...both("shoulder")] },
  { label: "Arms", regions: ARMS },
  { label: "Legs", regions: [...LEGS, "pelvis"] },
];

const BY_EQUIP_REGION: [RegExp, string[]][] = [
  [/head|hat|face|glasses|lenses|beard|ears|hair|mouth|eye|mask/, HEAD],
  [/shirt|sleeve/, [...TORSO, ...ARMS, "neck"]],
  [/^arms?$/, ARMS],
  [/hand|glove/, both("hand", "forearm")],
  [/pants|legs?$/, [...LEGS, "pelvis"]],
  [/feet|shoe|sock|boot/, both("shin", "foot")],
  [/belt/, ["pelvis", "spine0"]],
  [/back|backpack/, ["spine3", "spine2", "spine1", ...both("shoulder", "upperArm")]],
  [/neck|scarf|tie/, ["neck", "spine3", ...both("shoulder")]],
  [/grenade|dogtag|medal|badge|pouch|bandolier/, [...TORSO.slice(0, 4), ...both("shoulder")]],
  [/shoulder/, [...both("shoulder", "upperArm"), "spine3"]],
];

/** The parts worth showing around an item worn in these equip regions (a hat: the head; a shirt: the torso and arms), none when unknown. */
export function defaultRegionsFor(equipRegions: string[]): string[] {
  const out = new Set<string>();
  for (const region of equipRegions) {
    for (const [pattern, parts] of BY_EQUIP_REGION) {
      if (pattern.test(region.toLowerCase())) {
        for (const p of parts) out.add(p);
        break;
      }
    }
  }
  return [...out];
}
