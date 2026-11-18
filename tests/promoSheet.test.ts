import { test } from "node:test";
import assert from "node:assert/strict";
import { stackSize } from "../src/viewer/promoPsd.ts";

test("the pictures of one Photoshop file are stacked at the pictures' own size, not laid side by side", () => {
  assert.deepEqual(stackSize([{ w: 1920, h: 1080 }, { w: 1920, h: 1080 }]), { width: 1920, height: 1080 });
  // pictures of different sizes: the largest of each side
  assert.deepEqual(stackSize([{ w: 1920, h: 1080 }, { w: 512, h: 2048 }]), { width: 1920, height: 2048 });
});
