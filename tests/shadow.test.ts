// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { blurTaps, DEFAULT_SHADOW, projectToFloor, shadowFootprint, SHADOW_TEXTURE_SIZE } from "../src/viewer/shadowMath.ts";

const base = { ...DEFAULT_SHADOW, enabled: true };
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("azimuth 0 drops the shadow behind the model, 90 to its left", () => {
  const behind = shadowFootprint({ ...base, azimuth: 0 }, 0, 0, 40);
  near(behind.dirX, 0); near(behind.dirZ, -1);
  const left = shadowFootprint({ ...base, azimuth: 90 }, 0, 0, 40);
  near(left.dirX, 1); near(left.dirZ, 0);
});

test("length 0 puts the shadow straight under the model; longer lengths move points farther along the direction", () => {
  const p = { ...base, azimuth: 90 };
  assert.deepEqual(projectToFloor(5, 7, 60, { ...p, length: 0 }), [5, 7]);
  const [x1] = projectToFloor(0, 0, 60, { ...p, length: 1 });
  const [x2] = projectToFloor(0, 0, 60, { ...p, length: 2 });
  near(x1, 60); near(x2, 120);
  // a point on the floor does not move, and a point below it is clamped to the floor
  assert.deepEqual(projectToFloor(3, 4, 0, { ...p, length: 2 }), [3, 4]);
  assert.deepEqual(projectToFloor(3, 4, -5, { ...p, length: 2 }), [3, 4]);
});

test("the ground square follows the shadow and grows with the length and the blur", () => {
  const short = shadowFootprint({ ...base, azimuth: 90, length: 0, blur: 0 }, 10, 20, 40);
  near(short.centerX, 10); near(short.centerZ, 20);
  const long = shadowFootprint({ ...base, azimuth: 90, length: 2, blur: 0 }, 10, 20, 40);
  near(long.centerX, 10 + 40 * 2);
  assert.ok(long.half > short.half);
  assert.ok(shadowFootprint({ ...base, blur: 20 }, 0, 0, 40).half > shadowFootprint({ ...base, blur: 0 }, 0, 0, 40).half);
});

test("the blur sigma is converted to texels of the shadow texture", () => {
  const f = shadowFootprint({ ...base, blur: 4 }, 0, 0, 40);
  near(f.sigmaTexels, 4 / ((2 * f.half) / SHADOW_TEXTURE_SIZE));
  assert.equal(shadowFootprint({ ...base, blur: 0 }, 0, 0, 40).sigmaTexels, 0);
});

test("blur taps are normalised, symmetric and degenerate to a single tap without blur", () => {
  const t = blurTaps(6);
  near(t.weights.reduce((a, b) => a + b, 0), 1);
  near(t.weights[0], t.weights[t.weights.length - 1]);
  assert.ok(t.weights[8] > t.weights[0], "the centre tap weighs most");
  const none = blurTaps(0);
  assert.equal(none.weights[8], 1);
  assert.ok(none.offsets.every((o) => o === 0));
});
