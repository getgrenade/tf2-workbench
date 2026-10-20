// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { newRigLight, parseLightingRig } from "../src/viewer/lighting.ts";

test("a new area light is a wide strip that casts no shadow", () => {
  const l = newRigLight("light-0", "area");
  assert.equal(l.type, "area");
  assert.ok(l.width! > l.height!);
  assert.equal(l.shadows, false);
});

test("an area light keeps its size, turn and type through a save, and its size stays in range", () => {
  const rig = parseLightingRig({ lights: [{ ...newRigLight("light-0", "area"), width: 120, height: 9999, shadows: true, azimuth: 180, elevation: 30 }] });
  const l = rig.lights[0];
  assert.equal(l.type, "area");
  assert.equal(l.width, 120);
  assert.equal(l.height, 2000);
  assert.equal(l.shadows, false);
  assert.deepEqual(parseLightingRig(JSON.parse(JSON.stringify(rig))).lights[0], l);
});

test("lights that are not area lights have no panel size", () => {
  const rig = parseLightingRig({ lights: [newRigLight("light-0", "point")] });
  assert.equal(rig.lights[0].width, undefined);
});
