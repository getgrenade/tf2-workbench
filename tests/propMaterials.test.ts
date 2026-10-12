// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceMaterials } from "../src/viewer/sourceMaterials.ts";
import type { MaterialData, TextureData } from "../src/viewer/payload.ts";

const tex = (r: number): TextureData => ({ width: 1, height: 1, rgba: new Uint8Array([r, r, r, 255]) });
const material = (shader: string, params: Record<string, string> = {}, textures: Record<string, TextureData> = { base: tex(200) }): MaterialData =>
  ({ path: `materials/test/${shader}.vmt`, shader, params, proxies: [], textures, errors: [] });
const make = (m: MaterialData) => new SourceMaterials(1, {}).makeMaterial(m);

test("only the unlit shaders are drawn without lighting", () => {
  assert.equal(make(material("unlitgeneric")).uniforms.uUnlit.value, true);
  assert.equal(make(material("unlittwotexture", {}, { base: tex(100), tex2: tex(100) })).uniforms.uUnlit.value, true);
  assert.equal(make(material("vertexlitgeneric")).uniforms.uUnlit.value, false);
});

test("UnlitTwoTexture takes its second texture, and $mod2x", () => {
  const m = make(material("unlittwotexture", { "$mod2x": "1" }, { base: tex(100), tex2: tex(100) }));
  assert.equal(m.uniforms.uHasTex2.value, true);
  assert.equal(m.uniforms.uMod2x.value, 1);
  // a second texture on another shader is not used
  assert.equal(make(material("vertexlitgeneric", {}, { base: tex(100), tex2: tex(100) })).uniforms.uHasTex2.value, false);
});

test("Refract is clear tinted glass", () => {
  const m = make(material("refract", { "$refracttint": "[0.5 1 1]" }, {}));
  assert.equal(m.transparent, true);
  assert.equal(m.uniforms.uOpacity.value, 0.3);
  const tint = m.uniforms.uModulation.value;
  assert.ok(tint.x < tint.y && Math.abs(tint.y - 1) < 1e-6, `${tint.x} ${tint.y}`);
});

test("a self-shadowing bump map is not read as a normal map", () => {
  const withBump = { base: tex(100), bump: tex(128) };
  assert.equal(make(material("vertexlitgeneric", {}, withBump)).uniforms.uHasBump.value, true);
  assert.equal(make(material("vertexlitgeneric", { "$ssbump": "1" }, withBump)).uniforms.uHasBump.value, false);
});
