// Where the eyes look, as C_BaseFlex::SetViewTarget works it out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { viewTargetLocal } from "../src/viewer/gaze.ts";

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test("a target ahead is kept, one too close is pushed to 6 units ahead, and one off to the side is held to 30 degrees", () => {
  assert.ok(close(viewTargetLocal([512, 0, 0], 0, 0), [512, 0, 0]));
  const near = viewTargetLocal([1, 0, 0], 0, 0);
  assert.ok(close(near, [6, 0, 0]));
  const side = viewTargetLocal([10, 100, 0], 0, 0);
  const len = Math.hypot(...side);
  assert.ok(Math.abs(len - Math.hypot(10, 100)) < 1e-6, "the distance is kept");
  assert.ok(Math.abs(side[0] / len - 0.866) < 1e-6 && side[1] > 0, "on the edge of the cone, on the same side");
});

test("the eye controllers turn the eyes from the target", () => {
  const [, y, z] = viewTargetLocal([100, 0, 0], 10, 20);
  assert.ok(y > 0, "right-left turns them sideways");
  assert.ok(z < 0, "up-down (positive) turns them down");
});
