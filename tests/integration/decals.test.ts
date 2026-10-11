import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BloodDecals, parseSubrect, type DecalAssets } from "../../src/viewer/particles/decals";
import { containsAscii } from "../../src/viewer/particles/assets";

const assets = (): DecalAssets => ({
  atlas: { width: 64, height: 32, rgba: new Uint8Array(64 * 32 * 4).fill(128) },
  variants: [{ x: 0, y: 0, w: 16, h: 16, scale: 0.25 }, { x: 16, y: 0, w: 32, h: 16, scale: 0.5 }],
});
const fixed = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

test("a Subrect material's position, size and decal scale are read", () => {
  assert.deepEqual(parseSubrect({ "$pos": "384 128", "$size": "128 128", "$decalscale": "0.25" }), { x: 384, y: 128, w: 128, h: 128, scale: 0.25 });
  assert.deepEqual(parseSubrect({ "$pos": "[10 20]", "$size": "8 4" }), { x: 10, y: 20, w: 8, h: 4, scale: 1 });
  assert.equal(parseSubrect({ "$size": "128 128" }), null);
  assert.equal(parseSubrect({ "$pos": "0 0", "$size": "0 128" }), null);
});

test("a decal lies on the surface, a little above it, sized by its sub-rectangle and decal scale", async () => {
  const decals = new BloodDecals(async () => assets(), fixed(0, 0.25), 10);
  await decals.ready;
  decals.add(new THREE.Vector3(10, 20, 5));
  assert.equal(decals.count, 1);
  const mesh = decals.group.children[0] as THREE.Mesh;
  assert.equal(mesh.scale.x, 4);
  assert.equal(mesh.scale.y, 4);
  assert.ok(Math.abs(mesh.position.x - 10) < 1e-9 && Math.abs(mesh.position.y - 20) < 1e-9 && mesh.position.z > 5 && mesh.position.z < 5.5);
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
  assert.ok(facing.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-9, "a floor decal faces up");
  decals.add(new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
  const wall = decals.group.children[1] as THREE.Mesh;
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(wall.quaternion).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-9, "a wall decal faces along the wall's normal");
});

test("the oldest decal is reused after the limit, and decals asked for before the atlas arrives appear when it does", async () => {
  let release: (a: DecalAssets) => void = () => {};
  const decals = new BloodDecals(() => new Promise<DecalAssets>((resolve) => (release = resolve)), fixed(0), 3);
  decals.add(new THREE.Vector3(1, 0, 0));
  decals.add(new THREE.Vector3(2, 0, 0));
  assert.equal(decals.count, 0, "nothing to draw yet");
  release(assets());
  await decals.ready;
  assert.equal(decals.count, 2);
  decals.add(new THREE.Vector3(3, 0, 0));
  decals.add(new THREE.Vector3(4, 0, 0));
  assert.equal(decals.count, 3, "capped");
  const xs = decals.group.children.map((m) => Math.round(m.position.x));
  assert.deepEqual(xs.sort(), [2, 3, 4], "the first one gave way to the fourth");
});

test("disposing leaves nothing in the scene and ignores later decals", async () => {
  const scene = new THREE.Scene(), decals = new BloodDecals(async () => assets(), fixed(0), 3);
  scene.add(decals.group);
  await decals.ready;
  decals.add(new THREE.Vector3());
  decals.dispose();
  assert.equal(scene.children.length, 0);
  decals.add(new THREE.Vector3());
  assert.equal(decals.count, 0);
});

test("the blood splat marker is found in a model's bytes", () => {
  const bytes = new TextEncoder().encode("junk world_interactions { \"onworldimpact\" \"bloodsplat\" } more");
  assert.equal(containsAscii(bytes, "bloodsplat"), true);
  assert.equal(containsAscii(new TextEncoder().encode("bloodsplash blood splat"), "bloodsplat"), false);
  assert.equal(containsAscii(new Uint8Array(), "bloodsplat"), false);
});
