// The settings of the real shadows: the quality of the rig and the strength and size of a light's shadows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SHADOW_QUALITY, parseLightingRig, parseShadowQuality } from "../src/viewer/lighting.ts";

test("the shadow quality keeps its detail, contact shadows and terminator fix inside their limits, and old scenes get the defaults", () => {
  assert.deepEqual(parseShadowQuality({ resolution: 2048, softness: .1, bias: .0003 }), { ...DEFAULT_SHADOW_QUALITY, resolution: 2048, softness: .1, bias: .0003 });
  const q = parseShadowQuality({ detail: 9, contact: 5, contactLength: 99, terminator: 9 });
  assert.deepEqual([q.detail, q.contact, q.contactLength, q.terminator], [4, 1, 10, 4]);
  const low = parseShadowQuality({ detail: -1, contact: -1, contactLength: 0, terminator: -2 });
  assert.deepEqual([low.detail, low.contact, low.contactLength, low.terminator], [0, 0, .5, 0]);
  assert.equal(parseShadowQuality({ contact: "x" }).contact, DEFAULT_SHADOW_QUALITY.contact);
  assert.equal(DEFAULT_SHADOW_QUALITY.contact, 0, "contact shadows are off until asked for");
  assert.deepEqual([DEFAULT_SHADOW_QUALITY.resolution, DEFAULT_SHADOW_QUALITY.softness, DEFAULT_SHADOW_QUALITY.bias, DEFAULT_SHADOW_QUALITY.detail, DEFAULT_SHADOW_QUALITY.contactLength, DEFAULT_SHADOW_QUALITY.terminator], [2048, .1, .001, 4, 4, 1]);
  assert.equal(parseShadowQuality({ tint: "#4D79FF" }).tint, "#4d79ff");
  assert.equal(parseShadowQuality({ tint: "blue" }).tint, "#000000");
});

test("a light keeps its shadow strength only when it is not the default", () => {
  const rig = parseLightingRig({
    lights: [
      { type: "spot", shadows: true, shadowStrength: .4 },
      { type: "point", shadows: true, shadowStrength: 1 },
      { type: "spot", shadows: true, shadowStrength: -3 },
    ],
  });
  assert.equal(rig.lights[0].shadowStrength, .4);
  assert.equal("shadowStrength" in rig.lights[1], false);
  assert.equal(rig.lights[2].shadowStrength, 0);
});
