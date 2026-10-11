// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { PART_SUFFIX, parseLightsFile, parsePostFile, partFilter, partPath, sceneBaseName } from "../src/viewer/sceneParts.ts";

test("a part always ends with its own suffix, whatever the dialog gave back", () => {
  assert.equal(partPath("C:\\scenes\\duel", "lights"), "C:\\scenes\\duel.l.json");
  assert.equal(partPath("C:\\scenes\\duel.json", "lights"), "C:\\scenes\\duel.l.json");
  assert.equal(partPath("C:\\scenes\\duel.l.json", "lights"), "C:\\scenes\\duel.l.json");
  assert.equal(partPath("C:\\scenes\\duel.p.json", "post"), "C:\\scenes\\duel.p.json");
  assert.equal(partPath("/x/duel.l.json", "post"), "/x/duel.p.json", "a lights name picked for post-processing is renamed, not stacked");
  assert.equal(partPath("duel.JSON", "post"), "duel.p.json");
  assert.equal(PART_SUFFIX.post, ".p.json");
});

test("the dialog filters show only the part's files", () => {
  assert.deepEqual(partFilter("lights")[0].extensions, ["l.json"]);
  assert.deepEqual(partFilter("post")[0].extensions, ["p.json"]);
});

test("the name of a file is without the folder and the ending", () => {
  assert.equal(sceneBaseName("C:\\a\\b\\duel.json"), "duel");
  assert.equal(sceneBaseName("C:\\a\\b\\duel.l.json"), "duel");
  assert.equal(sceneBaseName("/a/duel.p.json"), "duel");
});

const lights = { app: "tf2-workbench", kind: "lights", version: 1, light: { azimuth: 30, elevation: 40, intensity: 1.5, color: "#ffeecc", ambient: 0.2, ambientColor: "#aabbcc", followCamera: false, rig: { lights: [] } }, pointLight: { enabled: true, azimuth: 0, elevation: 0, distance: 1, range: 2, falloff: 1, intensity: 1, color: "#ffffff" } };

test("a lights file is read, with what is missing put right", () => {
  const parsed = parseLightsFile(JSON.stringify(lights));
  assert.equal(parsed.light.azimuth, 30);
  assert.equal(parsed.light.followCamera, false);
  assert.ok(parsed.light.rig);
  assert.equal(parsed.pointLight?.enabled, true);
  const odd = parseLightsFile(JSON.stringify({ ...lights, light: { azimuth: "x", color: "red", ambient: 5 }, pointLight: 3 }));
  assert.equal(odd.light.azimuth, 0);
  assert.equal(odd.light.color, "#ffffff");
  assert.equal(odd.light.ambient, 5);
  assert.equal(odd.pointLight, undefined);
});

test("a file for something else is told so", () => {
  const post = { app: "tf2-workbench", kind: "post", version: 1, fogs: [{ enabled: true }] };
  assert.throws(() => parseLightsFile(JSON.stringify(post)), /post-processing file, not a lights file/);
  assert.throws(() => parsePostFile(JSON.stringify(lights)), /lights file, not a post-processing file/);
  assert.throws(() => parseLightsFile(JSON.stringify({ app: "tf2-workbench", version: 1, entities: [] })), /scene, not a lights file/);
  assert.throws(() => parseLightsFile("{"), /invalid JSON/);
  assert.throws(() => parseLightsFile(JSON.stringify({ ...lights, app: "other" })), /not a TF2 Workbench file/);
  assert.throws(() => parseLightsFile(JSON.stringify({ ...lights, version: 2 })), /version 2/);
  assert.throws(() => parseLightsFile(JSON.stringify({ ...lights, light: null })), /no lights/);
});

test("a post-processing file keeps its lists", () => {
  const parsed = parsePostFile(JSON.stringify({ app: "tf2-workbench", kind: "post", version: 1, fogs: [{ a: 1 }, { a: 2 }], aos: [], look: { vignette: { enabled: true } }, shadows: "no" }));
  assert.equal(parsed.fogs?.length, 2);
  assert.deepEqual(parsed.aos, []);
  assert.equal(parsed.shadows, undefined);
  assert.deepEqual(parsed.look, { vignette: { enabled: true } });
});
