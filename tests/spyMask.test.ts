import { test } from "node:test";
import assert from "node:assert/strict";
import { spyMaskFamily } from "../src/viewer/spyMask.ts";

test("a disguise mask's skin family follows the game's class numbers (Scout first, Engineer last)", () => {
  assert.equal(spyMaskFamily("scout"), 4);
  assert.equal(spyMaskFamily("soldier"), 8);
  assert.equal(spyMaskFamily("engineer"), 20);
  assert.equal(spyMaskFamily(null), null);
  assert.equal(spyMaskFamily("nonsense"), null);
});
