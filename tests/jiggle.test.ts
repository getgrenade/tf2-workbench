// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { JiggleBone, type JiggleParams } from "../src/viewer/jiggle.ts";

// The Eyequarium eye: flexible, angle + length constrained (flags 0x31 | base spring bit pattern 0x71 minus spring).
const params: JiggleParams = {
  flags: 0x31, length: 10, tipMass: 0, yawStiffness: 80, yawDamping: 5, pitchStiffness: 80, pitchDamping: 5,
  alongStiffness: 0, alongDamping: 0, angleLimit: 0.6, minYaw: 0, maxYaw: 0, minPitch: 0, maxPitch: 0,
  baseMass: 0, baseStiffness: 0, baseDamping: 0, baseMin: [0, 0, 0], baseMax: [0, 0, 0], baseFriction: [0, 0, 0],
  boingImpactSpeed: 0, boingImpactAngle: 0, boingDampingRate: 0, boingFrequency: 0, boingAmplitude: 0,
};
const down = new THREE.Vector3(0, 0, -1);
const goalAt = (x: number) => new THREE.Matrix4().makeTranslation(x, 0, 0); // bone axes = world axes, +Z forward
const forwardOf = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixColumn(m, 2);

test("a bone on a stationary goal stays on it", () => {
  const bone = new JiggleBone(params);
  let m = goalAt(0);
  for (let i = 0; i < 120; i++) m = bone.update(i / 60, goalAt(0), down);
  assert.ok(forwardOf(m).angleTo(new THREE.Vector3(0, 0, 1)) < 1e-6);
});

test("the tip lags when the goal moves sideways, then settles back", () => {
  const bone = new JiggleBone(params);
  let t = 0;
  for (; t < 30; t++) bone.update(t / 60, goalAt(0), down);
  let maxAngle = 0;
  for (let i = 0; i < 12; i++, t++) {
    const m = bone.update(t / 60, goalAt(i * 2), down); // the base slides along X
    maxAngle = Math.max(maxAngle, forwardOf(m).angleTo(new THREE.Vector3(0, 0, 1)));
  }
  assert.ok(maxAngle > 0.05, `tip did not lag (${maxAngle})`);
  assert.ok(maxAngle <= 0.6 + 1e-6, "angle constraint exceeded");
  let m = goalAt(0);
  for (let i = 0; i < 400; i++, t++) m = bone.update(t / 60, goalAt(22), down);
  assert.ok(forwardOf(m).angleTo(new THREE.Vector3(0, 0, 1)) < 0.01, "did not settle");
});

test("frames slower than the framerate cutoff fall back to the goal matrix", () => {
  const bone = new JiggleBone(params);
  bone.update(0, goalAt(0), down);
  const m = bone.update(0.3, goalAt(5), down); // 300 ms gap (< 20 fps) but < 0.5 s: no re-init, goal used
  assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(m).x - 5) < 1e-9);
});
