import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { importFbx } from "../../src/compiler/fbx";
import { buildPreviewMaterial, buildPreviewModel, customBoneNames, referenceWinding, resolveBones } from "../../src/compiler/preview";
import { windingSign } from "../../src/compiler/mesh";
import { buildVmt, DEFAULT_MATERIAL } from "../../src/compiler/vmt";
import { parsePayload } from "../../src/viewer/payload";

(globalThis as any).document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_v: string) {} }) };

const SNIPER = "target/gib-fixtures/sniper.player.model";
const read = (path: string) => { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

test("bones the class lacks follow the nearest ancestor it has", () => {
  const classBones = [{ name: "bip_pelvis" }, { name: "bip_spine_0" }, { name: "bip_head" }] as any;
  const skeleton = [{ name: "bip_pelvis", parent: null }, { name: "bip_spine_0", parent: "bip_pelvis" }, { name: "prop_bone", parent: "bip_spine_0" }, { name: "prop_bone_end", parent: "prop_bone" }, { name: "stray", parent: null }];
  assert.deepEqual(resolveBones(["BIP_SPINE_0", "prop_bone_end", "stray", ""], skeleton, classBones), [1, 1, 2, 2], "unknown bones fall back to the head");
});

test("a preview material carries the textures and the settings of the VMT", () => {
  const rgba = new Uint8Array(4 * 4 * 4) as Uint8Array<ArrayBuffer>;
  const material = buildPreviewMaterial("compiler/m.vmt", buildVmt(DEFAULT_MATERIAL, { color: "x_color" }), { base: { width: 4, height: 4, rgba } });
  assert.equal(material.shader, "vertexlitgeneric");
  assert.equal(material.params["$basetexture"], "x_color");
  assert.equal(material.textures.base.width, 4);
  assert.ok(material.proxies.some((p) => p.name === "invis"));
});
