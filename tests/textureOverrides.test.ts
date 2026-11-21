// Run with: npm test -- textureOverrides
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeReplacement, fitReplacement, TextureOverrides } from "../src/viewer/textureOverrides.ts";
import type { MaterialData, TextureData } from "../src/viewer/payload.ts";

const tex = (width: number, height: number, value: number, clamp = false): TextureData => ({ width, height, clampS: clamp, clampT: clamp, rgba: new Uint8Array(width * height * 4).fill(value) });
const material = (): MaterialData => ({ path: "models/player/items/x/hat", shader: "VertexLitGeneric", params: {}, proxies: [], textures: { base: tex(4, 4, 10, true), bump: tex(4, 4, 128) }, errors: [] });

test("a replacement takes the size and wrap of the map it replaces", () => {
  const fitted = fitReplacement(tex(8, 8, 200), tex(4, 4, 10, true), "base");
  assert.equal(fitted.width, 4);
  assert.equal(fitted.height, 4);
  assert.equal(fitted.clampS, true);
  assert.equal(fitted.rgba[0], 200);
});

test("a map is replaced in place, put back by reset, and every one by reset all", () => {
  const put: [string, string, number][] = [];
  const overrides = new TextureOverrides((path, slot, data) => put.push([path, slot, data.rgba[0]]));
  const m = material();
  overrides.replace(m, "base", tex(4, 4, 200), "mine.png");
  assert.equal(m.textures.base!.rgba[0], 200);
  assert.equal(overrides.file(m.path, "base"), "mine.png");
  assert.equal(overrides.edited(m.path), true);
  // a second replacement still remembers the game's own pixels
  overrides.replace(m, "base", tex(4, 4, 50), "other.tga");
  overrides.reset(m, "base");
  assert.equal(m.textures.base!.rgba[0], 10);
  assert.equal(overrides.edited(m.path), false);
  overrides.replace(m, "bump", tex(2, 2, 255), "n.vtf");
  overrides.resetAll((p) => (p === m.path ? m : null));
  assert.equal(m.textures.bump!.rgba[0], 128);
  assert.equal(overrides.size, 0);
  assert.deepEqual(put.at(-1), [m.path, "bump", 128]);
});

test("a map the material does not have cannot be replaced", () => {
  const overrides = new TextureOverrides(() => {});
  assert.throws(() => overrides.replace(material(), "exponent", tex(4, 4, 1), "x.png"));
});

test("a decoded .vtf comes from the backend as VTF0, the size and the pixels", async () => {
  const bytes = new Uint8Array(12 + 2 * 1 * 4);
  bytes.set([86, 84, 70, 48]);
  new DataView(bytes.buffer).setUint32(4, 2, true);
  new DataView(bytes.buffer).setUint32(8, 1, true);
  bytes.set([1, 2, 3, 4, 5, 6, 7, 8], 12);
  const image = await decodeReplacement(bytes.buffer, "x.vtf");
  assert.equal(image.width, 2);
  assert.deepEqual([...image.rgba], [1, 2, 3, 4, 5, 6, 7, 8]);
});
