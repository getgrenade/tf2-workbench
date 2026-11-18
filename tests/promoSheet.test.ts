import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetLayout } from "../src/viewer/promoPsd.ts";

test("the pictures of one Photoshop file are laid out in rows, apart, never over each other", () => {
  const sizes = [{ w: 1920, h: 1080 }, { w: 1920, h: 1080 }, { w: 512, h: 512 }, { w: 512, h: 512 }];
  const at = sheetLayout(sizes, 100);
  assert.deepEqual(at.slice(0, 4), [{ x: 0, y: 0 }, { x: 2020, y: 0 }, { x: 0, y: 1180 }, { x: 612, y: 1180 }]);
  assert.equal(at.width, 3940);
  assert.equal(at.height, 1692);
  for (let i = 0; i < sizes.length; i++) for (let j = i + 1; j < sizes.length; j++) {
    const a = { ...at[i], ...sizes[i] }, b = { ...at[j], ...sizes[j] };
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${i} and ${j} overlap`);
  }
});

test("a picture wider than a row has a row of its own", () => {
  const at = sheetLayout([{ w: 6000, h: 100 }, { w: 100, h: 100 }], 10);
  assert.deepEqual(at.slice(0, 2), [{ x: 0, y: 0 }, { x: 0, y: 110 }]);
});
