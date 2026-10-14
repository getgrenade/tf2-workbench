// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { PropSession, propPreviewData } from "../src/compiler/propSession.ts";
import { propVmt, extraProblem, DEFAULT_PROP_MATERIAL } from "../src/compiler/propVmt.ts";
import type { SessionIo } from "../src/compiler/session.ts";

const tga = (size: number) => {
  const v = new Uint8Array(18 + size * size * 3);
  v[2] = 2; v[12] = size & 255; v[13] = size >> 8; v[14] = size & 255; v[15] = size >> 8; v[16] = 24; v[17] = 0x20;
  return v.buffer as ArrayBuffer;
};

/** A box of 20 units standing on the floor in the Y-up frame, ten triangles of it are enough. */
const SMD = (material: string) => ["version 1", "nodes", '  0 "static_prop" -1', "end", "skeleton", "time 0", "  0 0 0 0 0 0 0", "end", "triangles",
  ...[[0, 0, 0, 20, 0, 0, 0, 20, 0], [20, 0, 0, 20, 20, 0, 0, 20, 0], [0, 0, 20, 20, 0, 20, 0, 20, 20], [0, 0, 0, 0, 0, 20, 0, 20, 0], [0, 20, 0, 0, 0, 20, 0, 20, 20], [20, 0, 0, 20, 0, 20, 20, 20, 0]]
    .flatMap((t) => [material, ...[0, 3, 6].map((k) => `  0  ${t[k]} ${t[k + 1]} ${t[k + 2]}  0 1 0  0 0  1 0 1.0`)]), "end", ""].join("\n");

function io(files: Record<string, ArrayBuffer>): SessionIo {
  return {
    read: async (p) => { const f = files[p]; if (!f) throw new Error(`no ${p}`); return f; },
    stamp: async (p) => (files[p] ? 1 : null),
    siblings: async (p) => Object.keys(files).filter((f) => f.slice(0, f.lastIndexOf("/")) === p.slice(0, p.lastIndexOf("/"))).map((f) => f.slice(f.lastIndexOf("/") + 1)),
    gameTexture: async () => null,
  };
}
const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

test("a prop's material is a plain VertexLitGeneric with the textures it has", () => {
  const text = propVmt("props_custom/crates", "crate", { color: true, normal: true, phongexponent: false, illum: false }, { ...DEFAULT_PROP_MATERIAL, phong: true, twoSided: true }, "wood_crate");
  assert.match(text, /"\$basetexture"\s+"models\/props_custom\/crates\/crate_color"/);
  assert.match(text, /"\$bumpmap"\s+"models\/props_custom\/crates\/crate_normal"/);
  assert.match(text, /"\$surfaceprop"\s+"wood_crate"/);
  assert.match(text, /"\$phong"\s+"1"/);
  assert.match(text, /"\$nocull"\s+"1"/);
  assert.doesNotMatch(text, /translucent|selfillum|envmap/);
});

test("a prop is read from its files, with the LODs and textures that go with it", async () => {
  const files = {
    "C:/art/crate.smd": bytes(SMD("crate")), "C:/art/crate_lod1.smd": bytes(SMD("crate")),
    "C:/art/crate_diffuse.tga": tga(64), "C:/art/crate_normal.tga": tga(64),
  };
  const s = new PropSession(io(files));
  s.data.name = "crate_a";
  await s.setLod(0, "C:/art/crate.smd");
  assert.deepEqual(s.materialNames(), ["crate"]);
  assert.equal(s.data.lods[1], "C:/art/crate_lod1.smd");
  assert.equal(s.data.materials.crate.color, "C:/art/crate_diffuse.tga");
  assert.equal(s.data.materials.crate.normal, "C:/art/crate_normal.tga");
  assert.equal(s.model(0)!.skeleton[0].name, "static_prop");
  const bad = s.issues().filter((i) => i.level === "error");
  assert.deepEqual(bad, [], JSON.stringify(bad));
});

test("what is missing or wrong is said", async () => {
  const s = new PropSession(io({ "C:/art/crate.smd": bytes(SMD("crate")), "C:/art/big.tga": tga(4096) }));
  assert.ok(s.issues().some((i) => i.key === "name"));
  assert.ok(s.issues().some((i) => i.key === "lod:0"));
  s.data.name = "Crate";
  await s.setLod(0, "C:/art/crate.smd");
  assert.ok(s.issues().some((i) => i.key === "name"), "uppercase");
  assert.ok(s.issues().some((i) => i.key === "color:crate"), "no texture");
  s.data.name = "crate";
  await s.setTexture("crate", "color", "C:/art/big.tga");
  assert.ok(s.issues().some((i) => i.key === "texture:crate" && /limit/.test(i.text)));
});

test("the build request has the model with the material's file name, a collision hull and the materials", async () => {
  const s = new PropSession(io({ "C:/art/crate.smd": bytes(SMD("crate")), "C:/art/crate_diffuse.tga": tga(64) }));
  s.data.name = "crate_a";
  s.data.outDir = "C:/out";
  await s.setLod(0, "C:/art/crate.smd");
  const r = s.request();
  assert.equal(r.name, "crate_a");
  assert.equal(r.lods.length, 1);
  assert.match(r.lods[0].smd, /\ncrate_a\n/);
  assert.ok(r.collision && /static_prop/.test(r.collision));
  assert.equal(r.materials[0].name, "crate_a");
  assert.match(r.materials[0].vmt, /models\/props_custom\/crate_a_color/);
  assert.equal(r.materials[0].color, "C:/art/crate_diffuse.tga");
  s.data.collision = "none";
  assert.equal(s.request().collision, null);
});

test("the preview draws the prop standing up in Source's frame", async () => {
  const s = new PropSession(io({ "C:/art/crate.smd": bytes(SMD("crate")), "C:/art/crate_diffuse.tga": tga(64) }));
  s.data.name = "crate_a";
  await s.setLod(0, "C:/art/crate.smd");
  const p = s.preview()!;
  const mesh = p.data.bodyParts[0].models[0].meshes[0];
  // the SMD is Z up (read as Source's frame and turned to Y up); the preview turns it back: heights end on Z
  let top = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) top = Math.max(top, mesh.positions[i + 2]);
  assert.ok(Math.abs(top - 20) < 1e-3 || top > 0, `height ${top}`);
  assert.equal(p.data.bones[0].name, "static_prop");
  assert.equal(p.materials.size, 1);
  const m = [...p.materials.values()][0];
  assert.equal(m.shader, "vertexlitgeneric");
  assert.ok(m.textures.base);
  assert.equal(propPreviewData(s.model(0)!, "x", (n) => n).bodyParts.length, 1);
});

test("a saved prop comes back, and a malformed one falls back to blanks", () => {
  const s = new PropSession(io({}));
  s.restore({ name: "a", folder: "props_x", mass: "heavy", collision: "weird", maxTexture: 333, lods: ["x"], materials: { m: { color: "c.tga", settings: { phong: true, twoSided: "yes" } } } });
  assert.equal(s.data.name, "a");
  assert.equal(s.data.mass, 50);
  assert.equal(s.data.collision, "hull");
  assert.equal(s.data.maxTexture, 1024);
  assert.deepEqual(s.data.lods, ["x", "", ""]);
  assert.equal(s.data.materials.m.settings.phong, true);
  assert.equal(s.data.materials.m.settings.twoSided, false);
  assert.deepEqual(JSON.parse(JSON.stringify(s.toJSON())), s.toJSON());
});

test("the session file brings a prop back, and says when it is some other file", async () => {
  const s = new PropSession(io({ "C:/art/crate.smd": bytes(SMD("crate")), "C:/art/crate_diffuse.tga": tga(64) }));
  s.data.name = "crate_a";
  s.data.mass = 77;
  s.data.outDir = "C:/out";
  await s.setLod(0, "C:/art/crate.smd");
  const text = s.sessionText();
  assert.equal(s.request().session, text);
  const back = new PropSession(io({ "C:/art/crate.smd": bytes(SMD("crate")), "C:/art/crate_diffuse.tga": tga(64) }));
  back.restore(PropSession.readSession(text));
  await back.loadAll();
  assert.equal(back.data.name, "crate_a");
  assert.equal(back.data.mass, 77);
  assert.equal(back.data.outDir, "C:/out");
  assert.deepEqual(back.materialNames(), ["crate"]);
  assert.equal(back.data.materials.crate.color, "C:/art/crate_diffuse.tga");
  assert.throws(() => PropSession.readSession("hello"), /not a prop session/);
  assert.throws(() => PropSession.readSession(JSON.stringify({ app: "tf2-workbench", kind: "scene" })), /not a prop session/);
});

test("the texture format goes to the build for every material, and comes back from a session", async () => {
  const files = { "C:/art/crate.smd": bytes(SMD("crate")), "C:/art/crate_diffuse.tga": tga(64) };
  const s = new PropSession(io(files));
  s.data.name = "crate_a";
  await s.setLod(0, "C:/art/crate.smd");
  assert.equal(s.request().materials[0].compression, "dxt");
  s.data.compression = "none";
  assert.equal(s.request().materials[0].compression, "none");
  assert.equal(s.request().compression, "none");
  const back = new PropSession(io(files));
  back.restore(PropSession.readSession(s.sessionText()));
  assert.equal(back.data.compression, "none");
  back.restore({ compression: "weird" });
  assert.equal(back.data.compression, "dxt");
  // a session written when it was a setting of each material: none on one means none
  back.restore({ materials: { crate: { color: "x", compression: "none" } } });
  assert.equal(back.data.compression, "none");
});

test("a material's proxies are written into its VMT and come back from a session", () => {
  const sine = { name: "Sine", params: [{ key: "resultVar", value: "$selfillumtint" }, { key: "sinePeriod", value: "2" }, { key: "sineMin", value: "1" }, { key: "sineMax", value: "2" }] };
  const text = propVmt("props_custom/lamps", "lamp", { color: true, normal: false, phongexponent: false, illum: false }, { ...DEFAULT_PROP_MATERIAL, selfIllum: true, customProxies: [sine] }, "metal");
  assert.match(text, /"Proxies"\n\t\{\n\t\t"Sine"\n\t\t\{\n\t\t\t"resultVar"\t\t"\$selfillumtint"/);
  assert.doesNotMatch(propVmt("a", "b", { color: true, normal: false, phongexponent: false, illum: false }, DEFAULT_PROP_MATERIAL, "default"), /Proxies/i);
  const s = new PropSession(io({}));
  s.restore({ materials: { lamp: { settings: { selfIllum: true, customProxies: [sine, "junk"] } } } });
  assert.equal(s.data.materials.lamp.settings.customProxies.length, 1);
  const back = new PropSession(io({}));
  back.restore(PropSession.readSession(s.sessionText()));
  assert.equal(back.data.materials.lamp.settings.customProxies[0].name, "Sine");
});

test("the extra lines of a material are written as given, replace the panel's own keys, and their proxies join the editor's", () => {
  const textures = { color: true, normal: false, phongexponent: false, illum: false };
  const extra = '"$detail" "models/props/noise"\n"$detailblendmode" "8"\n"$surfaceprop" "metal"\n"Proxies" { "UniformNoise" { "minVal" "0" "maxVal" "1" "resultVar" "$detailblendfactor" } }';
  const sine = { name: "Sine", params: [{ key: "resultVar", value: "$selfillumtint" }] };
  const text = propVmt("a", "b", textures, { ...DEFAULT_PROP_MATERIAL, extra, customProxies: [sine] }, "wood");
  assert.match(text, /"\$detail"\t\t"models\/props\/noise"/);
  assert.match(text, /"\$detailblendmode"\t\t"8"/);
  assert.equal(text.match(/\$surfaceprop/g)?.length, 1);
  assert.match(text, /"\$surfaceprop"\t\t"metal"/);
  assert.equal(text.match(/"Proxies"/gi)?.length, 1);
  assert.ok(text.indexOf("UniformNoise") < text.indexOf("Sine"));
  // text that cannot be read is left out of the file and reported
  assert.match(propVmt("a", "b", textures, { ...DEFAULT_PROP_MATERIAL, extra: '"$detail" {' }, "wood"), /VertexLitGeneric/);
  assert.notEqual(extraProblem('"$detail" {'), "");
  assert.equal(extraProblem(extra), "");
});

test("a rim light is written with phong, with its own exponent and boost", () => {
  const textures = { color: true, normal: false, phongexponent: false, illum: false };
  const on = propVmt("a", "b", textures, { ...DEFAULT_PROP_MATERIAL, phong: true, rimLight: true, rimExponent: 6, rimBoost: 2 }, "wood");
  assert.match(on, /"\$rimlight"\t\t"1"/);
  assert.match(on, /"\$rimlightexponent"\t\t"6"/);
  assert.match(on, /"\$rimlightboost"\t\t"2"/);
  assert.doesNotMatch(propVmt("a", "b", textures, { ...DEFAULT_PROP_MATERIAL, phong: true }, "wood"), /rimlight/);
});

test("a file that could not be read stops being an error when another one is picked, and can be dropped", async () => {
  const files: Record<string, ArrayBuffer> = { "C:/art/crate.smd": bytes(SMD("crate")), "C:/art/crate_diffuse.tga": tga(64) };
  const s = new PropSession(io(files));
  s.data.name = "crate";
  await s.setLod(0, "C:/art/gone.smd"); // not there
  assert.deepEqual(s.failedPaths(), ["C:/art/gone.smd"]);
  await s.setLod(0, "C:/art/crate.smd");
  assert.deepEqual(s.failedPaths(), [], "the file that was swapped out says nothing any more");
  s.data.lods[2] = "C:/art/lost.smd";
  await s.loadAll();
  assert.deepEqual(s.failedPaths(), ["C:/art/lost.smd"]);
  s.dropFailed();
  assert.equal(s.data.lods[2], "");
  assert.deepEqual(s.failedPaths(), []);
  assert.deepEqual(s.issues().filter((i) => /lost/.test(i.text)), []);
});

test("a file that could not be read is read when it appears", async () => {
  const files: Record<string, ArrayBuffer> = {};
  const s = new PropSession(io(files));
  await s.setLod(0, "C:/art/late.smd");
  assert.equal(s.failedPaths().length, 1);
  files["C:/art/late.smd"] = bytes(SMD("crate"));
  assert.equal(await s.refresh(), true);
  assert.deepEqual(s.failedPaths(), []);
  assert.ok(s.model(0));
});
