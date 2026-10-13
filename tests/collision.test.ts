// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { boxPoints, collisionSmd, hullMesh } from "../src/compiler/collision.ts";
import type { ImportedModel } from "../src/compiler/fbx.ts";

/** A model whose vertices are the corners of a cube, plus some inside it. */
function cube(): ImportedModel {
  const pts: number[] = [];
  for (const x of [0, 10]) for (const y of [0, 10]) for (const z of [0, 10]) pts.push(x, y, z);
  pts.push(5, 5, 5, 3, 4, 6, 7, 2, 8);
  const count = pts.length / 3;
  return {
    parts: [{ material: "m", positions: Float32Array.from(pts), normals: new Float32Array(count * 3), uvs: new Float32Array(count * 2), indices: Uint32Array.from([0, 1, 2]), boneNames: [""], skinIndices: new Uint16Array(count * 4), skinWeights: new Float32Array(count * 4), winding: 1 }],
    skeleton: [], materials: ["m"], triangles: 1, vertices: count, bounds: { min: [0, 0, 0], max: [10, 10, 10] }, axes: { right: [1, 0, 0], up: [0, 1, 0], front: [0, 0, 1] },
  };
}

test("the hull of a cube's points is its twelve triangles; the points inside do not matter", () => {
  const model = cube();
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < model.parts[0].positions.length; i += 3) points.push(new THREE.Vector3(model.parts[0].positions[i], model.parts[0].positions[i + 1], model.parts[0].positions[i + 2]));
  const hull = hullMesh(points)!;
  assert.equal(hull.indices.length / 3, 12);
  assert.equal(hullMesh(points.slice(0, 3)), null);
  assert.equal(boxPoints(points).length, 8);
});

test("the collision .smd has one bone and the triangles of the hull", () => {
  const smd = collisionSmd(cube(), "hull")!;
  assert.match(smd, /0 "static_prop" -1/);
  assert.equal(smd.split("\nphys\n").length - 1 + (smd.includes("triangles\nphys\n") ? 1 : 0) >= 12, true);
  assert.equal(collisionSmd(cube(), "box")!.split("phys").length - 1, 12);
  const empty = cube();
  empty.parts = [];
  assert.equal(collisionSmd(empty, "hull"), null);
});
