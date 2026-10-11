// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { boxMode, combine, normalizeRect, rectsOverlap } from "../src/viewer/boxSelect.ts";

const keys = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

test("shift adds, ctrl takes away, no key replaces (alt is left to the orbit)", () => {
  assert.equal(boxMode(keys), "replace");
  assert.equal(boxMode({ ...keys, shiftKey: true }), "add");
  assert.equal(boxMode({ ...keys, ctrlKey: true }), "subtract");
  assert.equal(boxMode({ ...keys, altKey: true }), "replace");
  assert.equal(boxMode({ ...keys, shiftKey: true, ctrlKey: true }), "subtract");
});

test("a drag in any direction is the same box", () => {
  assert.deepEqual(normalizeRect(50, 80, 10, 20), { x0: 10, y0: 20, x1: 50, y1: 80 });
  assert.deepEqual(normalizeRect(10, 20, 50, 80), { x0: 10, y0: 20, x1: 50, y1: 80 });
});

test("boxes that share any area overlap", () => {
  const box = { x0: 10, y0: 10, x1: 50, y1: 50 };
  assert.equal(rectsOverlap(box, { x0: 40, y0: 40, x1: 90, y1: 90 }), true);
  assert.equal(rectsOverlap(box, { x0: 0, y0: 0, x1: 100, y1: 100 }), true);
  assert.equal(rectsOverlap(box, { x0: 51, y0: 10, x1: 90, y1: 50 }), false);
  assert.equal(rectsOverlap(box, { x0: 10, y0: 60, x1: 50, y1: 90 }), false);
});

test("the selection after a box", () => {
  const id = (s: string) => s;
  assert.deepEqual(combine(["a", "b"], ["c"], "replace", id), ["c"]);
  assert.deepEqual(combine(["a", "b"], ["b", "c"], "add", id), ["a", "b", "c"]);
  assert.deepEqual(combine(["a", "b", "c"], ["b", "x"], "subtract", id), ["a", "c"]);
  assert.deepEqual(combine(["a"], ["a"], "subtract", id), []);
});
