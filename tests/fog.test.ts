// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FOG, parseFog } from "../src/viewer/fog.ts";

test("a scene without fog gives none, and bad values are replaced", () => {
  assert.equal(parseFog(undefined), undefined);
  const f = parseFog({ enabled: true, color: "red", top: 3, bottom: -1, middle: "x", softness: 0 })!;
  assert.equal(f.enabled, true);
  assert.equal(f.color, DEFAULT_FOG.color);
  assert.equal(f.top, 1);
  assert.equal(f.bottom, 0);
  assert.equal(f.middle, DEFAULT_FOG.middle);
  assert.ok(f.softness > 0);
});

test("a good fog is kept as it is", () => {
  const f = { enabled: true, color: "#112233", top: 0.4, bottom: 0.1, middle: 0.3, softness: 0.5, view: false };
  assert.deepEqual(parseFog(f), f);
});

test("a fog of the view is kept, and an older fog (without the setting) lies in the world", () => {
  assert.equal(parseFog({ enabled: true, view: true })?.view, true);
  assert.equal(parseFog({ enabled: true, color: "#112233", top: 0.4, bottom: 0.1, middle: 0.3, softness: 0.5 })?.view, false);
});
