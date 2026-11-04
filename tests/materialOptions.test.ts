// The extra material options: phong fresnel, tints, warp, reflection controls, and reading them back from a material text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVmt, DEFAULT_MATERIAL } from "../src/compiler/vmt.ts";
import { printKv, parseKv } from "../src/compiler/kv.ts";
import { settingsFromVmt } from "../src/compiler/importSession.ts";

const text = (over: Partial<typeof DEFAULT_MATERIAL>) => printKv(buildVmt({ ...DEFAULT_MATERIAL, customProxies: [], ...over }, { color: "x/a" }));

test("untouched settings print what they printed before", () => {
  const t = text({});
  assert.ok(!/phongtint|phongwarp|envmapfresnel|envmapcontrast|envmapsaturation/i.test(t));
  assert.ok(t.includes('"$phongfresnelranges"\t\t"[.25 .5 1]"'));
});

test("the new parameters are written only when they differ", () => {
  const t = text({ phongFresnel: [0.1, 0.4, 2], phongTint: [255, 128, 0], phongWarp: "models/lightwarps/foo", envmap: "effects/pyrocube", envmapFresnel: 0.5, envmapContrast: 0.25, envmapSaturation: 0.5 });
  assert.ok(t.includes('"$phongfresnelranges"\t\t"[0.1 0.4 2]"'));
  assert.ok(t.includes('"$phongtint"\t\t"{ 255 128 0 }"'));
  assert.ok(t.includes('"$phongwarptexture"\t\t"models/lightwarps/foo"'));
  assert.ok(t.includes('"$envmapfresnel"\t\t"0.500000"'));
  assert.ok(t.includes('"$envmapcontrast"'));
  assert.ok(t.includes('"$envmapsaturation"\t\t"0.500000"'));
  // reflection controls mean nothing without a reflection
  assert.ok(!text({ envmapFresnel: 0.5 }).includes("envmapfresnel"));
});

test("a material text is read back into the settings", () => {
  const t = text({ phongFresnel: [0.1, 0.4, 2], phongTint: [255, 128, 0], phongWarp: "w/x", envmap: "c/d", envmapFresnel: 0.5, envmapContrast: 0.25, envmapSaturation: 0.5 });
  const s = settingsFromVmt(parseKv(t));
  assert.deepEqual(s.phongFresnel, [0.1, 0.4, 2]);
  assert.equal(s.phongWarp, "w/x");
  assert.equal(s.envmap, "c/d");
  assert.equal(s.envmapFresnel, 0.5);
  assert.equal(s.envmapSaturation, 0.5);
  assert.deepEqual(s.phongTint, [255, 128, 0]);
  // a game material's 0-1 form reads the same
  assert.deepEqual(settingsFromVmt(parseKv('"VertexLitGeneric" { "$phongtint" "[1 .5 0]" }')).phongTint, [255, 128, 0]);
  assert.equal(settingsFromVmt(parseKv(text({}))).phongTint, null);
});

