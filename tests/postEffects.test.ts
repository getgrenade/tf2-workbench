// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { canAdd, newPostId, postLabel, statesOf, type PostItem } from "../src/viewer/postStack.ts";
import { defaultLightingRig, parseLightingRig, worldDirection } from "../src/viewer/lighting.ts";

test("an effect can be in the list several times, up to what the renderer lays over each other", () => {
  const items: PostItem[] = [{ id: "post-1", kind: "shadow", state: { enabled: true } }];
  assert.equal(canAdd(items, "fog"), true);
  for (let i = 0; i < 3; i++) items.push({ id: newPostId(items), kind: "fog", state: { enabled: true } });
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, "ids are unique");
  assert.equal(canAdd(items, "fog"), false);
  assert.equal(canAdd(items, "ao"), true);
  assert.deepEqual(items.filter((i) => i.kind === "fog").map((i) => postLabel(items, i)), ["Fog 1", "Fog 2", "Fog 3"]);
  assert.equal(postLabel(items, items[0]), "Ground shadows");
  assert.equal(statesOf(items, "fog").length, 3);
});

test("a scene of the old Simple mode brings its enabled lights as lights that follow the camera", () => {
  const old = defaultLightingRig() as any;
  old.mode = "simple";
  old.simple = [{ ...old.lights[0], id: "simple-0", enabled: true }, { ...old.lights[0], id: "simple-1", enabled: false }, { ...old.lights[0], id: "simple-2", enabled: true, azimuth: 240 }];
  old.selected = "simple-2";
  delete old.lights;
  const rig = parseLightingRig(old);
  assert.equal(rig.lights.length, 2);
  assert.ok(rig.lights.every((l) => l.followCamera === true && l.type === "directional"));
  assert.equal(rig.selected, "light-1");
});

test("only a light that follows the camera turns with it", async () => {
  const THREE = await import("three");
  const light = { ...parseLightingRig(defaultLightingRig()).lights[0] };
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const follows = worldDirection(light, turn);
  assert.ok(Math.abs(follows.x - 1) < 1e-6, "turned a quarter around Y: +Z becomes +X");
  delete light.followCamera;
  assert.ok(Math.abs(worldDirection(light, turn).z - 1) < 1e-6);
});
