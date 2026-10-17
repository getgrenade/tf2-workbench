// The settings of the real shadows (drawn as Source Filmmaker draws them): the quality of the rig and the strength of a light's shadows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SHADOW_QUALITY, parseLightingRig, parseShadowQuality } from "../src/viewer/lighting.ts";

test("the shadows keep the engine's defaults and stay inside their limits", () => {
  assert.deepEqual(DEFAULT_SHADOW_QUALITY, { resolution: 2048, filter: 3, depthBias: .0005, slopeBias: 16, tint: "#000000" });
  const wild = parseShadowQuality({ resolution: 3000, filter: 99, depthBias: -1, slopeBias: 1000 });
  assert.deepEqual(wild, { ...DEFAULT_SHADOW_QUALITY, filter: 12, depthBias: 0, slopeBias: 64 });
  assert.equal(parseShadowQuality({ filter: "x" }).filter, 3);
});

test("the settings of the shadows there were before are left behind (their bias meant something else)", () => {
  const old = parseShadowQuality({ resolution: 4096, softness: .4, bias: .004, method: "ray", selfShadow: true, contact: 1 });
  assert.deepEqual(old, { ...DEFAULT_SHADOW_QUALITY, resolution: 4096 });
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

test("the shadow colour keeps to its form", () => {
  assert.equal(parseShadowQuality({ tint: "#4D79FF" }).tint, "#4d79ff");
  assert.equal(parseShadowQuality({ tint: "blue" }).tint, "#000000");
});

test("a light keeps its shadow softness and falloff curve only when they are not 1", () => {
  const rig = parseLightingRig({ lights: [{ type: "spot", shadows: true, shadowSoftness: 2, curve: 9 }, { type: "spot", shadows: true, shadowSoftness: 1, curve: 1 }] });
  assert.deepEqual([rig.lights[0].shadowSoftness, rig.lights[0].curve], [2, 4]);
  assert.equal("shadowSoftness" in rig.lights[1] || "curve" in rig.lights[1], false);
});
