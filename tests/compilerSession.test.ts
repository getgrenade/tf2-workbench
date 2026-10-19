// The item compiler's session: files that could not be read.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { importModel } from "../src/compiler/importModel.ts";
import { transferSkin } from "../src/compiler/skinTransfer.ts";
import { applyBoneRemap, boneRemap, lodCommandLines, lodCommands } from "../src/compiler/lodBones.ts";
import { CompilerSession, TRIANGLE_BUDGET, blankMaterial, type SessionIo } from "../src/compiler/session.ts";

function io(files: Record<string, ArrayBuffer>): SessionIo {
  return {
    read: async (p) => { const f = files[p]; if (!f) throw new Error(`no ${p}`); return f; },
    stamp: async (p) => (files[p] ? 1 : null),
    siblings: async () => [],
    gameTexture: async () => null,
  };
}

test("an error about a file goes when the file is swapped for another, and the missing ones can be dropped", async () => {
  const s = new CompilerSession(io({}));
  s.data.smartFill = false;
  await s.setLod("sniper", 0, "C:/art/gone.fbx");
  assert.deepEqual(s.failedPaths(), ["C:/art/gone.fbx"]);
  assert.ok(s.issues().some((i) => i.key === "file:C:/art/gone.fbx"));
  await s.setLod("sniper", 0, "");
  assert.deepEqual(s.failedPaths(), []);
  assert.ok(!s.issues().some((i) => i.key.startsWith("file:")), "the file is not the item's any more");
  // a saved item whose files are all gone: one call clears the lot
  s.data.classes.sniper = ["C:/a/one.fbx", "C:/a/two.fbx", ""];
  s.data.icon = "C:/a/icon.tga";
  s.data.materials.m = { ...blankMaterial(), color: "C:/a/color.tga", normal: "C:/a/normal.tga" };
  await s.loadAll();
  assert.equal(s.failedPaths().length, 5);
  s.dropFailed();
  assert.deepEqual(s.failedPaths(), []);
  assert.deepEqual(s.data.classes, {});
  assert.equal(s.data.icon, "");
  assert.equal(s.data.materials.m.color, "");
  assert.ok(!s.issues().some((i) => i.key.startsWith("file:")));
});

/** A flat grid of n x n squares (two triangles each) in the material, and one single triangle in a second material, as an .smd. */
function gridSmd(n: number): ArrayBuffer {
  const lines = ["version 1", "nodes", '  0 "bip_head" -1', "end", "skeleton", "time 0", "  0 0 0 0 0 0 0", "end", "triangles"];
  const v = (x: number, y: number) => `  0  ${x} 0 ${y}  0 1 0  ${x / n} ${y / n}  1 0 1.0`;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    lines.push("big", v(i, j), v(i + 1, j), v(i, j + 1), "big", v(i + 1, j), v(i + 1, j + 1), v(i, j + 1));
  }
  lines.push("small", v(0, 0), v(1, 0), v(0, 1), "end", "");
  return new TextEncoder().encode(lines.join("\n")).buffer as ArrayBuffer;
}

test("temporary LODs fit the budgets and keep every material, and go into the build like real ones", async () => {
  const files = { "C:/art/hat.smd": gridSmd(40) }; // 3200 + 1 triangles
  const s = new CompilerSession(io(files));
  s.data.smartFill = false;
  await s.setLod("sniper", 0, "C:/art/hat.smd");
  assert.equal(s.model("sniper", 1), null);
  assert.ok(s.issues().some((i) => /LOD 0 has \d+ triangles|Add LOD/.test(i.text)), "LOD 0 is over its budget and the last LOD is missing");
  s.data.tempLods = true;
  const lod0 = s.model("sniper", 0)!;
  for (const i of [1, 2]) {
    const lod = s.model("sniper", i)!;
    assert.ok(lod, `LOD ${i} exists`);
    assert.ok(lod.triangles <= TRIANGLE_BUDGET[i], `LOD ${i}: ${lod.triangles} triangles`);
    assert.ok(lod.triangles < s.model("sniper", i - 1)!.triangles, `LOD ${i} is lighter than the one before`);
    assert.deepEqual(lod.materials, lod0.materials);
    assert.equal(lod.parts.length, lod0.parts.length, "every material keeps a part");
    assert.ok(lod.parts.every((p) => p.indices.length >= 3));
    assert.equal(lod.triangles, lod.parts.reduce((n, p) => n + p.indices.length / 3, 0));
    assert.ok(s.isTemp("sniper", i));
  }
  assert.ok(!s.isTemp("sniper", 0));
  assert.ok(!s.issues().some((i) => /^lod[12]/.test(i.key)), JSON.stringify(s.issues().filter((i) => /^lod[12]/.test(i.key))));
  // a LOD that was given stays
  files["C:/art/hat_lod1.smd"] = gridSmd(10);
  await s.setLod("sniper", 1, "C:/art/hat_lod1.smd");
  assert.ok(!s.isTemp("sniper", 1));
  assert.equal(s.model("sniper", 1)!.triangles, 201);
  // saved and restored
  const saved = s.toJSON();
  assert.equal(saved.tempLods, true);
  s.restore(saved);
  assert.equal(s.data.tempLods, true);
});

test("a model already under the budget still gets lighter temporary LODs, with its materials", async () => {
  const s = new CompilerSession(io({ "C:/art/hat.smd": gridSmd(6) }));
  s.data.smartFill = false;
  s.data.tempLods = true;
  await s.setLod("sniper", 0, "C:/art/hat.smd");
  assert.ok(s.model("sniper", 2)!.triangles < s.model("sniper", 0)!.triangles);
  assert.deepEqual(s.model("sniper", 2)!.materials, s.model("sniper", 0)!.materials);
});

test("a LOD without a skin takes the bones and weights of the nearest vertices of LOD 0 for the preview", () => {
  const part = (positions: number[], names: string[], unskinned: boolean) => ({
    material: "m", positions: Float32Array.from(positions), normals: new Float32Array(positions.length), uvs: new Float32Array(positions.length / 3 * 2), indices: Uint32Array.from([0, 1, 1]),
    boneNames: unskinned ? [""] : names, skinIndices: Uint16Array.from(unskinned ? [0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 1, 0, 0, 0]),
    skinWeights: Float32Array.from(unskinned ? [1, 0, 0, 0, 1, 0, 0, 0] : [1, 0, 0, 0, 0.25, 0.75, 0, 0]), winding: 1,
  });
  // the second vertex of LOD 0 is shared between two bones (the second index 0 is bone "a", weight .25 / the first listed .75 goes to index 1... see below)
  const lod0 = { parts: [part([0, 0, 0, 10, 0, 0], ["a", "b"], false)], skeleton: [{ name: "a", parent: null, world: [] }], materials: ["m"], triangles: 1, vertices: 2, bounds: { min: [0, 0, 0], max: [10, 0, 0] }, axes: {} } as never;
  const lod1 = { parts: [part([9, 1, 0, 1, 1, 0], [""], true)], skeleton: [], materials: ["m"], triangles: 1, vertices: 2, bounds: { min: [1, 1, 0], max: [9, 1, 0] }, axes: {} } as never;
  const out = transferSkin(lod0, lod1);
  const p = out.parts[0];
  assert.deepEqual(p.boneNames.slice().sort(), ["a", "b"]);
  // vertex 0 (at x=9) is next to LOD 0's vertex at x=10: its two bones; vertex 1 (at x=1) next to the one at x=0: bone "a" only
  const weightOf = (v: number, name: string) => [0, 1, 2, 3].filter((k) => p.skinWeights[v * 4 + k] > 0 && p.boneNames[p.skinIndices[v * 4 + k]] === name).reduce((s, k) => s + p.skinWeights[v * 4 + k], 0);
  assert.equal(weightOf(0, "a") + weightOf(0, "b"), 1);
  assert.ok(weightOf(0, "b") > 0);
  assert.equal(weightOf(1, "a"), 1);
  assert.equal(weightOf(1, "b"), 0);
  // a LOD that has its own skin is left alone
  assert.equal(transferSkin(lod0, lod0), lod0);
});

/** A model with one part skinned to the named bones, in a skeleton with the given parents. */
function skinnedTo(bones: string[], skeleton: [string, string | null][], flex = false) {
  const n = bones.length;
  const part = {
    material: "m", positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), uvs: new Float32Array(n * 2), indices: Uint32Array.from([0, 0, 0]),
    boneNames: bones, skinIndices: Uint16Array.from(bones.flatMap((_, i) => [i, 0, 0, 0])), skinWeights: Float32Array.from(bones.flatMap(() => [1, 0, 0, 0])), winding: 1,
  };
  return { parts: [part], skeleton: skeleton.map(([name, parent]) => ({ name, parent, world: [] })), materials: ["m"], triangles: 1, vertices: n, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, axes: {}, ...(flex ? { flexes: [{ name: "f" }] } : {}) } as never as import("../src/compiler/fbx.ts").ImportedModel;
}

const HEAVY_SKELETON: [string, string | null][] = [["bip_pelvis", null], ["bip_spine_3", "bip_pelvis"], ["bip_collar_L", "bip_spine_3"], ["bip_hand_L", "bip_collar_L"], ["bip_index_0_L", "bip_hand_L"], ["bip_head", "bip_spine_3"]];

test("a class's bone commands for a LOD are kept when the item's skin uses the bones, and become QC lines", () => {
  const suit = skinnedTo(["bip_pelvis", "bip_collar_L", "bip_index_0_L"], HEAVY_SKELETON);
  const lines2 = lodCommandLines(lodCommands("heavy", 2, [suit]));
  // the class gives up the hand at LOD 2 (the finger hangs on it), the left collar goes to the spine; the head and the right side are not the suit's
  assert.ok(lines2.includes('bonetreecollapse "bip_hand_L"'));
  assert.ok(lines2.includes('replacebone "bip_collar_L" "bip_spine_3"'));
  assert.ok(!lines2.includes('bonetreecollapse "bip_head"'));
  assert.ok(!lines2.some((l) => /_R"/.test(l)));
  // LOD 1 of the heavy only gives up the head and the pack: nothing of the suit's
  assert.deepEqual(lodCommands("heavy", 1, [suit]), []);
  // a collapse takes what hangs below the bone into the bone: a part skinned to the head itself (a hat) is not touched by it, one skinned to a bone under the head is
  assert.deepEqual(lodCommands("heavy", 1, [skinnedTo(["bip_head"], HEAVY_SKELETON)]), []);
  const withTail: [string, string | null][] = [...HEAVY_SKELETON, ["jiggle_bone", "bip_head"]];
  assert.deepEqual(lodCommands("heavy", 1, [skinnedTo(["jiggle_bone"], withTail)]), [["collapse", "bip_head"]]);
  assert.deepEqual(lodCommands("not_a_class", 2, [suit]), []);
});

test("at a LOD the skin of a bone the class gives up goes to the bone it goes to", () => {
  const commands = lodCommands("heavy", 2, [skinnedTo(["bip_collar_L", "bip_index_0_L"], HEAVY_SKELETON)]);
  const remap = boneRemap(commands, HEAVY_SKELETON.map(([name, parent]) => ({ name, parent })));
  assert.equal(remap.get("bip_collar_L"), "bip_spine_3");
  // the finger goes into the hand, which stays (a collapse leaves the bone it names where it is)
  assert.equal(remap.get("bip_hand_L"), undefined);
  assert.equal(remap.get("bip_index_0_L"), "bip_hand_L");
  // a jiggle bone under the head goes into the head, and keeps its place there
  const tail: [string, string | null][] = [...HEAVY_SKELETON, ["jiggle_bone", "bip_head"]];
  const headRemap = boneRemap(lodCommands("heavy", 1, [skinnedTo(["jiggle_bone"], tail)]), tail.map(([name, parent]) => ({ name, parent })));
  assert.equal(headRemap.get("jiggle_bone"), "bip_head");
  assert.equal(headRemap.get("bip_head"), undefined);
  const moved = applyBoneRemap(skinnedTo(["bip_collar_L", "bip_pelvis"], HEAVY_SKELETON), remap);
  assert.deepEqual(moved.parts[0].boneNames, ["bip_spine_3", "bip_pelvis"]);
  assert.equal(applyBoneRemap(skinnedTo(["bip_pelvis"], HEAVY_SKELETON), new Map()).parts[0].boneNames[0], "bip_pelvis");
});

test("the commands of an item go with its class's build, and nofacial with its shape keys", async () => {
  const s = new CompilerSession(io({}));
  s.data.smartFill = false;
  const lod0 = skinnedTo(["bip_collar_L"], HEAVY_SKELETON, false);
  const withFlex = skinnedTo(["bip_collar_L"], HEAVY_SKELETON, true);
  const inject = (model: typeof lod0) => (s as unknown as { models: Map<string, unknown[]> }).models.set("heavy", [{ path: "x", stamp: 1, model }, null, null]);
  inject(lod0);
  assert.deepEqual(s.lodQcCommands("heavy"), [[], ['replacebone "bip_collar_L" "bip_spine_3"']]);
  inject(withFlex);
  assert.deepEqual(s.lodQcCommands("heavy")[1], ['replacebone "bip_collar_L" "bip_spine_3"', "nofacial"]);
  assert.deepEqual(s.lodQcCommands("scout"), [[], []], "a class with no model of the item has none");
});

test("the jiggle blocks written at the end of the session's QC come back when the session is read", async () => {
  const { defaultJiggle, jiggleQc } = await import("../src/compiler/jiggleBones.ts");
  const { parseImportSession } = await import("../src/compiler/importSession.ts");
  const qc = `$upaxis Y\n\n$body "default" "<ITEMTEST_REPLACE_LOD0>"\n\n$sequence "ref" "<ITEMTEST_REPLACE_LOD0>"\n\n${jiggleQc("tail_bone", defaultJiggle(12))}\n`;
  // the importer's text: a quote inside a value is \" and a backslash \\
  const value = qc.split("\\").join("\\\\").split('"').join('\\"');
  const text = ['"data"', "{", '\t"ImportSession"', "\t{", '\t\t"name"\t\t"a_tail"', '\t\t"classes"', "\t\t{", '\t\t\t"heavy"', "\t\t\t{", `\t\t\t\t"QC"\t\t"${value}"`, '\t\t\t\t"LOD0"', "\t\t\t\t{", '\t\t\t\t\t"file"\t\t"C:\\\\art\\\\tail.fbx"', "\t\t\t\t}", "\t\t\t}", "\t\t}", "\t}", "}", ""].join("\n");
  const data = parseImportSession(text);
  assert.ok(data.jiggles.tail_bone, "the jiggle bone is read from the QC");
  assert.equal(data.jiggles.tail_bone.length, 12);
});

test("the adjusted copies are written beside the models, and the item uses them with the turns taken off", async () => {
  const smd = ["version 1", "nodes", '  0 "bip_pelvis" -1', '  1 "tail_bone" 0', "end", "skeleton", "time 0", "  0 0 0 0 0 0 0", "  1 0 10 0 0 0 0", "end", "triangles",
    "small", "  1  0 10 0  0 0 1  0 0  1 1 1.0", "  1  5 10 0  0 0 1  1 0  1 1 1.0", "  0  0 10 5  0 0 1  0 1  1 0 1.0", "end", ""].join("\n");
  const files: Record<string, ArrayBuffer> = { "C:/art/mesh/tail_lod0.smd": new TextEncoder().encode(smd).buffer as ArrayBuffer };
  const s = new CompilerSession(io(files));
  s.data.smartFill = false;
  await s.setLod("sniper", 0, "C:/art/mesh/tail_lod0.smd");
  s.data.turns = { tail_bone: [0, 0, 90] };
  const written: string[] = [];
  const done = await s.exportAdjusted(async (path, bytes) => { written.push(path); files[path] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; });
  assert.deepEqual(done, ["C:/art/mesh/adjusted_tail_lod0.fbx"]);
  assert.deepEqual(written, done);
  assert.equal(s.lods("sniper")[0], "C:/art/mesh/adjusted_tail_lod0.fbx");
  assert.deepEqual(s.data.turns, {});
  const model = s.model("sniper", 0)!;
  assert.ok(model, "the written file reads back");
  assert.equal(model.triangles, 1);
  assert.deepEqual(s.failedPaths(), []);
  // it is not turned twice: the bone of the new file is the original turned once
  const bone = model.skeleton.find((x) => x.name === "tail_bone")!;
  const original = new THREE.Matrix4().fromArray(importModel("x.smd", new TextEncoder().encode(smd).buffer as ArrayBuffer).skeleton.find((x) => x.name === "tail_bone")!.world);
  const expected = original.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  expected.elements.forEach((v, i) => assert.ok(Math.abs(v - bone.world[i]) < 1e-3, `element ${i}`));
});

test("the temporary LODs are written beside LOD 0 as temp_ files that the session file can name and open again", async () => {
  const files: Record<string, ArrayBuffer> = { "C:/art/mesh/hat_lod0.smd": gridSmd(40) };
  const s = new CompilerSession(io(files));
  s.data.smartFill = false;
  s.data.tempLods = true;
  await s.setLod("sniper", 0, "C:/art/mesh/hat_lod0.smd");
  assert.equal(s.tempLodFile("sniper", 1), "");
  const written = await s.writeTempLods(async (path, bytes) => { files[path] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; });
  assert.deepEqual(written, ["C:/art/mesh/temp_hat_lod1.fbx", "C:/art/mesh/temp_hat_lod2.fbx"]);
  assert.equal(s.tempLodFile("sniper", 2), "C:/art/mesh/temp_hat_lod2.fbx");
  // another session opens them as the LODs of the item
  const again = new CompilerSession(io(files));
  again.data.smartFill = false;
  await again.setLod("sniper", 0, "C:/art/mesh/hat_lod0.smd");
  await again.setLod("sniper", 1, written[0]);
  await again.setLod("sniper", 2, written[1]);
  assert.deepEqual(again.failedPaths(), []);
  for (const i of [1, 2]) {
    assert.equal(again.model("sniper", i)!.triangles, s.model("sniper", i)!.triangles);
    assert.deepEqual(again.model("sniper", i)!.materials, s.model("sniper", 0)!.materials);
    assert.ok(again.model("sniper", i)!.triangles <= TRIANGLE_BUDGET[i]);
  }
  // a LOD that has its own file is not written
  s.data.classes.sniper[1] = "C:/art/mesh/own_lod1.smd";
  files["C:/art/mesh/own_lod1.smd"] = gridSmd(10);
  await s.setLod("sniper", 1, "C:/art/mesh/own_lod1.smd");
  assert.deepEqual(await s.writeTempLods(async () => {}), ["C:/art/mesh/temp_hat_lod2.fbx"]);
  assert.equal(s.tempLodFile("sniper", 1), "");
});

test("the temporary LODs are named from the name of LOD 0 without its LOD number", async () => {
  for (const [file, expected] of [["cape_lod0.fbx", "temp_cape_lod1.fbx"], ["cape.fbx", "temp_cape_lod1.fbx"], ["cape-lod0.fbx", "temp_cape_lod1.fbx"], ["cape_lod0_b.fbx", "temp_cape_lod0_b_lod1.fbx"]]) {
    const smd = file.replace(/\.fbx$/, ".smd");
    const s = new CompilerSession(io({ [`C:/m/${smd}`]: gridSmd(40) }));
    s.data.smartFill = false;
    s.data.tempLods = true;
    await s.setLod("sniper", 0, `C:/m/${smd}`);
    const written = await s.writeTempLods(async () => {});
    assert.equal(written[0], `C:/m/${expected}`, file);
  }
});

test("the shape keys of a model are written into an FBX and read back, with the armature node taken out", async () => {
  const { writeFbx } = await import("../src/compiler/fbxWrite.ts");
  const { importFbx } = await import("../src/compiler/fbx.ts");
  const source = importModel("hat.smd", gridSmd(2));
  // two shape keys on vertices of the first part: one moves two vertices, the other one
  source.flexes = [
    { name: "smile", part: Uint16Array.from([0, 0]), vertex: Uint32Array.from([1, 2]), delta: Float32Array.from([0, 0.5, 0, 0.25, 0, 0]) },
    { name: "frown", part: Uint16Array.from([0]), vertex: Uint32Array.from([3]), delta: Float32Array.from([0, 0, -1]) },
  ];
  const bytes = writeFbx(source, {}, { armature: "hat_ARM" });
  const back = importFbx(bytes.slice().buffer as ArrayBuffer);
  assert.deepEqual(back.armatures, ["hat_ARM"]);
  const total = (flex: NonNullable<typeof back.flexes>[number]) => {
    const sum = [0, 0, 0];
    for (let i = 0; i < flex.part.length; i++) for (let k = 0; k < 3; k++) sum[k] += flex.delta[i * 3 + k];
    return { moved: flex.part.length, sum: sum.map((x) => Math.round(x * 1000) / 1000) };
  };
  const named = Object.fromEntries((back.flexes ?? []).map((f) => [f.name, total(f)]));
  assert.deepEqual(Object.keys(named).sort(), ["frown", "smile"]);
  assert.ok(named.smile.moved >= 2 && named.frown.moved >= 1, "every moved vertex is there (a vertex shaded two ways is more than one)");
  assert.deepEqual(named.frown.sum.map((x) => Math.sign(x)), [0, 0, -1]);
  assert.deepEqual(named.smile.sum.map((x) => Math.sign(x)), [1, 1, 0]);
  // the armature is taken out of a file that has shape keys too
  const files: Record<string, ArrayBuffer> = { "C:/art/hat.fbx": bytes.slice().buffer as ArrayBuffer };
  const s = new CompilerSession(io(files));
  s.data.smartFill = false;
  await s.setLod("sniper", 0, "C:/art/hat.fbx");
  const result = await s.removeArmatures(async (path, out) => { files[path] = out.slice().buffer as ArrayBuffer; });
  assert.deepEqual(result.written, ["C:/art/hat.fbx"]);
  assert.equal(s.model("sniper", 0)!.armatures, undefined);
  assert.deepEqual((s.model("sniper", 0)!.flexes ?? []).map((f) => f.name).sort(), ["frown", "smile"]);
});

test("an armature node of an FBX is an extra bone for the importer: it is told of, and taken out of the file in place", async () => {
  const { writeFbx } = await import("../src/compiler/fbxWrite.ts");
  const source = importModel("hat.smd", gridSmd(2));
  const files: Record<string, ArrayBuffer> = { "C:/art/hat.fbx": writeFbx(source, {}, { armature: "sniper_ARM" }).slice().buffer as ArrayBuffer };
  const s = new CompilerSession(io(files));
  s.data.smartFill = false;
  await s.setLod("sniper", 0, "C:/art/hat.fbx");
  assert.deepEqual(s.model("sniper", 0)!.armatures, ["sniper_ARM"]);
  // read as the item importer reads it, the node is a bone (the first); read leniently, it is not
  assert.deepEqual(s.model("sniper", 0)!.skeleton.map((b) => b.name), ["sniper_ARM", "bip_head"], "the importer takes the node for a bone");
  await s.setStrictImporter(false);
  assert.deepEqual(s.model("sniper", 0)!.skeleton.map((b) => b.name), ["bip_head"], "read leniently, the node is no bone");
  await s.setStrictImporter(true);
  assert.ok(s.issues().some((i) => i.key === "armature:C:/art/hat.fbx" && /sniper_ARM/.test(i.text)));
  const result = await s.removeArmatures(async (path, bytes) => { files[path] = bytes.slice().buffer as ArrayBuffer; });
  assert.deepEqual(result.written, ["C:/art/hat.fbx"]);
  assert.deepEqual(result.skipped, []);
  assert.equal(s.model("sniper", 0)!.armatures, undefined);
  assert.deepEqual(s.model("sniper", 0)!.skeleton.map((b) => b.name), ["bip_head"]);
  assert.equal(s.model("sniper", 0)!.triangles, source.triangles, "the mesh is the same");
  assert.ok(!s.issues().some((i) => i.key.startsWith("armature:")));
  // a file written without an armature has none to take out
  assert.deepEqual((await s.removeArmatures(async () => { throw new Error("nothing to write"); })).written, []);
});

test("a LOD that came without a skin is built with the bones of LOD 0 (else studiomdl hangs it on one bone at its own origin)", async () => {
  const { writeFbx } = await import("../src/compiler/fbxWrite.ts");
  const { makeBuildRequest } = await import("../src/compiler/request.ts");
  const lines = ["version 1", "nodes", '  0 "bip_head" -1', '  1 "prop_bone" 0', "end", "skeleton", "time 0", "  0 0 0 60 0 0 0", "  1 0 0 5 0 0 0", "end", "triangles"];
  const v = (x: number, y: number, bone: number) => `  ${bone}  ${x} 0 ${y + 60}  0 1 0  ${x} ${y}  1 ${bone} 1.0`;
  lines.push("m", v(0, 0, 0), v(1, 0, 1), v(0, 1, 0), "end", "");
  const model = importModel("hat.smd", new TextEncoder().encode(lines.join("\n")).buffer as ArrayBuffer);
  const files: Record<string, ArrayBuffer> = {
    "C:/art/hat_lod0.fbx": writeFbx(model).slice().buffer as ArrayBuffer,
    "C:/art/hat_lod1.fbx": writeFbx(model, {}, { skeleton: false }).slice().buffer as ArrayBuffer,
  };
  const s = new CompilerSession(io(files));
  s.data.smartFill = false;
  s.data.name = "hat";
  await s.setLod("sniper", 0, "C:/art/hat_lod0.fbx");
  await s.setLod("sniper", 1, "C:/art/hat_lod1.fbx");
  assert.equal(s.model("sniper", 1)!.skeleton.length, 0, "the file has no skeleton");
  const request = makeBuildRequest(s, "");
  const nodes = (smd: string) => smd.split("\n").filter((l) => /^\s+\d+ "/.test(l)).map((l) => l.trim().split(" ")[1].replace(/"/g, ""));
  const lods = request.classes[0].lods;
  assert.deepEqual(nodes(lods[0].smd), ["bip_head", "prop_bone"]);
  assert.deepEqual(nodes(lods[1].smd), ["bip_head", "prop_bone"], "LOD 1 follows the same bones as LOD 0, where they are");
});
