import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { CompilerSession, blankData, sanitizeName, materialFileName, type SessionIo } from "../../src/compiler/session";
import { parsePayload } from "../../src/viewer/payload";

(globalThis as any).document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_v: string) {} }) };

const HAT = "C:/WORK/tf2/sum26/sniper_cowboy/mesh/hat.fbx";
const HAT_LOD1 = "C:/WORK/tf2/sum26/sniper_cowboy/mesh/hat_lod.fbx";
const COLOR = "C:/WORK/tf2/sum26/medic_longcoat/texture/gradient.tga";
const ICON = "C:/WORK/tf2/halebpicon.tga";
const SNIPER = "target/gib-fixtures/sniper.player.model";
const have = [HAT, HAT_LOD1, COLOR, ICON, SNIPER].every(existsSync);

const io: SessionIo = {
  read: async (path) => { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
  stamp: async (path) => (existsSync(path) ? statSync(path).mtimeMs : null),
  siblings: async (p) => readdirSync(p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")))),
  gameTexture: async () => ({ width: 2, height: 1, rgba: new Uint8Array(8) as Uint8Array<ArrayBuffer> }),
};

test("names are made safe for files and schema tokens", () => {
  assert.equal(sanitizeName("  The Cowboy Hat! "), "the_cowboy_hat");
  assert.equal(sanitizeName("a_cowboyhat"), "a_cowboyhat");
  assert.equal(materialFileName("hat", 0), "hat");
  assert.equal(materialFileName("hat", 1), "hat_1");
});

test("a missing file is reported, not thrown", async () => {
  const s = new CompilerSession(io);
  await s.setLod("sniper", 0, "C:/does/not/exist.fbx");
  assert.ok(s.issues().some((i) => i.key.startsWith("file:")));
});

import { makeBuildRequest } from "../../src/compiler/request";
import { writeSmd } from "../../src/compiler/smd";
import { importFbx } from "../../src/compiler/fbx";

test("choosing LOD 0 and a diffuse texture fills in the files that go with them, and a hand-picked file is left alone", async () => {
  const names: Record<string, string[]> = { "m/": ["body_lod0.fbx", "body_lod1.fbx", "body_lod2.fbx"], "t/": ["a_body_diffuse.tga", "a_body_normal.tga", "a_body_expmask.tga"] };
  const fake: SessionIo = { ...io, read: io.read, siblings: async (p) => names[p.slice(0, 2)] ?? [] };
  const s = new CompilerSession({ ...fake, read: async (p) => (p.endsWith(".fbx") ? io.read(HAT) : io.read(COLOR)) });
  await s.setLod("sniper", 0, "m/body_lod0.fbx");
  assert.deepEqual(s.data.classes.sniper, ["m/body_lod0.fbx", "m/body_lod1.fbx", "m/body_lod2.fbx"]);
  await s.setLod("sniper", 1, "m/body_lod1.fbx"); // picked by hand: stays when LOD 0 changes
  await s.setLod("sniper", 0, "m/body_lod0.fbx");
  assert.equal(s.data.classes.sniper[1], "m/body_lod1.fbx");
  await s.setTexture("ND_ID_MAT_TEAL", "color", "t/a_body_diffuse.tga");
  const m = s.data.materials["ND_ID_MAT_TEAL"];
  assert.deepEqual([m.normal, m.phongexponent], ["t/a_body_normal.tga", "t/a_body_expmask.tga"]);
  await s.setTexture("ND_ID_MAT_TEAL", "normal", "t/other_normal.tga");
  await s.setTexture("ND_ID_MAT_TEAL", "color", "t/a_body_diffuse.tga");
  assert.equal(m.normal, "t/other_normal.tga", "the normal picked by hand is not replaced");
});

test("a session saved before classes existed keeps its models on the class it was shown on", () => {
  const r = new CompilerSession(io);
  r.restore({ name: "x", lods: ["a.fbx", "", ""] }, "demo");
  assert.deepEqual(r.classesWithModels(), ["demo"]);
  assert.equal(r.lods("demo")[0], "a.fbx");
});
