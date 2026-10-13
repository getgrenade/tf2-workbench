import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import type { ImportedModel, ImportedPart } from "./fbx";
import { writeSmd } from "./smd";

/**
 * The collision model of a prop, made from its mesh: the convex hull of everything the model is made of (a crate, a barrel, a lamp post:
 * one solid piece, which is what a physics prop wants), or the box around it. Written as the .smd of one convex piece that studiomdl takes as a
 * `$collisionmodel`. A prop that is not convex (a chair) can be given a collision model of its own, or compiled with `$concave`.
 */

export type CollisionMode = "none" | "hull" | "box" | "file";

/** The most points the hull is built from (a model of many thousands of vertices gives the same hull, much faster, from an even sample). */
const MAX_POINTS = 4000;

const BONE = "static_prop";

/** The points the collision of a model comes from: its vertices (an even sample when there are many). */
export function modelPoints(model: ImportedModel): THREE.Vector3[] {
  const all: THREE.Vector3[] = [];
  for (const part of model.parts) for (let i = 0; i < part.positions.length; i += 3) all.push(new THREE.Vector3(part.positions[i], part.positions[i + 1], part.positions[i + 2]));
  if (all.length <= MAX_POINTS) return all;
  const step = all.length / MAX_POINTS;
  return Array.from({ length: MAX_POINTS }, (_, i) => all[Math.floor(i * step)]);
}

/** The eight corners of the box around some points. */
export function boxPoints(points: readonly THREE.Vector3[]): THREE.Vector3[] {
  const box = new THREE.Box3().setFromPoints(points as THREE.Vector3[]);
  if (box.isEmpty()) return [];
  const out: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/** The faces of the convex hull of some points, as an indexed mesh with a normal for each face (three or more points that are not flat). */
export function hullMesh(points: readonly THREE.Vector3[]): ImportedPart | null {
  if (points.length < 4) return null;
  let hull: ConvexHull;
  try { hull = new ConvexHull().setFromPoints(points as THREE.Vector3[]); } catch { return null; }
  const positions: number[] = [], normals: number[] = [];
  for (const face of hull.faces) {
    const corners: THREE.Vector3[] = [];
    let edge = face.edge;
    do { corners.push(edge.head().point); edge = edge.next; } while (edge !== face.edge);
    for (let k = 1; k + 1 < corners.length; k++) {
      for (const c of [corners[0], corners[k], corners[k + 1]]) { positions.push(c.x, c.y, c.z); normals.push(face.normal.x, face.normal.y, face.normal.z); }
    }
  }
  if (!positions.length) return null;
  const count = positions.length / 3;
  const indices = Uint32Array.from({ length: count }, (_, i) => i);
  const part: ImportedPart = {
    material: "phys", positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: new Float32Array(count * 2), indices,
    boneNames: [BONE], skinIndices: new Uint16Array(count * 4), skinWeights: Float32Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), winding: 1,
  };
  return part;
}

/** The .smd of the collision model of a model, or null when there is nothing to make it of. */
export function collisionSmd(model: ImportedModel, mode: "hull" | "box"): string | null {
  const points = modelPoints(model);
  const part = hullMesh(mode === "box" ? boxPoints(points) : points);
  if (!part) return null;
  const hullModel: ImportedModel = {
    parts: [part], skeleton: [{ name: BONE, parent: null, world: new THREE.Matrix4().toArray() }], materials: ["phys"],
    triangles: part.indices.length / 3, vertices: part.positions.length / 3, bounds: model.bounds, axes: model.axes,
  };
  return writeSmd(hullModel, () => "phys", BONE);
}
