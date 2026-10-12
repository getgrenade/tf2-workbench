// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReflection } from "../src/viewer/reflectionState.ts";
import { buildPreviewMaterial } from "../src/compiler/preview.ts";

test("a scene without reflections gives none, and bad values are replaced", () => {
  assert.equal(parseReflection(undefined), undefined);
  assert.equal(parseReflection({ cubemap: 3 }), undefined);
  assert.deepEqual(parseReflection({ cubemap: "cubemaps/cubemap_gold001", brightness: 9 }), { cubemap: "cubemaps/cubemap_gold001", brightness: 4 });
  assert.deepEqual(parseReflection({ cubemap: "", brightness: "x" }), { cubemap: "", brightness: 1 });
});

test("the preview material of the compiler carries the six faces of its cubemap", () => {
  const face = (v: number) => ({ width: 1, height: 1, rgba: new Uint8Array([v, v, v, 255]) as Uint8Array<ArrayBuffer> });
  const m = buildPreviewMaterial("materials/x.vmt", [], { env: [0, 1, 2, 3, 4, 5].map(face) });
  for (let i = 0; i < 6; i++) assert.equal(m.textures[`env${i}`]?.rgba[0], i);
  assert.equal(buildPreviewMaterial("materials/x.vmt", [], {}).textures.env0, undefined);
});
