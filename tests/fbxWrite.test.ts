// A model written out as an FBX and read back: the same mesh and skin, with the turned axes of a bone in it.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { importFbx } from "../src/compiler/fbx.ts";
import { writeFbx } from "../src/compiler/fbxWrite.ts";
import { importModel } from "../src/compiler/importModel.ts";

const SMD = [
  "version 1", "nodes", '  0 "bip_pelvis" -1', '  1 "tail_bone" 0', "end", "skeleton", "time 0", "  0 0 0 0 0 0 0", "  1 0 10 0 0 0 0", "end", "triangles",
  "small", "  1  0 10 0  0 0 1  0 0  1 1 1.0", "  1  5 10 0  0 0 1  1 0  1 1 1.0", "  0  0 10 5  0 0 1  0 1  1 0 1.0",
  "small", "  1  5 10 0  0 0 1  1 0  1 1 1.0", "  1  5 10 5  0 0 1  1 1  2 1 0.75 0 0.25", "  0  0 10 5  0 0 1  0 1  1 0 1.0",
  "end", "",
].join("\n");

const read = () => importModel("hat.smd", new TextEncoder().encode(SMD).buffer as ArrayBuffer);

test("a model written as an FBX comes back with its mesh, its skin and the skeleton", () => {
  const model = read();
  const back = importFbx(writeFbx(model).buffer as ArrayBuffer);
  assert.equal(back.triangles, model.triangles);
  assert.equal(back.parts.length, model.parts.length);
  assert.deepEqual(back.materials, model.materials);
  // the same places
  const places = (m: typeof model) => [...m.parts[0].positions].map((v) => +v.toFixed(3)).sort((a, b) => a - b);
  assert.deepEqual(places(back), places(model));
  // the same bones with the same worlds
  for (const bone of model.skeleton) {
    const got = back.skeleton.find((b) => b.name === bone.name)!;
    assert.ok(got, `bone ${bone.name}`);
    assert.equal(got.parent, bone.parent);
    got.world.forEach((v, i) => assert.ok(Math.abs(v - bone.world[i]) < 1e-3, `${bone.name} world ${i}: ${v} vs ${bone.world[i]}`));
  }
  // the skin: every vertex weighted to the bones it was
  const weights = (m: typeof model) => {
    const part = m.parts[0];
    const out: string[] = [];
    for (let v = 0; v < part.positions.length / 3; v++) {
      const links: string[] = [];
      for (let k = 0; k < 4; k++) if (part.skinWeights[v * 4 + k] > 1e-5) links.push(`${part.boneNames[part.skinIndices[v * 4 + k]]}:${part.skinWeights[v * 4 + k].toFixed(2)}`);
      out.push(`${[...part.positions.slice(v * 3, v * 3 + 3)].map((x) => x.toFixed(1)).join(",")}=${links.sort().join("+")}`);
    }
    return out.sort();
  };
  assert.deepEqual(weights(back), weights(model));
});

test("the turned axes of a bone are in the written file, and nothing moves", () => {
  const model = read();
  const turned = importFbx(writeFbx(model, { tail_bone: [0, 0, 90] }).buffer as ArrayBuffer);
  const was = new THREE.Matrix4().fromArray(model.skeleton.find((b) => b.name === "tail_bone")!.world);
  const now = new THREE.Matrix4().fromArray(turned.skeleton.find((b) => b.name === "tail_bone")!.world);
  // the same place, another orientation: x of the bone now points where y did
  assert.ok(now.elements[12] === was.elements[12] || Math.abs(now.elements[12] - was.elements[12]) < 1e-4);
  assert.ok(Math.abs(now.elements[13] - was.elements[13]) < 1e-4);
  const expected = was.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  expected.elements.forEach((v, i) => assert.ok(Math.abs(v - now.elements[i]) < 1e-3, `element ${i}: ${now.elements[i]} vs ${v}`));
  // the mesh did not move
  assert.deepEqual([...turned.parts[0].positions].map((v) => +v.toFixed(3)).sort((a, b) => a - b), [...model.parts[0].positions].map((v) => +v.toFixed(3)).sort((a, b) => a - b));
});

test("a model with shape keys is written with them: the same keys come back", () => {
  const model = read();
  const flexes = [{ name: "lift", part: Uint16Array.from([0]), vertex: Uint32Array.from([0]), delta: Float32Array.from([0, 1, 0]) }];
  const back = importFbx(writeFbx({ ...model, flexes }).buffer as ArrayBuffer);
  assert.deepEqual(back.flexes?.map((f) => f.name), ["lift"]);
  assert.ok((back.flexes?.[0].part.length ?? 0) >= 1);
  assert.deepEqual(Array.from(back.flexes![0].delta.slice(0, 3)).map((x) => Math.round(x * 1000) / 1000), [0, 1, 0]);
});

test("a mesh-only file (a LOD) has the mesh and its materials and no skeleton", () => {
  const model = read();
  const lod = importFbx(writeFbx(model, {}, { skeleton: false }).buffer as ArrayBuffer);
  assert.equal(lod.skeleton.length, 0);
  assert.equal(lod.triangles, model.triangles);
  assert.deepEqual(lod.materials, model.materials);
});

test("several materials are one mesh with a slot for each", () => {
  const model = read();
  const second = { ...model.parts[0], material: "other" };
  const two = { ...model, parts: [model.parts[0], second], materials: ["small", "other"], triangles: model.triangles * 2 };
  const back = importFbx(writeFbx(two, {}, { skeleton: false }).buffer as ArrayBuffer);
  assert.deepEqual(back.materials.slice().sort(), ["other", "small"]);
  assert.equal(back.triangles, two.triangles);
  assert.deepEqual(back.parts.map((p) => p.indices.length / 3), [model.triangles, model.triangles]);
});

test("a node that no connection mentions does not stop the file from being read", async () => {
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  const model = read();
  const bytes = writeFbx(model, {}, { orphanNull: "armature" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // the loader alone trips on it (that is what the file of an export with a loose armature node did)
  assert.throws(() => new FBXLoader().parse(buffer, ""), /parents/);
  const back = importFbx(buffer);
  assert.equal(back.triangles, model.triangles);
  assert.equal(back.skeleton.length, model.skeleton.length);
  // the file after it (the footer and the nodes behind the connections) still lines up
  assert.deepEqual(back.materials, model.materials);
});

test("a file with nothing loose is left as it is", async () => {
  const { connectOrphanModels } = await import("../src/compiler/fbxRepair.ts");
  const bytes = writeFbx(read());
  assert.equal(connectOrphanModels(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), null);
  assert.equal(connectOrphanModels(new TextEncoder().encode("not an fbx").buffer as ArrayBuffer), null);
});

test("animation curves on a property the loader does not know are dropped, not fatal", async (t) => {
  const { dropAnimationCurves } = await import("../src/compiler/fbxRepair.ts");
  const bytes = writeFbx(read());
  assert.equal(dropAnimationCurves(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), null);
  assert.equal(dropAnimationCurves(new TextEncoder().encode("not an fbx").buffer as ArrayBuffer), null);
  // (an export of a hat with a custom property that is animated: only where the file is on this machine)
  const path = "C:/Users/getgr/Downloads/bars_medichat_lod0.fbx";
  const fs = await import("node:fs");
  if (!fs.existsSync(path)) return t.skip("the file is not here");
  const file = fs.readFileSync(path);
  assert.equal(importFbx(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer).parts.length, 2);
});
