// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { boxShape, brushShape, lassoShape } from "../src/viewer/screenShapes.ts";

// a big triangle: (0,0) (100,0) (0,100)
const T = [0, 0, 100, 0, 0, 100] as const;

test("a box touches a triangle it overlaps, even inside a big one, and misses one beside it", () => {
  assert.ok(boxShape(10, 10, 20, 20).hits(...T)); // inside the triangle, no corner of the triangle in the box
  assert.ok(boxShape(90, -10, 120, 5).hits(...T)); // across an edge
  assert.ok(!boxShape(80, 80, 120, 120).hits(...T)); // past the long edge
  assert.ok(boxShape(-10, -10, 200, 200).hits(...T)); // swallowing it
});

test("a brush touches a triangle within its radius, whatever the triangle's size", () => {
  assert.ok(brushShape(30, 30, 30, 30, 2).hits(...T)); // centre inside a large triangle
  assert.ok(brushShape(110, 0, 110, 0, 12).hits(...T)); // just outside a corner, in reach
  assert.ok(!brushShape(130, 0, 130, 0, 12).hits(...T));
  assert.ok(brushShape(120, 50, 40, 50, 3).hits(...T)); // a stroke that crosses the edge
});

test("a lasso picks by corners, middle, or starting inside the triangle", () => {
  const around: [number, number][] = [[-10, -10], [110, -10], [110, 110], [-10, 110]];
  assert.ok(lassoShape(around).hits(...T));
  const tiny: [number, number][] = [[20, 20], [24, 20], [24, 24], [20, 24]];
  assert.ok(lassoShape(tiny).hits(...T)); // a small loop inside a large triangle
  const away: [number, number][] = [[200, 200], [220, 200], [220, 220]];
  assert.ok(!lassoShape(away).hits(...T));
});
