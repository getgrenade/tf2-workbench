/** Small mesh helpers the compiler needs: welding, tangents and the winding of a mesh against its normals. */

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: ArrayLike<number>;
}

/**
 * +1 when the triangles' geometric normals mostly agree with the vertex normals, -1 when they mostly oppose them (the faces are wound the
 * other way). A mesh authored by one tool and one authored by another may disagree, so an imported mesh is compared with the game's own.
 */
export function windingSign({ positions: p, normals: n, indices }: Pick<MeshArrays, "positions" | "normals" | "indices">, sample = 4000): number {
  const triangles = Math.floor(indices.length / 3), step = Math.max(1, Math.floor(triangles / sample));
  let agree = 0, oppose = 0;
  for (let t = 0; t < triangles; t += step) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const gx = e1y * e2z - e1z * e2y, gy = e1z * e2x - e1x * e2z, gz = e1x * e2y - e1y * e2x;
    const d = gx * (n[a] + n[b] + n[c]) + gy * (n[a + 1] + n[b + 1] + n[c + 1]) + gz * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (d > 0) agree++; else if (d < 0) oppose++;
  }
  return oppose > agree ? -1 : 1;
}

/** Flips the winding of every triangle. */
export function flipWinding(indices: Uint32Array) {
  for (let i = 0; i + 2 < indices.length; i += 3) { const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t; }
}

/** Per-vertex tangents (xyz plus the bitangent sign in w) from the UV gradient, Gram-Schmidt against the normal. */
export function computeTangents({ positions: p, normals: n, uvs: uv, indices }: MeshArrays): Float32Array {
  const count = p.length / 3;
  const tan = new Float32Array(count * 3), bit = new Float32Array(count * 3);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const x1 = p[i1 * 3] - p[i0 * 3], y1 = p[i1 * 3 + 1] - p[i0 * 3 + 1], z1 = p[i1 * 3 + 2] - p[i0 * 3 + 2];
    const x2 = p[i2 * 3] - p[i0 * 3], y2 = p[i2 * 3 + 1] - p[i0 * 3 + 1], z2 = p[i2 * 3 + 2] - p[i0 * 3 + 2];
    const s1 = uv[i1 * 2] - uv[i0 * 2], t1 = uv[i1 * 2 + 1] - uv[i0 * 2 + 1];
    const s2 = uv[i2 * 2] - uv[i0 * 2], t2 = uv[i2 * 2 + 1] - uv[i0 * 2 + 1];
    const det = s1 * t2 - s2 * t1;
    if (Math.abs(det) < 1e-12) continue;
    const r = 1 / det;
    const tx = (t2 * x1 - t1 * x2) * r, ty = (t2 * y1 - t1 * y2) * r, tz = (t2 * z1 - t1 * z2) * r;
    const bx = (s1 * x2 - s2 * x1) * r, by = (s1 * y2 - s2 * y1) * r, bz = (s1 * z2 - s2 * z1) * r;
    for (const i of [i0, i1, i2]) {
      tan[i * 3] += tx; tan[i * 3 + 1] += ty; tan[i * 3 + 2] += tz;
      bit[i * 3] += bx; bit[i * 3 + 1] += by; bit[i * 3 + 2] += bz;
    }
  }
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const nx = n[i * 3], ny = n[i * 3 + 1], nz = n[i * 3 + 2];
    let tx = tan[i * 3], ty = tan[i * 3 + 1], tz = tan[i * 3 + 2];
    const d = nx * tx + ny * ty + nz * tz;
    tx -= nx * d; ty -= ny * d; tz -= nz * d;
    let len = Math.hypot(tx, ty, tz);
    if (len < 1e-9) {
      // no usable UV gradient: any vector perpendicular to the normal
      if (Math.abs(nx) < 0.9) { tx = 0; ty = -nz; tz = ny; } else { tx = nz; ty = 0; tz = -nx; }
      len = Math.hypot(tx, ty, tz) || 1;
    }
    tx /= len; ty /= len; tz /= len;
    // the bitangent sign: does (n x t) point along the accumulated bitangent?
    const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx;
    const sign = cx * bit[i * 3] + cy * bit[i * 3 + 1] + cz * bit[i * 3 + 2] < 0 ? -1 : 1;
    out[i * 4] = tx; out[i * 4 + 1] = ty; out[i * 4 + 2] = tz; out[i * 4 + 3] = sign;
  }
  return out;
}

/** Unit vertex normals from the faces, for a mesh that came without any. */
export function computeNormals(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    const x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x;
    for (const i of [a, b, c]) { normals[i] += x; normals[i + 1] += y; normals[i + 2] += z; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}
