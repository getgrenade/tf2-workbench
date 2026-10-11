import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RIM_LIGHT, parseRimLight } from "../../src/viewer/rimLight";
import { parseScene } from "../../src/viewer/scene";

test("rim light defaults off and bounds imported settings", () => {
  assert.deepEqual(parseRimLight(undefined), DEFAULT_RIM_LIGHT);
  assert.deepEqual(parseRimLight({ enabled: true, color: "invalid", strength: 100, width: -1, direction: 999, softness: NaN }),
    { ...DEFAULT_RIM_LIGHT, enabled: true, strength: 8, width: .02, direction: 180 });
});

test("scene round trips preserve rim lighting; older scenes leave it off", () => {
  const scene = { app: "tf2-workbench", version: 1, entities: [{ cls: "spy", team: 0 }],
    camera: { position: [0, 70, 160], target: [0, 35, 0] },
    rimLight: { ...DEFAULT_RIM_LIGHT, enabled: true, color: "#ffccee", direction: 45, width: .4, allAround: true, painted: true, cutoff: .45, edgeSoftness: .1 } };
  assert.deepEqual(parseScene(JSON.stringify(scene)).rimLight, scene.rimLight);
  assert.equal(parseScene(JSON.stringify({ ...scene, rimLight: undefined })).rimLight?.enabled, false);
  assert.equal(parseRimLight({ enabled: true, width: .3 }).painted, false);
});
