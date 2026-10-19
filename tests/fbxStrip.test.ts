// Taking the armature node out of an FBX by editing the file.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { importFbx } from "../src/compiler/fbx.ts";
import { importModel } from "../src/compiler/importModel.ts";
import { writeFbx } from "../src/compiler/fbxWrite.ts";
import { stripArmatures, turnBones } from "../src/compiler/fbxStrip.ts";
import * as THREE from "three";
import { turnMatrix, turnedWorld } from "../src/compiler/boneAxes.ts";

const sample = () => {
  const lines = ["version 1", "nodes", '  0 "bip_head" -1', '  1 "prop_bone" 0', "end", "skeleton", "time 0", "  0 0 0 0 0 0 0", "  1 0 0 5 0 0 0", "end", "triangles"];
  const v = (x: number, y: number, bone: number) => `  ${bone}  ${x} 0 ${y}  0 1 0  ${x} ${y}  1 ${bone} 1.0`;
  lines.push("m", v(0, 0, 0), v(1, 0, 1), v(0, 1, 0), "end", "");
  return importModel("hat.smd", new TextEncoder().encode(lines.join("\n")).buffer as ArrayBuffer);
};
const asBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

test("the armature node is taken out and the rest of the file is as it was: bones, skin, shape keys", () => {
  const model = sample();
  model.flexes = [{ name: "lift", part: Uint16Array.from([0]), vertex: Uint32Array.from([1]), delta: Float32Array.from([0, 1, 0]) }];
  const original = asBuffer(writeFbx(model, {}, { armature: "hat_ARM" }));
  const before = importFbx(original);
  assert.deepEqual(before.armatures, ["hat_ARM"]);
  const stripped = stripArmatures(original)!;
  assert.deepEqual(stripped.removed, ["hat_ARM"]);
  const after = importFbx(asBuffer(stripped.bytes));
  assert.equal(after.armatures, undefined);
  assert.deepEqual(after.skeleton.map((b) => [b.name, b.parent]), before.skeleton.map((b) => [b.name, b.parent]));
  before.skeleton.forEach((b, i) => b.world.forEach((x, k) => assert.ok(Math.abs(x - after.skeleton[i].world[k]) < 1e-6)));
  assert.equal(after.triangles, before.triangles);
  assert.deepEqual(after.flexes?.map((f) => f.name), ["lift"]);
  assert.deepEqual(after.parts[0].boneNames, before.parts[0].boneNames);
  // the file loses only the node (and what hangs on it)
  assert.ok(stripped.bytes.length < original.byteLength);
  // a file with no armature node has nothing to take out
  assert.equal(stripArmatures(asBuffer(stripped.bytes)), null);
});

test("a file that is not a binary FBX, or is too new to edit, is refused", () => {
  assert.throws(() => stripArmatures(new ArrayBuffer(100)), /not a binary FBX/);
  const bytes = writeFbx(sample());
  new DataView(bytes.buffer).setUint32(23, 7700, true);
  assert.throws(() => stripArmatures(asBuffer(bytes)), /64-bit/);
});

// a file Blender wrote, whose armature object is turned by -90 degrees about X (the bones and the mesh must stay where they were)
const BLENDER = "C:/Projects/Auto_LoD/assets/scoutbiker_vest_lod0.fbx";
test("an armature node with a transform passes it on to its bones (a file of Blender's)", { skip: !fs.existsSync(BLENDER) }, () => {
  const file = fs.readFileSync(BLENDER);
  const original = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  const before = importFbx(original), after = importFbx(asBuffer(stripArmatures(original)!.bytes));
  assert.equal(after.armatures, undefined);
  const at = new Map(after.skeleton.map((b) => [b.name, b]));
  for (const b of before.skeleton) b.world.forEach((x, k) => assert.ok(Math.abs(x - at.get(b.name)!.world[k]) < 1e-4, `${b.name} stays where it was`));
  assert.deepEqual(after.bounds, before.bounds);
});

// the importer names a material by the file of its diffuse texture, or by its own name when it has none (a file of Blender's that has both)
const HAIR = "C:/WORK/tf2/hw26/scout_biker/mesh/scoutbiker_hair_lod0.fbx";
test("the materials of an FBX go by the names the importer gives them, in its order", { skip: !fs.existsSync(HAIR) }, () => {
  const file = fs.readFileSync(HAIR);
  const model = importFbx(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  assert.deepEqual(model.materials, ["A_scoutbiker_hair", "Z_scoutbiker_hair_diffuse"]);
});

test("a file whose materials are not in the order the importer lists them says so", () => {
  const model = sample();
  const [part] = model.parts;
  const other = { ...part, material: "a_hat" };
  const first = { ...part, material: "z_glass" };
  const written = writeFbx({ ...model, parts: [first, other], materials: ["z_glass", "a_hat"] });
  const back = importFbx(asBuffer(written));
  assert.deepEqual(back.materials, ["a_hat", "z_glass"]);
  assert.deepEqual(back.fileMaterialOrder, ["z_glass", "a_hat"]);
  const inOrder = importFbx(asBuffer(writeFbx({ ...model, parts: [other, first], materials: ["a_hat", "z_glass"] })));
  assert.equal(inOrder.fileMaterialOrder, undefined);
});

test("turning a bone in the file turns its axes and nothing else: its children, the mesh and the skin stay where they were", () => {
  const model = sample();
  const turn: [number, number, number] = [30, -20, 45];
  const out = turnBones(asBuffer(writeFbx(model)), { bip_head: turnMatrix(turn) })!;
  const back = importFbx(asBuffer(out));
  const world = (m: typeof model, name: string) => new THREE.Matrix4().fromArray(m.skeleton.find((b) => b.name === name)!.world);
  const far = (a: THREE.Matrix4, b: THREE.Matrix4) => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
  assert.ok(far(world(back, "bip_head"), turnedWorld(world(model, "bip_head"), turn)) < 1e-4, "the bone is turned");
  assert.ok(far(world(back, "prop_bone"), world(model, "prop_bone")) < 1e-4, "its child stays");
  assert.deepEqual(Array.from(back.parts[0].positions, (v) => +v.toFixed(4)), Array.from(model.parts[0].positions, (v) => +v.toFixed(4)));
  assert.equal(turnBones(asBuffer(writeFbx(model)), { not_a_bone: turnMatrix(turn) }), null, "nothing to turn");
});

test("read strictly, as the item importer reads it, a file's axis settings are ignored; read leniently, they turn the model", async () => {
  const { editFbx } = await import("../src/compiler/fbxStrip.ts");
  const model = sample();
  const plain = writeFbx(model);
  const zUp = editFbx(asBuffer(plain), (top) => {
    const settings = (top.find((n) => n.name === "GlobalSettings")!.children as { name: string; children: { name: string; props: { t: string; v: unknown }[] }[] }[]).find((c) => c.name === "Properties70")!;
    const set = (key: string, v: number) => { const p = settings.children.find((c) => c.name === "P" && new TextDecoder().decode(c.props[0].v as Uint8Array) === key)!; p.props[4] = { t: "I", v }; };
    set("UpAxis", 2); set("FrontAxis", 1); set("FrontAxisSign", -1);
  });
  const positions = (m: ReturnType<typeof importFbx>) => Array.from(m.parts[0].positions, (v) => +v.toFixed(4));
  assert.deepEqual(positions(importFbx(asBuffer(zUp), { strict: true })), positions(importFbx(asBuffer(plain), { strict: true })), "strict: as if the settings were not there");
  assert.notDeepEqual(positions(importFbx(asBuffer(zUp))), positions(importFbx(asBuffer(plain))), "lenient: the settings turn it");
});
