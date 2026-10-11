import * as THREE from "three";
import type { MeshData } from "./payload";

/**
 * Shares GPU geometry between the entities that show the same model: ten Soldiers upload (and keep) one set of vertex
 * buffers. Flexed meshes are not shared, their vertices are rewritten per entity. Entries are reference counted and the
 * buffers are freed when the last user lets go.
 */
export class GeometryCache {
  private entries = new Map<MeshData, { geo: THREE.BufferGeometry; refs: number }>();

  *cachedGeometries() { for (const entry of this.entries.values()) yield entry.geo; }

  acquire(m: MeshData): THREE.BufferGeometry {
    let e = this.entries.get(m);
    if (!e) {
      e = { geo: buildGeometry(m, false).geo, refs: 0 };
      this.entries.set(m, e);
    }
    e.refs++;
    return e.geo;
  }

  release(m: MeshData) {
    const e = this.entries.get(m);
    if (!e || --e.refs > 0) return;
    e.geo.dispose();
    this.entries.delete(m);
  }
}

/** The geometry of an MDL mesh. With `flexed` the position / normal attributes are private, writable copies. */
export function buildGeometry(m: MeshData, flexed: boolean): { geo: THREE.BufferGeometry; position: THREE.BufferAttribute; normal: THREE.BufferAttribute } {
  const geo = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(flexed ? new Float32Array(m.positions) : m.positions, 3);
  const normal = new THREE.BufferAttribute(flexed ? new Float32Array(m.normals) : m.normals, 3);
  if (flexed) {
    position.setUsage(THREE.DynamicDrawUsage);
    normal.setUsage(THREE.DynamicDrawUsage);
  }
  geo.setAttribute("position", position);
  geo.setAttribute("normal", normal);
  geo.setAttribute("uv", new THREE.BufferAttribute(m.uvs, 2));
  geo.setAttribute("tangent", new THREE.BufferAttribute(m.tangents, 4));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(m.skinIndices, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(m.skinWeights, 4));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return { geo, position, normal };
}
