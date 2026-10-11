// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { backdropCorner } from "../src/viewer/backdropImage.ts";

const FULL = { x0: -1, y0: -1, x1: 1, y1: 1 };
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const at = (bg: { x: number; y: number; size: number; aspect: number; rotation: number }, frame: typeof FULL, aspect: number, ox: number, oy: number) => backdropCorner(bg, frame, aspect, ox, oy);

test("a picture as tall as the frame, in its middle, with the frame's shape, fills the frame", () => {
  const bg = { x: 0.5, y: 0.5, size: 1, aspect: 16 / 9, rotation: 0 };
  const [x0, y1] = at(bg, FULL, 16 / 9, -0.5, 0.5), [x1, y0] = at(bg, FULL, 16 / 9, 0.5, -0.5);
  assert.ok(close(x0, -1) && close(x1, 1) && close(y0, -1) && close(y1, 1));
});

test("a wider picture reaches past the sides, and a smaller one sits in the middle", () => {
  const wide = { x: 0.5, y: 0.5, size: 1, aspect: 2 * 16 / 9, rotation: 0 };
  assert.ok(close(at(wide, FULL, 16 / 9, -0.5, 0)[0], -2) && close(at(wide, FULL, 16 / 9, 0.5, 0)[0], 2));
  const small = { x: 0.5, y: 0.5, size: 0.5, aspect: 16 / 9, rotation: 0 };
  assert.ok(close(at(small, FULL, 16 / 9, -0.5, 0.5)[0], -0.5) && close(at(small, FULL, 16 / 9, 0.5, -0.5)[1], -0.5));
});

test("the frame's y runs down, the screen's up; and a frame that is part of the screen carries the picture with it", () => {
  // the middle of the picture a quarter of the way down the frame is above the middle of the screen
  const top = { x: 0.5, y: 0.25, size: 0.2, aspect: 1, rotation: 0 };
  assert.ok(close(at(top, FULL, 1, 0, 0)[1], 0.5));
  // a square picture as tall as a frame that is half as wide as it is tall is twice as wide as the frame, centred on it
  const half = { x0: 0, y0: -1, x1: 1, y1: 1 };
  const bg = { x: 0.5, y: 0.5, size: 1, aspect: 1, rotation: 0 };
  assert.ok(close(at(bg, half, 0.5, -0.5, 0)[0], -0.5) && close(at(bg, half, 0.5, 0.5, 0)[0], 1.5));
});

test("a turn is clockwise on the screen, about the middle of the picture", () => {
  // a picture twice as wide as it is tall, turned a quarter clockwise: its right end goes to the bottom, its top to the right
  const bg = { x: 0.5, y: 0.5, size: 0.5, aspect: 2, rotation: 90 };
  const [x, y] = at(bg, FULL, 1, 0.5, 0);
  assert.ok(close(x, 0) && close(y, -1), `right end at ${x}, ${y}`);
  const [tx, ty] = at(bg, FULL, 1, 0, 0.5);
  assert.ok(close(tx, 0.5) && close(ty, 0), `top middle at ${tx}, ${ty}`);
});
