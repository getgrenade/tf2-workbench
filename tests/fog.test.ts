// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FOG, MIST_PRESET, parseFog } from "../src/viewer/fog.ts";

test("a scene without fog gives none, and bad values are replaced", () => {
  assert.equal(parseFog(undefined), undefined);
  const f = parseFog({ enabled: true, color: "red", top: 3, bottom: -1, middle: "x", softness: 0 })!;
  assert.equal(f.enabled, true);
  assert.equal(f.color, DEFAULT_FOG.color);
  assert.equal(f.top, 1);
  assert.equal(f.bottom, 0);
  assert.equal(f.middle, DEFAULT_FOG.middle);
  assert.ok(f.softness > 0);
});

test("a good fog is kept as it is", () => {
  const f = { enabled: true, color: "#112233", top: 0.4, bottom: 0.1, middle: 0.3, softness: 0.5, view: false, ...MIST_PRESET, style: "mist" as const, scale: 1.7, speed: 0.3, wind: 120, detail: 2, coverage: 0.6, shafts: 0.2, bands: 3 };
  assert.deepEqual(parseFog(f), f);
});

test("an older fog (a gradient, without the mist settings) is a gradient, and the mist settings are kept in range", () => {
  const old = parseFog({ enabled: true, color: "#112233", top: 0.4, bottom: 0.1, middle: 0.3, softness: 0.5, view: false });
  assert.equal(old?.style, "gradient");
  assert.equal(old?.scale, DEFAULT_FOG.scale);
  const wild = parseFog({ enabled: true, style: "mist", scale: 99, speed: -5, detail: 40, coverage: 7, bands: 3.4, wind: 1000 });
  assert.equal(wild?.style, "mist");
  assert.ok(wild!.scale <= 6 && wild!.speed >= 0 && wild!.detail <= 4 && wild!.coverage <= 1 && wild!.wind <= 360);
  assert.equal(wild?.bands, 3);
  assert.equal(parseFog({ enabled: true, style: "fancy" })?.style, "gradient");
});

test("a fog of the view is kept, and an older fog (without the setting) lies in the world", () => {
  assert.equal(parseFog({ enabled: true, view: true })?.view, true);
  assert.equal(parseFog({ enabled: true, color: "#112233", top: 0.4, bottom: 0.1, middle: 0.3, softness: 0.5 })?.view, false);
});
