// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AO, aoKernel, parseAo } from "../src/viewer/aoMath.ts";

test("a scene without occlusion gives none, and bad values are replaced", () => {
  assert.equal(parseAo(undefined), undefined);
  const a = parseAo({ enabled: true, strength: 9, radius: -1, power: "x" })!;
  assert.equal(a.enabled, true);
  assert.equal(a.strength, 1);
  assert.equal(a.radius, 0.01);
  assert.equal(a.power, DEFAULT_AO.power);
});

test("the kernel points into the hemisphere and stays inside the unit ball", () => {
  const k = aoKernel(16);
  assert.equal(k.length, 16);
  for (const [x, y, z] of k) {
    assert.ok(z > 0);
    assert.ok(Math.hypot(x, y, z) <= 1);
  }
  assert.deepEqual(aoKernel(16), k);
});
