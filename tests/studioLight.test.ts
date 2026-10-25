// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { DEFAULT_STUDIO, flipStudio, lampAnglesFor, parseStudio, randomStudio, studioAngles, studioAo, studioRigLights } from "../src/viewer/studioLight.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const studio = () => structuredClone(DEFAULT_STUDIO);

test("the classic rig: key on one side and above, fill on the other side and lower and dimmer, rim behind", () => {
  const s = studio();
  assert.ok(s.key.azimuth > 0 && s.fill.azimuth < 0, "key and fill on either side");
  assert.ok(s.fill.intensity < s.key.intensity / 2 && s.fill.elevation < s.key.elevation);
  assert.ok(Math.abs(s.rim.azimuth) > 90, "the rim is behind");
});

test("the pivot turns the three lights together and keeps the angles between them", () => {
  const s = studio();
  const dir = (r: "key" | "fill" | "rim", x = s) => { const [a, e] = studioAngles(x, r); const k = Math.PI / 180; return new THREE.Vector3(Math.sin(a * k) * Math.cos(e * k), Math.sin(e * k), Math.cos(a * k) * Math.cos(e * k)); };
  const before = [dir("key").angleTo(dir("fill")), dir("key").angleTo(dir("rim"))];
  const turned = { ...s, yaw: 70, pitch: -20 };
  near(dir("key", turned).angleTo(dir("fill", turned)), before[0]);
  near(dir("key", turned).angleTo(dir("rim", turned)), before[1]);
  // a yaw alone moves each light round by that much
  near(studioAngles({ ...s, yaw: 30 }, "key")[0], s.key.azimuth + 30);
  near(studioAngles({ ...s, yaw: 30 }, "key")[1], s.key.elevation);
});

test("a light dragged to where it is seen is put back under the pivot", () => {
  const s = { ...studio(), yaw: 50, pitch: 15 };
  const [a, e] = lampAnglesFor(s, 10, 20);
  const seen = studioAngles({ ...s, key: { ...s.key, azimuth: a, elevation: e } }, "key");
  near(seen[0], 10, 0.2);
  near(seen[1], 20, 0.2);
});

test("the rig as lights: three directional ones, the key with the shadows, the rim on the Lambert path, fixed in the world with a camera", () => {
  const s = { ...studio(), brightness: 2 };
  const lights = studioRigLights(s);
  assert.equal(lights.length, 3);
  assert.ok(lights.every((l) => l.type === "directional" && l.followCamera));
  assert.deepEqual(lights.map((l) => l.shadows), [true, false, true]);
  assert.equal(lights[2].shadowStrength, 0, "the rim takes the Lambert path, with no shadow of its own");
  near(lights[0].intensity, s.key.intensity * 2);
  // a camera turned half round: what is to the camera's right is to the world's left
  const fixed = studioRigLights(studio(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  assert.ok(fixed.every((l) => !l.followCamera));
  near(fixed[0].azimuth, studio().key.azimuth + 180 > 180 ? studio().key.azimuth - 180 : studio().key.azimuth + 180, 1e-4);
  // a light switched off, or with nothing to give, is off
  assert.equal(studioRigLights({ ...studio(), fill: { ...studio().fill, on: false } })[1].enabled, false);
});

test("a studio light read back from a board: the default where something is missing or wrong", () => {
  assert.deepEqual(parseStudio(undefined), DEFAULT_STUDIO);
  const s = parseStudio({ on: false, yaw: 999, key: { intensity: -1, color: "red" }, ao: "yes" });
  assert.equal(s.on, false);
  assert.equal(s.yaw, 180);
  assert.equal(s.key.intensity, 0);
  assert.equal(s.key.color, DEFAULT_STUDIO.key.color);
  assert.equal(s.ao, DEFAULT_STUDIO.ao);
  assert.deepEqual(s.rim, DEFAULT_STUDIO.rim);
});

test("the occlusion is on only with the rig and its switch", () => {
  assert.equal(studioAo(studio()).enabled, true);
  assert.equal(studioAo({ ...studio(), ao: false }).enabled, false);
  assert.equal(studioAo({ ...studio(), on: false }).enabled, false);
  assert.equal(studioAo({ ...studio(), aoStrength: 0.3 }).strength, 0.3);
});

test("a random setup keeps the rules of three-point lighting, every time", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const colours = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const s = randomStudio(rand);
    assert.ok(Math.sign(s.key.azimuth) === -Math.sign(s.fill.azimuth), "the fill on the other side from the key");
    assert.ok(Math.abs(s.key.azimuth) >= 25 && Math.abs(s.key.azimuth) <= 60 && s.key.elevation >= 20 && s.key.elevation <= 50, "the key to one side and above");
    assert.ok(s.fill.elevation < s.key.elevation, "the fill lower than the key");
    const ratio = s.key.intensity / s.fill.intensity;
    assert.ok(ratio >= 1.9 && ratio <= 8.5, `a key-to-fill ratio of 2:1 to 8:1 (${ratio})`);
    assert.ok(Math.abs(s.rim.azimuth) >= 125 && Math.abs(s.rim.azimuth) <= 165, "the rim behind");
    assert.ok([s.key.color, s.fill.color, s.rim.color].every((c) => /^#[0-9a-f]{6}$/.test(c)));
    assert.deepEqual([s.yaw, s.pitch], [0, 0]);
    colours.add(s.key.color);
  }
  assert.ok(colours.size > 100, "not the same few setups");
});

test("a flipped rig has each light, and the pivot, on the other side, and flipped again is as it was", () => {
  const s = { ...studio(), yaw: 30 };
  const f = flipStudio(s);
  assert.equal(f.key.azimuth, -s.key.azimuth);
  assert.equal(f.fill.azimuth, -s.fill.azimuth);
  assert.equal(f.rim.azimuth, -s.rim.azimuth);
  assert.equal(f.yaw, -30);
  assert.equal(f.key.elevation, s.key.elevation);
  // as seen from the camera, too: the key on the other side
  const wrap = (a: number) => ((a % 360) + 360) % 360;
  near(wrap(studioAngles(f, "key")[0]), wrap(-studioAngles(s, "key")[0]), 1e-6);
  assert.deepEqual(flipStudio(f), s);
});
