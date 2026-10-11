// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_GROUND, groundFade, parseGround } from "../src/viewer/groundPlane.ts";

test("the fade of the ground ends at its distance (in characters) and starts earlier by its softness", () => {
  const f = groundFade({ ...DEFAULT_GROUND, distance: 10, softness: 0.6 }, 80);
  assert.equal(f.end, 800);
  assert.equal(f.start, 320);
  assert.equal(groundFade({ ...DEFAULT_GROUND, distance: 10, softness: 0 }, 80).start, 800, "no softness: an edge");
});

test("a ground from a scene file is checked", () => {
  assert.equal(parseGround(undefined), undefined);
  const g = parseGround({ enabled: true, color: "nope", opacity: 5, distance: -3, softness: "x" })!;
  assert.deepEqual(g, { enabled: true, color: DEFAULT_GROUND.color, opacity: 1, distance: 1, softness: DEFAULT_GROUND.softness });
});
