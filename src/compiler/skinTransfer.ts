import type { ImportedModel, ImportedPart } from "./fbx";

/**
 * The skin of a LOD that came without one, taken from LOD 0: every vertex gets the bones and weights of the nearest vertex of LOD 0. The game's
 * importer does this when it builds the item (the lower LODs are made without weights), so a LOD made that way shows on the character in the
 * preview as it will in the game, close enough to judge the shape. Only for the preview: the build keeps the LOD as it was given.
 */

/** Whether a part has no skin of its own (the loader marks a mesh that was not skinned with an empty bone name). */
export const isUnskinned = (part: ImportedPart) => part.boneNames.length === 1 && part.boneNames[0] === "";

export function transferSkin(source: ImportedModel, model: ImportedModel): ImportedModel {
  const targets = model.parts.filter(isUnskinned);
  if (!targets.length) return model;
  const donors = source.parts.filter((p) => !isUnskinned(p));
  if (!donors.length) return model;

  // a grid over the vertices of the source, sized so that a cell holds a few of them
  const [min, max] = [source.bounds.min, source.bounds.max];
  const total = donors.reduce((n, p) => n + p.positions.length / 3, 0);
  const size = Math.max(...[0, 1, 2].map((k) => max[k] - min[k])) || 1;
  const cell = size / Math.max(1, Math.cbrt(total / 4));
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, [number, number][]>();
  donors.forEach((part, pi) => {
    for (let v = 0; v < part.positions.length / 3; v++) {
      const k = key(Math.floor((part.positions[v * 3] - min[0]) / cell), Math.floor((part.positions[v * 3 + 1] - min[1]) / cell), Math.floor((part.positions[v * 3 + 2] - min[2]) / cell));
      const list = grid.get(k);
      if (list) list.push([pi, v]); else grid.set(k, [[pi, v]]);
    }
  });
  const nearest = (x: number, y: number, z: number): [number, number] => {
    const cx = Math.floor((x - min[0]) / cell), cy = Math.floor((y - min[1]) / cell), cz = Math.floor((z - min[2]) / cell);
    let best: [number, number] | null = null, bestD = Infinity;
    // the rings of cells around the point, until one is farther than the best found
    for (let r = 0; r < 200; r++) {
      if (best && (r - 1) * cell > Math.sqrt(bestD)) break;
      for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) for (let k = cz - r; k <= cz + r; k++) {
        if (Math.max(Math.abs(i - cx), Math.abs(j - cy), Math.abs(k - cz)) !== r) continue;
        for (const [pi, v] of grid.get(key(i, j, k)) ?? []) {
          const p = donors[pi].positions;
          const d = (p[v * 3] - x) ** 2 + (p[v * 3 + 1] - y) ** 2 + (p[v * 3 + 2] - z) ** 2;
          if (d < bestD) { bestD = d; best = [pi, v]; }
        }
      }
    }
    return best ?? [0, 0];
  };

  const parts = model.parts.map((part) => {
    if (!isUnskinned(part)) return part;
    const n = part.positions.length / 3;
    const names: string[] = [];
    const index = new Map<string, number>();
    const skinIndices = new Uint16Array(n * 4), skinWeights = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const [pi, sv] = nearest(part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]);
      const donor = donors[pi];
      for (let k = 0; k < 4; k++) {
        const weight = donor.skinWeights[sv * 4 + k];
        if (weight <= 0) continue;
        const name = donor.boneNames[donor.skinIndices[sv * 4 + k]];
        let at = index.get(name);
        if (at === undefined) { at = names.length; index.set(name, at); names.push(name); }
        skinIndices[v * 4 + k] = at;
        skinWeights[v * 4 + k] = weight;
      }
    }
    return { ...part, boneNames: names.length ? names : part.boneNames, skinIndices, skinWeights };
  });
  // the bones the skin names are the file of LOD 0's
  return { ...model, parts, skeleton: model.skeleton.length ? model.skeleton : source.skeleton };
}
