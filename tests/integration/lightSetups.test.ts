import assert from "node:assert/strict";
import test from "node:test";
import { captureLightSetup, lightSetupState, parseLightSetup } from "../../src/viewer/lightSetups";
import { defaultLightingRig, newRigLight, spotLightRotation } from "../../src/viewer/lighting";

function source() {
  const rig = defaultLightingRig();
  rig.mode = "advanced"; rig.marker = true;
  const spot = newRigLight("light-0", "spot", [13, 27, -54]);
  spot.azimuth = 81; spot.elevation = -24; spot.rotation = spotLightRotation(spot).toArray();
  spot.shadows = true; spot.range = 410; spot.intensity = 2.4;
  rig.lights = [spot]; rig.selected = spot.id;
  return { azimuth: 0, elevation: 0, intensity: 1, color: "#ffffff", ambient: .42, ambientColor: "#abcdef", followCamera: true, rig };
}

test("standalone presets preserve both rigs, ambient, favorite and spot orientation without scene data", () => {
  const light = source(), original = structuredClone(light);
  const setup = captureLightSetup({ ...light, characters: ["should not save"] } as typeof light, true);
  const restored = parseLightSetup(JSON.stringify(setup));
  assert.equal(restored.favorite, true);
  assert.equal(restored.light.ambient, .42);
  assert.equal(restored.light.ambientColor, "#abcdef");
  assert.deepEqual(restored.light.rig?.lights, light.rig.lights);
  assert.deepEqual(restored.light.rig?.simple, light.rig.simple);
  assert.equal(restored.light.rig?.marker, false);
  assert.ok(!JSON.stringify(setup).includes("characters"));
  assert.deepEqual(light, original);
});

test("applying a preset replaces the old lights and gives each application independent data", () => {
  const setup = captureLightSetup(source());
  const current = source(); current.rig.lights.push(newRigLight("light-1"));
  const applied = { ...current, ...lightSetupState(setup) };
  assert.equal(applied.rig?.lights.length, 1);
  applied.rig!.lights[0].position[0] = 999;
  assert.equal(lightSetupState(setup).rig!.lights[0].position[0], 13);
  assert.equal(setup.light.rig!.lights[0].position[0], 13);
});

test("rejects scenes, unsupported versions and invalid ambient data", () => {
  assert.throws(() => parseLightSetup(JSON.stringify({ characters: [], light: source() })));
  const setup = captureLightSetup(source());
  assert.throws(() => parseLightSetup(JSON.stringify({ ...setup, version: 2 })));
  assert.throws(() => parseLightSetup(JSON.stringify({ ...setup, light: { ...setup.light, ambient: -1 } })));
  assert.throws(() => parseLightSetup(JSON.stringify({ ...setup, light: { ...setup.light, ambientColor: "bad" } })));
});
