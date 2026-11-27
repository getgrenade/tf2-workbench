import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GLOW, layerGlow, shotRegions, type PromoLayer, type ShotSpec } from "../src/viewer/promo.ts";

const shot = { role: 0, loadout: [], weapon: null, regions: null, yaw: 0, pitch: 0, fill: 1, w: 1, h: 1 } as ShotSpec;

test("a shot layer glows as the board says, unless it says otherwise; other layers never", () => {
  const on = { glow: { on: true, size: 30, strength: 0.4 } }, off = { glow: { ...DEFAULT_GLOW, on: false } };
  const l = { shot } as PromoLayer;
  assert.equal(layerGlow(l, on)?.size, 30);
  assert.equal(layerGlow(l, off), null);
  assert.equal(layerGlow({ ...l, glow: true }, off)?.size, DEFAULT_GLOW.size);
  assert.equal(layerGlow({ ...l, glow: true }, {})?.strength, DEFAULT_GLOW.strength);
  assert.equal(layerGlow({ ...l, glow: false }, on), null);
  assert.equal(layerGlow({ glow: true } as PromoLayer, on), null);
});

test("a shot with its player hidden draws no part of the character", () => {
  assert.equal(shotRegions(shot), null);
  assert.deepEqual(shotRegions({ ...shot, regions: ["head"] }), ["head"]);
  assert.deepEqual(shotRegions({ ...shot, hidePlayer: true }), []);
});
