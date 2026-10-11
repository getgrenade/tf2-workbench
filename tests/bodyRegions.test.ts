// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGION_KEYS, boneRegions, defaultRegionsFor, hiddenWeights, packMask, unpackMask } from "../src/viewer/bodyRegions.ts";

const idx = (k: string) => (REGION_KEYS as readonly string[]).indexOf(k);

test("bones take the part of their nearest body ancestor", () => {
  const names = ["bip_pelvis", "bip_spine_0", "bip_hand_L", "bip_thumb_0_L", "prp_pouch", "bip_head", "prp_hat"];
  const parents = [-1, 0, 1, 2, 1, 1, 5];
  const r = boneRegions(names, parents);
  assert.equal(r[2], idx("handL"));
  assert.equal(r[3], idx("handL"));
  assert.equal(r[4], idx("spine0"));
  assert.equal(r[6], idx("head"));
});

test("a vertex is as hidden as the weights of its bones in hidden parts", () => {
  const keep = [true, false];
  // vertex 0: bone 0 (part 0, shown) 0.75 and bone 1 (part 1, hidden) 0.25; vertex 1: only the hidden bone
  const out = hiddenWeights([0, 1, 0, 0, 1, 0, 0, 0], [0.75, 0.25, 0, 0, 1, 0, 0, 0], [0, 1], keep);
  assert.ok(Math.abs(out[0] - 0.25) < 1e-6);
  assert.equal(out[1], 1);
});

test("defaults follow the equip region", () => {
  assert.ok(defaultRegionsFor(["whole_head"]).includes("head"));
  assert.ok(!defaultRegionsFor(["hat"]).includes("thighL"));
  const shirt = defaultRegionsFor(["shirt"]);
  assert.ok(shirt.includes("forearmR") && shirt.includes("pelvis") && !shirt.includes("head") && !shirt.includes("shinL"));
  assert.deepEqual(defaultRegionsFor(["something_odd"]), []);
});

test("masks survive packing", () => {
  const mask = new Uint8Array(21);
  mask[0] = mask[9] = mask[20] = 1;
  assert.deepEqual([...unpackMask(packMask(mask), 21)], [...mask]);
});
