// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { gazeTargetLocal } from "../src/viewer/gaze.ts";

const near = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 5e-3, `${a} vs ${b}`));

test("with no deflection the gaze target is 32 units straight ahead", () => {
  near(gazeTargetLocal(0, 0), [32, 0, 0]);
});

test("small deflections tilt the gaze without clamping", () => {
  const [x, y, z] = gazeTargetLocal(0, 10); // 10 degrees right/left
  assert.ok(x > 31 && x < 32 && y > 5 && y < 6 && Math.abs(z) < 1e-6);
});

test("large deflections are clamped to the 30 degree cone", () => {
  const [x, y, z] = gazeTargetLocal(0, 45);
  near([x, y, z], [32 * 0.866, 16, 0]);
  const [x2, y2, z2] = gazeTargetLocal(45, 0); // looking up/down
  assert.ok(Math.abs(x2 - 32 * 0.866) < 5e-3 && Math.abs(y2) < 1e-6 && Math.abs(Math.hypot(y2, z2) - 16) < 5e-3);
});
