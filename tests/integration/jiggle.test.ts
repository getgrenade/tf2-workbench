import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { clampAimToLimits, defaultJiggle, jiggleParams, jiggleQc, jiggleQcFor, readJiggle } from "../../src/compiler/jiggleBones";
import { aimTurn, turnedWorld, turnMatrix } from "../../src/compiler/boneAxes";
import { importFbx } from "../../src/compiler/fbx";
import { writeSmd } from "../../src/compiler/smd";
import { buildPreviewModel } from "../../src/compiler/preview";
import { parsePayload } from "../../src/viewer/payload";

(globalThis as any).document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_v: string) {} }) };

// clampAimToLimits keeps a hand-posed override within the bone's jiggle limits (the "always obey the limits" rule of the inspector).
const dirOf = (t: [number, number, number]) => new THREE.Vector3().setFromMatrixColumn(turnMatrix(t), 2);
const yawOf = (t: [number, number, number]) => { const d = dirOf(t); return Math.atan2(d.x, d.z); };
const paramsWith = (edit: (s: ReturnType<typeof defaultJiggle>) => void) => { const s = defaultJiggle(10); edit(s); return jiggleParams(s); };

test("an override aim past the yaw limit is clamped to it", () => {
  const params = paramsWith((s) => { s.yaw = { on: true, min: -30, max: 30, friction: 0, bounce: 0 }; });
  assert.ok(Math.abs(yawOf(clampAimToLimits(params, [0, 80, 0])) - Math.PI / 6) < 1e-3, "80 deg clamps to +30");
  assert.ok(Math.abs(yawOf(clampAimToLimits(params, [0, -70, 0])) + Math.PI / 6) < 1e-3, "-70 deg clamps to -30");
});

test("an override aim within the yaw limit passes through", () => {
  const params = paramsWith((s) => { s.yaw = { on: true, min: -30, max: 30, friction: 0, bounce: 0 }; });
  assert.ok(Math.abs(yawOf(clampAimToLimits(params, [0, 20, 0])) - (20 * Math.PI) / 180) < 1e-3);
});

test("an override aim past the angle cone is clamped to the cone", () => {
  const params = paramsWith((s) => { s.angle = { on: true, limit: 30 }; });
  const d = dirOf(clampAimToLimits(params, [0, 80, 0]));
  assert.ok(Math.abs(Math.acos(d.z) - Math.PI / 6) < 1e-3, `deviation ${Math.acos(d.z)} rad, expected ~${Math.PI / 6}`);
});

test("with no constraints an override aim is left alone", () => {
  const params = paramsWith(() => {}); // defaultJiggle has no yaw/pitch/angle constraints
  assert.ok(Math.abs(yawOf(clampAimToLimits(params, [0, 50, 0])) - (50 * Math.PI) / 180) < 1e-3);
});

test("a flexible jiggle bone is written as studiomdl takes it", () => {
  const s = defaultJiggle(12);
  s.yaw = { on: true, min: -25, max: 30, friction: 0.5, bounce: 0 };
  s.angle = { on: true, limit: 40 };
  s.allowLengthFlex = true;
  const qc = jiggleQc("trail_1", s);
  assert.equal(qc, `$jigglebone "trail_1"
{
\tis_flexible
\t{
\t\tlength 12
\t\ttip_mass 0
\t\tpitch_stiffness 100
\t\tpitch_damping 7
\t\tyaw_stiffness 100
\t\tyaw_damping 7
\t\tallow_length_flex
\t\talong_stiffness 100
\t\talong_damping 0
\t\tyaw_constraint -25 30
\t\tyaw_friction 0.5
\t\tyaw_bounce 0
\t\tangle_constraint 40
\t}
}
`);
});

test("rigid, base spring and boing blocks, and only the bones that have a setup", () => {
  const s = defaultJiggle();
  s.mode = "rigid";
  s.baseSpring.on = true;
  s.boing.on = true;
  const qc = jiggleQc("tail", s);
  assert.match(qc, /is_rigid\n\t\{\n\t\tlength 10\n\t\ttip_mass 0\n\t\}/);
  assert.match(qc, /has_base_spring\n\t\{\n\t\tbase_mass 1\n\t\tstiffness 100\n\t\tdamping 7\n\t\tleft_constraint -5 5\n/);
  assert.match(qc, /is_boing\n\t\{\n\t\timpact_speed 150\n\t\timpact_angle 30\n/);
  assert.equal(jiggleQcFor(["a", "b", "c"], { b: s }), qc.replace("tail", "b"));
  assert.equal(jiggleQcFor(["a"], { b: s }), "");
});

test("the compiled model's numbers: flags, radians, and the cosine of the boing angle", () => {
  const s = defaultJiggle(20);
  s.yaw = { on: true, min: -90, max: 45, friction: 0, bounce: 0 };
  s.boing.on = true;
  s.boing.impactAngle = 60;
  const p = jiggleParams(s);
  assert.equal(p.flags, 0x01 | 0x04 | 0x20 | 0x80, "flexible, yaw constraint, no length flex, boing");
  assert.ok(Math.abs(p.minYaw + Math.PI / 2) < 1e-9 && Math.abs(p.maxYaw - Math.PI / 4) < 1e-9);
  assert.ok(Math.abs(p.boingImpactAngle - 0.5) < 1e-9);
  s.allowLengthFlex = true;
  assert.equal(jiggleParams(s).flags & 0x20, 0);
});

test("a saved setup is read back, and what is missing or wrong takes the default", () => {
  const s = defaultJiggle(33);
  s.pitch = { on: true, min: -10, max: 12, friction: 1, bounce: 0.1 };
  assert.deepEqual(readJiggle(JSON.parse(JSON.stringify(s))), s);
  const messy = readJiggle({ mode: "weird", length: "x", yaw: { on: "yes", min: 5 }, boing: null });
  assert.equal(messy.mode, "flexible");
  assert.equal(messy.length, 10);
  assert.equal(messy.yaw.on, false);
  assert.equal(messy.yaw.min, 5);
  assert.equal(messy.boing.on, false);
});

test("turning a bone's axes keeps its place and aims its Z where asked", () => {
  const world = new THREE.Matrix4().makeTranslation(1, 2, 3);
  const turned = turnedWorld(world, [0, 90, 0]);
  const p = new THREE.Vector3().setFromMatrixPosition(turned);
  assert.deepEqual(p.toArray(), [1, 2, 3]);
  const z = new THREE.Vector3().setFromMatrixColumn(turned, 2);
  assert.ok(Math.abs(z.x - 1) < 1e-9 && Math.abs(z.z) < 1e-9, "Z now points where X did");
  const turn = aimTurn(world, new THREE.Vector3(1, -8, 3));
  const aimed = new THREE.Vector3().setFromMatrixColumn(turnedWorld(world, turn), 2);
  assert.ok(Math.abs(aimed.y + 1) < 1e-3 && Math.abs(aimed.x) < 1e-3 && Math.abs(aimed.z) < 1e-3, aimed.toArray().join());
});

const SOLDIER = "target/gib-fixtures/soldier.player.model";
import { parseJiggleQc } from "../../src/compiler/jiggleBones";
import { parseImportSession } from "../../src/compiler/importSession";

test("the QC a jiggle bone was written in reads back as the same setup", () => {
  const s = defaultJiggle(12);
  s.mode = "flexible"; s.allowLengthFlex = true; s.tipMass = 8;
  s.yaw = { on: true, min: -45, max: 50, friction: 0.5, bounce: 0.1 };
  s.pitch = { on: true, min: -10, max: 12, friction: 0, bounce: 0 };
  s.angle = { on: true, limit: 40 };
  s.baseSpring.on = true;
  s.boing.on = true;
  const rigid = defaultJiggle(7); rigid.mode = "rigid"; rigid.yaw.on = true;
  const text = `// the model\n$bodygroup "x" { studio "a.smd" }\n${jiggleQc("tail_1", s)}\n$sequence "ref" "a.smd"\n${jiggleQc("tail_2", rigid)}`;
  assert.deepEqual(parseJiggleQc(text), { tail_1: s, tail_2: rigid });
  assert.deepEqual(parseJiggleQc("$modelname \"x.mdl\""), {});
  assert.deepEqual(Object.keys(parseJiggleQc('$jigglebone "a"\n{\n\tis_flexible\n\t{\n\t\tmystery 5\n\t\tlength 3\n\t}\n}')), ["a"]);
});

