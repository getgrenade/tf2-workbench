// Run with: node --test "tests/*.test.ts"   (Node 22.6+ strips the types; this folder is not part of the tsc project)
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateMaterialVars, modulationColor, parseVmtValue, unpackRgb, type ProxyDef } from "../src/viewer/proxies.ts";

// soldier_samurai_red.vmt: the proxy chain of a paintable item.
const params = {
  "$blendtintbybasealpha": "1",
  "$blendtintcoloroverbase": "1",
  "$colortint_base": "{126 46 49}",
  "$colortint_tmp": "[0 0 0]",
  "$yellow": "0",
};
const proxies: ProxyDef[] = [
  { name: "itemtintcolor", params: { resultvar: "$colortint_tmp" } },
  { name: "selectfirstifnonzero", params: { srcvar1: "$colortint_tmp", srcvar2: "$colortint_base", resultvar: "$color2" } },
  { name: "yellowlevel", params: { resultvar: "$yellow" } },
  { name: "multiply", params: { srcvar1: "$color2", srcvar2: "$yellow", resultvar: "$color2" } },
];

const near = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} vs ${b}`));

test("parses VMT vectors: braces are 0-255, brackets are floats", () => {
  near(parseVmtValue("{126 46 49}")!, [126 / 255, 46 / 255, 49 / 255]);
  near(parseVmtValue("[ .4 .4 .5 ]")!, [0.4, 0.4, 0.5]);
  assert.deepEqual(parseVmtValue("2.5"), [2.5]);
  assert.equal(parseVmtValue("models/player/foo"), null);
});

test("unpainted: $color2 is the item's $colortint_base", () => {
  const vars = evaluateMaterialVars(params, proxies, { paint: null });
  near(vars["$color2"], [126 / 255, 46 / 255, 49 / 255]);
});

test("painted: the paint replaces $colortint_base in $color2", () => {
  const paint = unpackRgb(0x729e42); // Indubitably Green
  const vars = evaluateMaterialVars(params, proxies, { paint });
  near(vars["$color2"], paint);
  near(vars["$colortint_tmp"], paint);
});

test("pure black paint cannot be told apart from no paint (SelectFirstIfNonZero), as in the game", () => {
  const vars = evaluateMaterialVars(params, proxies, { paint: [0, 0, 0] });
  near(vars["$color2"], [126 / 255, 46 / 255, 49 / 255]);
});

test("YellowLevel makes the trailing Multiply by $yellow a no-op", () => {
  const withoutYellow = proxies.filter((p) => p.name !== "yellowlevel");
  const vars = evaluateMaterialVars(params, withoutYellow, { paint: [1, 0.5, 0.25] });
  near(vars["$color2"], [0, 0, 0]); // $yellow stayed 0 -> black; shows why YellowLevel must run
  const ok = evaluateMaterialVars(params, proxies, { paint: [1, 0.5, 0.25] });
  near(ok["$color2"], [1, 0.5, 0.25]);
});

test("modulation is $color * $color2 converted to linear", () => {
  const vars = evaluateMaterialVars({ "$color": "[1 1 1]" }, [], { paint: null });
  near(modulationColor(vars), [1, 1, 1]);
  const half = evaluateMaterialVars({ "$color2": "[0.5 0.5 0.5]" }, [], { paint: null });
  near(modulationColor(half), [Math.pow(0.5, 2.2), Math.pow(0.5, 2.2), Math.pow(0.5, 2.2)]);
  const hot = evaluateMaterialVars({ "$color2": "[2 2 2]" }, [], { paint: null });
  near(modulationColor(hot), [2, 2, 2]); // values above 1 are not gamma converted
});

test("unpackRgb matches the proxy's byte unpacking", () => {
  near(unpackRgb(0xff8000), [1, 128 / 255, 0]);
  near(unpackRgb(7511618), [114 / 255, 158 / 255, 66 / 255]);
});

test("class body materials: Equals($yellow -> $color2) after YellowLevel leaves $color2 white", () => {
  const body: ProxyDef[] = [
    { name: "yellowlevel", params: { resultvar: "$yellow" } },
    { name: "equals", params: { srcvar1: "$yellow", resultvar: "$color2" } },
  ];
  const vars = evaluateMaterialVars({ "$yellow": "0" }, body, { paint: null });
  near(vars["$color2"], [1, 1, 1]);
});

// ---- time driven proxies and variable semantics (mathproxy.cpp / functionproxy.cpp) ----

const eval1 = (params: Record<string, string>, proxies: ProxyDef[], time: number) => evaluateMaterialVars(params, proxies, { paint: null, time });

test("Sine runs between sineMin and sineMax with the given period", () => {
  const proxies = [{ name: "sine", params: { resultvar: "$selfillumtint", sinemin: "0.2", sinemax: "1", sineperiod: "4" } }];
  // time 0: sin(0) = 0 -> halfway; time 1 (a quarter period): the maximum
  assert.ok(Math.abs(eval1({ "$selfillumtint": "[1 1 1]" }, proxies, 0)["$selfillumtint"][0] - 0.6) < 1e-9);
  assert.ok(Math.abs(eval1({ "$selfillumtint": "[1 1 1]" }, proxies, 1)["$selfillumtint"][2] - 1) < 1e-9);
});

test("a scalar result written to a vector fills it, and $var[n] writes one component", () => {
  const all = eval1({ "$v": "[0 0 0]" }, [{ name: "linearramp", params: { resultvar: "$v", rate: "2" } }], 3);
  assert.deepEqual(all["$v"], [6, 6, 6]);
  const one = eval1({ "$v": "[0 0 0]" }, [{ name: "linearramp", params: { resultvar: "$v[1]", rate: "2" } }], 3);
  assert.deepEqual(one["$v"], [0, 6, 0]);
});

test("variables that do not exist yet are created by the first write and can be read afterwards", () => {
  const proxies = [
    { name: "sine", params: { resultvar: "$wave", sineperiod: "4" } },
    { name: "multiply", params: { srcvar1: "$wave", srcvar2: "$gain", resultvar: "$out" } },
  ];
  const v = eval1({ "$gain": "10" }, proxies, 1);
  assert.ok(Math.abs(v["$out"][0] - 10) < 1e-9);
});

test("Clamp and LessOrEqual follow the SDK", () => {
  const clamp = eval1({ "$x": "5" }, [{ name: "clamp", params: { srcvar1: "$x", resultvar: "$y", min: "0", max: "2" } }], 0);
  assert.equal(clamp["$y"][0], 2);
  const le = eval1({ "$a": "1", "$b": "2", "$lo": "7", "$hi": "9" }, [{ name: "lessorequal", params: { srcvar1: "$a", srcvar2: "$b", lessequalvar: "$lo", greatervar: "$hi", resultvar: "$r" } }], 0);
  assert.equal(le["$r"][0], 7);
});

test("TextureScroll writes a translation matrix that wraps into [0,1)", () => {
  const params = { "$basetexturetransform": "center .5 .5 scale 1 1 rotate 0 translate 0 0" };
  const proxies = [{ name: "texturescroll", params: { texturescrollvar: "$basetexturetransform", texturescrollrate: "0.5", texturescrollangle: "90" } }];
  const m = eval1(params, proxies, 3)["$basetexturetransform"];
  // v offset = 3 * sin(90deg) * 0.5 = 1.5 -> wraps to 0.5; u offset ~ 0
  assert.ok(Math.abs(m[5] - 0.5) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] === 1 && m[4] === 1);
});

test("a transform parameter without proxies parses to its matrix", () => {
  const m = eval1({ "$basetexturetransform": "center .5 .5 scale 2 2 rotate 0 translate 0 0" }, [], 0)["$basetexturetransform"];
  // scaling about the centre: u' = 2u - 0.5
  assert.deepEqual(m.map((x) => Math.round(x * 1e6) / 1e6), [2, 0, -0.5, 0, 2, -0.5]);
});

// ---- AnimatedTexture ----

import { animationFrame, baseTextureAnimation } from "../src/viewer/proxies.ts";

test("the Festive lights cycle their base texture at one frame per second", () => {
  const anim = baseTextureAnimation([
    { name: "animatedtexture", params: { animatedtexturevar: "$detail", animatedtextureframerate: "30" } },
    { name: "animatedtexture", params: { animatedtexturevar: "$basetexture", animatedtextureframenumvar: "$frame", animatedtextureframerate: "1" } },
  ]);
  assert.deepEqual(anim, { rate: 1, noWrap: false });
  assert.deepEqual([0, 0.9, 1, 2.5, 3, 7.2].map((t) => animationFrame(anim!, t, 3)), [0, 0, 1, 2, 0, 1]);
});

test("a material without a base texture animation has none, and the default rate is 15", () => {
  assert.equal(baseTextureAnimation([{ name: "animatedtexture", params: { animatedtexturevar: "$detail" } }]), null);
  assert.equal(baseTextureAnimation([{ name: "animatedtexture", params: { animatedtexturevar: "$BaseTexture" } }])!.rate, 15);
});

test("animationnowrap stops on the last frame", () => {
  const anim = baseTextureAnimation([{ name: "animatedtexture", params: { animatedtexturevar: "$basetexture", animatedtextureframerate: "2", animationnowrap: "1" } }])!;
  assert.deepEqual([0, 1, 100].map((t) => animationFrame(anim, t, 4)), [0, 2, 3]);
});

// ---- phong tint (skin_dx9_helper.cpp) ----

import { resolvePhongTint } from "../src/viewer/payload.ts";

test("a proxy that reads a variable the material does not have is not run (the paint chain of Architect of Pain stops after its first step)", () => {
  const proxies = [
    { name: "yellowlevel", params: { resultvar: "$yellow" } },
    { name: "multiply", params: { srcvar1: "$color2", srcvar2: "$yellow", resultvar: "$phongtint" } },
    { name: "multiply", params: { srcvar1: "$phongtint", srcvar2: "$half", resultvar: "$phongtint" } },
    { name: "add", params: { srcvar1: "$phongtint", srcvar2: "$tintaddamount", resultvar: "$phongtint" } },
  ];
  const vars = evaluateMaterialVars({ "$color2": "{ 110 38 44 }", "$yellow": "0" }, proxies, { paint: null });
  assert.deepEqual(vars["$phongtint"].map((x) => Math.round(x * 1000) / 1000), [0.431, 0.149, 0.173]);
  // with the variables there, the whole chain runs
  const full = evaluateMaterialVars({ "$color2": "{ 110 38 44 }", "$yellow": "0", "$half": "[.5 .5 .5]", "$tintaddamount": "[.1 .1 .1]" }, proxies, { paint: null });
  assert.deepEqual(full["$phongtint"].map((x) => Math.round(x * 1000) / 1000), [0.316, 0.175, 0.186]);
});

test("an unset $phongtint with an exponent texture tints phong by the albedo (the Spy smoking jacket)", () => {
  assert.deepEqual(resolvePhongTint({ "$phongalbedotint": "1" }, true), [-1, 0, 0]);
  assert.deepEqual(resolvePhongTint({}, true), [1, 1, 1], "$phongalbedotint is off unless the material sets it");
  assert.deepEqual(resolvePhongTint({ "$phongtint": "[0 0 0]", "$phongalbedotint": "1" }, true), [-1, 0, 0], "an all-zero tint means none was given");
});

test("without an exponent texture, or with $phongalbedotint 0, phong is white; an explicit tint wins", () => {
  assert.deepEqual(resolvePhongTint({ "$phongalbedotint": "1" }, false), [1, 1, 1]);
  assert.deepEqual(resolvePhongTint({ "$phongalbedotint": "0" }, true), [1, 1, 1]);
  assert.deepEqual(resolvePhongTint({ "$phongtint": "[1 0.9 0.75]", "$phongalbedotint": "1" }, true), [1, 0.9, 0.75]);
});

import { tauntPropSequence, tauntSequence } from "../src/viewer/payload.ts";

test("a taunt scene name finds its class sequence despite filler words, underscores and class suffixes", () => {
  const seqs = ["layer_taunt_skating_scorcher_intro", "taunt_skating_scorcher_intro", "taunt_cheers_soldier", "tauntrussian_rubdown", "taunt_zoomin_broom", "taunt_yeti"];
  assert.equal(tauntSequence("taunt_the_skating_scorcher_intro", "pyro", seqs), "taunt_skating_scorcher_intro", "'the' is ignored and layer_ copies lose");
  assert.equal(tauntSequence("taunt_cheers", "soldier", seqs), "taunt_cheers_soldier", "the class suffix is appended");
  assert.equal(tauntSequence("taunt_russian_rubdown", "heavy", seqs), "tauntrussian_rubdown", "underscores differ");
  assert.equal(tauntSequence("zoomin_broom", "soldier", seqs), "taunt_zoomin_broom", "the taunt prefix is optional");
  assert.equal(tauntSequence("yeti_taunt", "soldier", seqs), "taunt_yeti", "word order of the filler");
  assert.equal(tauntSequence("taunt_vehicle_tank", "soldier", ["taunt_vehicle_tank_spawn_layer", "taunt_vehicle_tank_start_layer", "taunt_vehicle_tank_start", "taunt_vehicle_tank_honk", "taunt_vehicle_tank_end"]), "taunt_vehicle_tank_start", "the opening of a multi-part taunt");
  assert.equal(tauntSequence("taunt_flying_colors", "soldier", seqs), null);
  assert.equal(tauntSequence("taunt_flying_colors", "soldier", [...seqs, "taunt_flag_soldier"], "models/workshop/player/items/all_class/taunt_flag/taunt_flag.mdl"), "taunt_flag_soldier", "the prop name is the fallback clue");
});

test("a taunt prop plays the sequence named like its scene; a prop with only `ref` is static", () => {
  assert.equal(tauntPropSequence("bucking_bronco_prop", "engineer", ["bucking_bronco_intro", "bucking_bronco_end"]), "bucking_bronco_intro");
  assert.equal(tauntPropSequence("engys_new_chair_intro", "engineer", ["ref", "idle", "chair_intro_qcistyle", "chair_outro_qcistyle"]), "chair_intro_qcistyle");
  assert.equal(tauntPropSequence("taunt_killer_joke_drum", "heavy", ["ref", "taunt_killer_joke_engineer", "taunt_killer_joke_heavy", "taunt_killer_joke_demo"]), "taunt_killer_joke_heavy", "one animation per class");
  assert.equal(tauntPropSequence("taunt_killer_joke_drum", "demoman", ["ref", "taunt_killer_joke_heavy", "taunt_killer_joke_demo"]), "taunt_killer_joke_demo");
  assert.equal(tauntPropSequence("x_prop", "spy", ["ref"]), null);
  assert.equal(tauntPropSequence(undefined, "spy", ["ref", "spin"]), "spin", "a single real animation is used");
});

import { freeSlot, slotOffset } from "../src/viewer/layout.ts";

test("characters stand in a row: the first at the origin, the next ones alternate right and left", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((s) => slotOffset(s, 72)), [0, 72, -72, 144, -144]);
  assert.equal(slotOffset(1, 100), 100);
});

test("a removed character's slot is the next one reused", () => {
  assert.equal(freeSlot([]), 0);
  assert.equal(freeSlot([0, 1, 2]), 3);
  assert.equal(freeSlot([0, 2]), 1);
});

import { parseScene } from "../src/viewer/scene.ts";

const sceneBase = {
  app: "tf2-workbench",
  version: 1,
  camera: { position: [0, 50, 300], target: [0, 40, 0] },
  entities: [{ cls: "soldier", team: 1, loadout: [{ item: 55, paint: 5, style: 1 }, { nope: true }], held: 18 }],
};

test("a scene file is checked and its gaps filled with neutral values", () => {
  const s = parseScene(JSON.stringify(sceneBase));
  assert.equal(s.entities[0].team, 1);
  assert.deepEqual(s.entities[0].loadout, [{ item: 55, paint: 5, style: 1 }], "entries without an item id are dropped");
  assert.equal(s.entities[0].held, 18);
  assert.deepEqual(s.entities[0].placement, { x: 0, y: 0, z: 0, yaw: 0, placed: false });
  assert.equal(s.spacing, 72);
  assert.equal(s.entities[0].playback.loopAll, true);
  assert.equal(s.selected, 0);
});

test("things that are not scenes are refused with a reason", () => {
  assert.throws(() => parseScene("{"), /invalid JSON/);
  assert.throws(() => parseScene(JSON.stringify({ ...sceneBase, app: "other" })), /not a TF2 Workbench scene/);
  assert.throws(() => parseScene(JSON.stringify({ ...sceneBase, version: 2 })), /version 2/);
  assert.throws(() => parseScene(JSON.stringify({ ...sceneBase, entities: [] })), /no characters/);
  assert.throws(() => parseScene(JSON.stringify({ ...sceneBase, camera: {} })), /no camera/);
});

import * as THREE from "three";
import { PoseHistory, controlsFor, mirrorId, parsePoseFile, poseForSkeleton, rotateBoneLocal, sampleClip, toPoseFile } from "../src/viewer/poseRig.ts";

test("turning a bone in the parent's frame composes with its world rotation", () => {
  const parent = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const local = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4);
  const world = parent.clone().multiply(local);
  const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
  const newLocal = rotateBoneLocal(parent, world, delta);
  // going back out: parent * newLocal must equal delta * world
  const check = parent.clone().multiply(newLocal);
  const want = delta.clone().multiply(world);
  assert.ok(check.angleTo(want) < 1e-6);
  // no turn, no change
  const same = rotateBoneLocal(parent, world, new THREE.Quaternion());
  assert.ok(same.angleTo(local) < 1e-6);
});

test("pose edits can be undone and redone, and a new edit drops the redo steps", () => {
  const pose = (v: number) => ({ pos: new Float32Array([v, 0, 0]), quat: new Float32Array([0, 0, 0, 1]) });
  const h = new PoseHistory();
  h.record(pose(1)); // edit 1 -> now 2
  h.record(pose(2)); // edit 2 -> now 3
  assert.equal(h.undo(pose(3))!.pos[0], 2);
  assert.equal(h.undo(pose(2))!.pos[0], 1);
  assert.equal(h.undo(pose(1)), null);
  assert.equal(h.redo(pose(1))!.pos[0], 2);
  h.record(pose(2));
  assert.equal(h.canRedo, false);
});

test("the body controls follow the skeleton's bones, and pairs mirror", () => {
  const soldier = ["bip_pelvis", "bip_spine_0", "bip_spine_1", "bip_spine_2", "bip_spine_3", "bip_neck", "bip_head", "bip_upperArm_L", "bip_lowerArm_L", "bip_hand_L", "bip_middle_0_L"];
  const ids = controlsFor(soldier).map((c) => c.id);
  assert.ok(ids.includes("pelvis") && ids.includes("upperArmL") && ids.includes("handL"));
  assert.ok(!ids.includes("upperArmR"), "a control needs its bone");
  assert.equal(mirrorId("upperArmL"), "upperArmR");
  assert.equal(mirrorId("head"), null);
});

test("a pose file round-trips and applies by bone name", () => {
  const bones = ["a", "b", "c"];
  const p = { pos: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), quat: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0]) };
  const file = parsePoseFile(JSON.stringify(toPoseFile("soldier", bones, p, { sequence: "stand", frame: 4 })));
  assert.equal(file.source?.frame, 4);
  const fallback = { pos: new Float32Array(9).fill(-1), quat: new Float32Array(12).fill(-1) };
  const { pose, matched } = poseForSkeleton(file, ["C", "x", "a"], fallback);
  assert.equal(matched, 2);
  assert.deepEqual(Array.from(pose.pos), [7, 8, 9, -1, -1, -1, 1, 2, 3]);
  assert.throws(() => parsePoseFile("{}"), /not a TF2 Workbench pose/);
  assert.throws(() => parsePoseFile(JSON.stringify({ ...file, pos: [1] })), /bad positions/);
});

test("sampling a clip between frames lerps positions and slerps rotations", () => {
  const clip = {
    fps: 30, looping: false, frames: 2, numBones: 1,
    pos: new Float32Array([0, 0, 0, 10, 20, 30]),
    quat: new Float32Array([0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2]),
  };
  const s = sampleClip(clip, 0.5);
  assert.deepEqual(Array.from(s.pos), [5, 10, 15]);
  const q = new THREE.Quaternion(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
  assert.ok(Math.abs(q.angleTo(new THREE.Quaternion()) - Math.PI / 4) < 1e-5);
});

import { rotationBetween, solveTwoBone } from "../src/viewer/ik.ts";
import { CURL_RANGE, FINGER_AXIS, HAND_PRESETS, MAX_CURL, MIN_CURL, curlAngle, curlFromAngle, totalCurlRange } from "../src/viewer/fingers.ts";
import { gazeAnglesForTarget } from "../src/viewer/gaze.ts";

test("two-bone IK keeps the segment lengths, reaches the target and bends toward the pole", () => {
  const a = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(10, 0, 0);
  const pole = new THREE.Vector3(5, 0, 20); // up
  const r = solveTwoBone(a, new THREE.Vector3(5, 0, -1), target, pole, 8, 8);
  assert.ok(r.reachable);
  assert.ok(r.end.distanceTo(target) < 1e-6);
  assert.ok(Math.abs(r.mid.distanceTo(a) - 8) < 1e-5);
  assert.ok(Math.abs(r.mid.distanceTo(r.end) - 8) < 1e-5);
  assert.ok(r.mid.z > 0, "the elbow went up, toward the pole");
  const down = solveTwoBone(a, r.mid, target, new THREE.Vector3(5, 0, -20), 8, 8);
  assert.ok(down.mid.z < 0, "and down for a pole below");
  // out of reach: the chain stretches straight toward the target
  const far = solveTwoBone(a, r.mid, new THREE.Vector3(100, 0, 0), pole, 8, 8);
  assert.ok(!far.reachable);
  assert.ok(far.end.x > 15.9 && far.end.x < 16);
});

test("the smallest rotation between two directions", () => {
  const q = rotationBetween(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const v = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  assert.ok(v.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
});

test("finger curl is absolute: 0 stretched, 1 a fist, measured from the bind pose, clamped", () => {
  assert.equal(FINGER_AXIS.length(), 1);
  const open = CURL_RANGE.index[1].open;
  const fist = CURL_RANGE.index[1].fist;
  assert.equal(curlAngle("index", 1, 0), open);
  assert.equal(curlAngle("index", 1, 1), fist);
  assert.equal(curlAngle("index", 1, 0.5), (open + fist) / 2);
  assert.equal(curlAngle("index", 1, 9), open + MAX_CURL * (fist - open), "clamped at the over-clench limit");
  assert.equal(curlAngle("index", 1, -9), open + MIN_CURL * (fist - open), "and at the over-stretch limit");
  assert.ok(Math.abs(curlFromAngle("index", 1, curlAngle("index", 1, 0.37)) - 0.37) < 1e-9, "the inverse reads back the curl");
  assert.equal(totalCurlRange("index"), CURL_RANGE.index.reduce((s, r) => s + r.fist - r.open, 0));
  assert.equal(CURL_RANGE.thumb[0].open, 0, "the thumb's base has no curl of its own");
  for (const p of HAND_PRESETS) assert.ok(p.curls.every((c) => c >= MIN_CURL && c <= MAX_CURL), p.name);
  for (const joints of Object.values(CURL_RANGE)) for (const j of joints) assert.ok(j.open <= 0 && j.fist >= 0);
});

test("looking at a point gives the eye angles that gazeTargetLocal would turn into that direction", () => {
  const a = gazeAnglesForTarget(30, 0, 0);
  assert.ok(Math.abs(a.upDown) < 1e-9 && Math.abs(a.rightLeft) < 1e-9);
  const left = gazeAnglesForTarget(30, 10, 0);
  assert.ok(left.rightLeft > 15 && left.rightLeft < 20 && Math.abs(left.upDown) < 1e-9);
  const down = gazeAnglesForTarget(30, 0, -10);
  assert.ok(down.upDown > 15 && down.upDown < 20);
  assert.deepEqual(gazeAnglesForTarget(-5, 3, 3), { upDown: 0, rightLeft: 0 });
});

import { fingerBaseControls, fingerBoneControls, fingerControls, fingerTipControls, prettyBoneName, propControls, prpControls, weaponControls } from "../src/viewer/poseRig.ts";

test("prp_ bones become Detail controls with readable names, sides and aims", () => {
  const names = ["bip_pelvis", "prp_coat_front_L", "prp_coat_front_1_L", "prp_pack_back", "weapon_bone"];
  const parents = [-1, 0, 1, 0, 0];
  const c = prpControls(names, parents);
  assert.deepEqual(c.map((x) => x.label), ["Coat front L", "Coat front 1 L", "Pack back"]);
  assert.deepEqual(c.map((x) => x.side), ["L", "L", "C"]);
  assert.ok(c.every((x) => x.group === "detail" && x.kind === "fk"));
  assert.equal(c[0].aim, "prp_coat_front_1_L", "the ring stands across the segment to the next prp_ bone");
  assert.equal(c[2].aim, null);
  assert.equal(mirrorId("prp:prp_coat_front_L"), "prp:prp_coat_front_R");
  assert.equal(prettyBoneName("prp_grenade_top"), "Grenade top");
});

test("weapon_ and prop_ bones get their own movable control groups", () => {
  const names = ["bip_pelvis", "bip_hand_R", "weapon_bone", "weapon_bone_L", "weapon_bone_1", "prop_bone", "prop_bone_1", "prp_pouch"];
  const parents = [-1, 0, 1, 1, 2, 0, 5, 0];
  const w = weaponControls(names, parents);
  assert.deepEqual(w.map((c) => c.label), ["Weapon bone", "Weapon bone L", "Weapon bone 1"]);
  assert.ok(w.every((c) => c.group === "weapon" && c.movable));
  assert.equal(w[0].aim, "weapon_bone_1", "the ring stands across the segment to its first weapon_ child");
  const p = propControls(names, parents);
  assert.deepEqual(p.map((c) => c.id), ["prop:prop_bone", "prop:prop_bone_1"]);
  assert.equal(p[0].aim, "prop_bone_1");
  assert.equal(prpControls(names, parents).length, 1, "prp_ stays its own group");
});

test("each finger of a hand with finger bones gets one curl control, mirrored by side", () => {
  const names = ["bip_hand_L", "bip_hand_R"];
  for (const side of ["L", "R"]) for (const f of ["thumb", "index", "middle", "ring", "pinky"]) for (const j of [0, 1, 2]) names.push(`bip_${f}_${j}_${side}`);
  const c = fingerControls(names);
  assert.equal(c.length, 10);
  assert.ok(c.every((d) => d.kind === "finger" && d.group === "fingers" && d.finger));
  assert.equal(c[0].bone, "bip_thumb_1_L");
  assert.equal(c[0].aim, "bip_thumb_2_L");
  assert.equal(mirrorId("finger:index_L"), "finger:index_R");
  assert.equal(fingerControls(["bip_hand_L"]).length, 0, "no finger bones, no controls");
});

test("every finger bone gets its own control, with the next joint as its aim", () => {
  const names = ["bip_hand_L"];
  for (const f of ["thumb", "index"]) for (const j of [0, 1, 2]) names.push(`bip_${f}_${j}_L`);
  const c = fingerBoneControls(names);
  assert.equal(c.length, 6);
  assert.ok(c.every((d) => d.group === "fingerbones" && d.kind === "fk" && d.boneFrame));
  assert.deepEqual(c.slice(0, 3).map((d) => d.label), ["Thumb 1 L", "Thumb 2 L", "Thumb 3 L"]);
  assert.equal(c[0].aim, "bip_thumb_1_L");
  assert.equal(c[2].aim, null, "the tip has no next joint");
  assert.equal(mirrorId("fb:bip_index_1_L"), "fb:bip_index_1_R");
});

test("each finger gets a tip control, mirrored by side", () => {
  const names = ["bip_hand_L"];
  for (const f of ["thumb", "index"]) for (const j of [0, 1, 2]) names.push(`bip_${f}_${j}_L`);
  const c = fingerTipControls(names);
  assert.deepEqual(c.map((d) => d.id), ["tip:thumb_L", "tip:index_L"]);
  assert.ok(c.every((d) => d.kind === "tip" && d.group === "fingers" && d.finger));
  assert.equal(c[0].bone, "bip_thumb_2_L");
  assert.equal(mirrorId("tip:index_L"), "tip:index_R");
});

test("each finger gets a base control on its first bone, in the Fingers group", () => {
  const names = ["bip_hand_R"];
  for (const f of ["thumb", "index"]) for (const j of [0, 1, 2]) names.push(`bip_${f}_${j}_R`);
  const c = fingerBaseControls(names);
  assert.deepEqual(c.map((d) => d.id), ["base:thumb_R", "base:index_R"]);
  assert.ok(c.every((d) => d.group === "fingers" && d.kind === "fk" && d.boneFrame));
  assert.equal(c[1].bone, "bip_index_0_R");
  assert.equal(c[1].aim, "bip_index_1_R");
  assert.equal(mirrorId("base:index_R"), "base:index_L");
});

test("a phong tint in braces is 0-255, as the engine reads it (the Blast Bowl's visor)", () => {
  const [r, g, b] = resolvePhongTint({ "$phongtint": "{255 24 20}" }, false);
  assert.ok(Math.abs(r - 1) < 1e-9 && Math.abs(g - 24 / 255) < 1e-9 && Math.abs(b - 20 / 255) < 1e-9);
});
