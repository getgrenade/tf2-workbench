// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutChart } from "../src/viewer/chartLayout.ts";

const base = { width: 1920, height: 1080, gapX: 10, gapY: 10, padding: 20, cols: 0 };

test("the grid fits inside the picture, centred, whatever the number of pictures", () => {
  for (const n of [1, 5, 14, 45]) {
    const l = layoutChart(n, 1, base);
    assert.equal(l.width, 1920);
    assert.equal(l.height, 1080);
    assert.equal(l.rects.length, n);
    for (const r of l.rects) assert.ok(r.x >= base.padding - 1e-6 && r.y >= base.padding - 1e-6 && r.x + r.w <= l.width - base.padding + 1e-6 && r.y + r.h <= l.height - base.padding + 1e-6);
    const top = Math.min(...l.rects.map((r) => r.y)), bottom = Math.max(...l.rects.map((r) => r.y + r.h));
    assert.ok(Math.abs(top - (l.height - bottom)) < 1e-6); // centred up and down
  }
});

test("an incomplete last row is centred", () => {
  const l = layoutChart(5, 1, { ...base, cols: 3 });
  const row0 = l.rects.slice(0, 3), row1 = l.rects.slice(3);
  const mid0 = (row0[0].x + row0[2].x + row0[2].w) / 2;
  const mid1 = (row1[0].x + row1[1].x + row1[1].w) / 2;
  assert.ok(Math.abs(mid0 - mid1) < 1e-6);
});

test("automatic columns give the biggest cells and removing items makes them bigger", () => {
  const many = layoutChart(45, 1, base);
  for (let c = 1; c <= 45; c++) assert.ok(many.cellW >= layoutChart(45, 1, { ...base, cols: c }).cellW - 1e-6);
  const few = layoutChart(15, 1, base);
  assert.ok(few.cellW > many.cellW);
  assert.equal(layoutChart(0, 1, base).rects.length, 0);
});

test("larger gaps shrink the cells", () => {
  const tight = layoutChart(12, 1, { ...base, cols: 12, gapX: 0 });
  const loose = layoutChart(12, 1, { ...base, cols: 12, gapX: 120 });
  assert.ok(loose.cellW < tight.cellW);
});
