import type { ImportedModel, ImportedPart } from "./fbx";

/**
 * A lighter copy of a model for a LOD that is not made yet: the vertices are merged cell by cell of a grid (the cells as large as it takes to get
 * under the triangle budget), so the shape stays and the triangle count goes down. Every material keeps at least one triangle, so the LOD has as
 * many materials as the model. The skin, normals and texture coordinates are those of the vertex that stands for each cell: good enough to test
 * an item in the game (the game's importer takes the skin of the lower LODs from LOD 0), not to ship.
 */
export function decimateModel(model: ImportedModel, budget: number): ImportedModel {
  const parts = model.parts.filter((p) => p.indices.length >= 3);
  const target = Math.max(parts.length, Math.floor(budget));
  if (model.triangles <= target) return { ...model, flexes: undefined, flexControls: undefined };
  const [min, max] = [model.bounds.min, model.bounds.max];
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // a part that collapses to nothing gets one triangle back, so the search leaves room for them
  const room = Math.max(0, target - parts.length);
  // the cells get larger until the model fits (the triangle count only falls as they grow, give or take a little)
  let lo = diagonal / 4096, hi = diagonal, best = cluster(parts, hi, min);
  for (let i = 0; i < 24; i++) {
    const mid = Math.sqrt(lo * hi);
    const made = cluster(parts, mid, min);
    if (count(made) <= room) { best = made; hi = mid; } else lo = mid;
  }
  const out = best.map((p, i) => (p.indices.length >= 3 ? p : keepOneTriangle(parts[i])));
  const triangles = count(out);
  const vertices = out.reduce((sum, p) => sum + p.positions.length / 3, 0);
  return { ...model, parts: out, triangles, vertices, flexes: undefined, flexControls: undefined };
}

const count = (parts: ImportedPart[]) => parts.reduce((sum, p) => sum + p.indices.length / 3, 0);

/** Merges the vertices of each part that fall in the same cell of a grid with cells of `cell`, and drops the triangles that collapse. */
function cluster(parts: ImportedPart[], cell: number, origin: [number, number, number]): ImportedPart[] {
  return parts.map((part) => {
    const vertexCount = part.positions.length / 3;
    const into = new Int32Array(vertexCount);
    const keys = new Map<string, number>();
    const members: number[][] = [];
    for (let v = 0; v < vertexCount; v++) {
      const key = `${Math.floor((part.positions[v * 3] - origin[0]) / cell)},${Math.floor((part.positions[v * 3 + 1] - origin[1]) / cell)},${Math.floor((part.positions[v * 3 + 2] - origin[2]) / cell)}`;
      let id = keys.get(key);
      if (id === undefined) { id = members.length; keys.set(key, id); members.push([]); }
      into[v] = id;
      members[id].push(v);
    }
    const n = members.length;
    const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
    const skinIndices = new Uint16Array(n * 4), skinWeights = new Float32Array(n * 4);
    members.forEach((list, id) => {
      // the place is the middle of the vertices of the cell, the rest is the first one's
      let x = 0, y = 0, z = 0;
      for (const v of list) { x += part.positions[v * 3]; y += part.positions[v * 3 + 1]; z += part.positions[v * 3 + 2]; }
      positions.set([x / list.length, y / list.length, z / list.length], id * 3);
      const first = list[0];
      normals.set(part.normals.subarray(first * 3, first * 3 + 3), id * 3);
      uvs.set(part.uvs.subarray(first * 2, first * 2 + 2), id * 2);
      skinIndices.set(part.skinIndices.subarray(first * 4, first * 4 + 4), id * 4);
      skinWeights.set(part.skinWeights.subarray(first * 4, first * 4 + 4), id * 4);
    });
    const indices: number[] = [];
    const seen = new Set<string>();
    for (let t = 0; t + 2 < part.indices.length; t += 3) {
      const a = into[part.indices[t]], b = into[part.indices[t + 1]], c = into[part.indices[t + 2]];
      if (a === b || b === c || a === c) continue;
      // the same three cells twice (the two sides of a thin fold) are one triangle
      const key = [a, b, c].sort((p, q) => p - q).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      indices.push(a, b, c);
    }
    return { ...part, positions, normals, uvs, indices: Uint32Array.from(indices), skinIndices, skinWeights, sources: undefined };
  });
}

/** A part that collapsed to nothing keeps its first triangle as it was, so its material stays in the model. */
function keepOneTriangle(part: ImportedPart): ImportedPart {
  const ids = [part.indices[0], part.indices[1], part.indices[2]];
  const pick = <T extends Float32Array | Uint16Array>(array: T, size: number): T => {
    const out = new (array.constructor as new (n: number) => T)(ids.length * size);
    ids.forEach((v, i) => out.set(array.subarray(v * size, v * size + size), i * size));
    return out;
  };
  return { ...part, positions: pick(part.positions, 3), normals: pick(part.normals, 3), uvs: pick(part.uvs, 2), skinIndices: pick(part.skinIndices, 4), skinWeights: pick(part.skinWeights, 4), indices: Uint32Array.from([0, 1, 2]), sources: undefined };
}
