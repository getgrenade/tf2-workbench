// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTransform, buildCubeFace, cubeFaceDirection, parseTextureTransform, skyDirection, skyLookup, SKY_FACES, viewerToSource, type SkyFace, type SkyPicture } from "../src/viewer/skyboxMath.ts";

const norm = (d: number[]) => { const l = Math.hypot(...d); return d.map((x) => x / l); };
const close = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

test("a direction on a face finds its place there again", () => {
  for (const face of SKY_FACES) for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.7]]) {
    const hit = skyLookup(skyDirection(face, u, v));
    assert.equal(hit.face, face);
    assert.ok(Math.abs(hit.u - u) < 1e-9 && Math.abs(hit.v - v) < 1e-9);
  }
});

test("the edges of the faces meet: the pictures of a sky are continuous", () => {
  const edge = (face: SkyFace, u: number, v: number) => norm(skyDirection(face, u, v));
  for (const v of [0, 0.3, 1]) {
    assert.ok(close(edge("ft", 1, v), edge("lf", 0, v)), "ft right is lf left");
    assert.ok(close(edge("lf", 1, v), edge("bk", 0, v)), "lf right is bk left");
    assert.ok(close(edge("bk", 1, v), edge("rt", 0, v)), "bk right is rt left");
    assert.ok(close(edge("rt", 1, v), edge("ft", 0, v)), "rt right is ft left");
  }
  // the top of up meets lf's top (up's v = 0 edge runs along lf), its right edge meets ft, its bottom rt, its left bk
  assert.ok(close(edge("up", 0.5, 0), edge("lf", 0.5, 0)));
  assert.ok(close(edge("up", 1, 0.5), edge("ft", 0.5, 0)));
  assert.ok(close(edge("up", 0.5, 1), edge("rt", 0.5, 0)));
  assert.ok(close(edge("up", 0, 0.5), edge("bk", 0.5, 0)));
});

test("the cube texture of three.js shows each way once, with the x turned round", () => {
  // the middle of the +x face of the texture is looked at along -x of the viewer (three.js turns the x of a cube texture round)
  assert.ok(close(cubeFaceDirection(0, 0.5, 0.5), [-1, 0, 0]));
  assert.ok(close(cubeFaceDirection(2, 0.5, 0.5), [0, 1, 0]));
  assert.ok(close(cubeFaceDirection(5, 0.5, 0.5), [0, 0, -1]));
  // viewer z (forward) is Source's x, viewer y (up) is Source's z
  assert.ok(close(viewerToSource([0, 1, 0]), [0, 0, 1]));
  assert.ok(close(viewerToSource([0, 0, 1]), [1, 0, 0]));
});

test("texture transforms: scale 1 2 stretches the picture to twice the height", () => {
  const t = parseTextureTransform("center 0 0 scale 1 2 rotate 0 translate 0 0");
  assert.deepEqual(applyTransform(t, 0.25, 0.25), [0.25, 0.5]);
  assert.deepEqual(parseTextureTransform(undefined).scale, [1, 1]);
});

test("a sky of one colour per face gives faces of those colours, and a clamped transform repeats the last row", () => {
  const solid = (r: number, g: number, b: number): SkyPicture => ({ width: 2, height: 2, rgba: new Uint8Array([r, g, b, 255, r, g, b, 255, r, g, b, 255, r, g, b, 255]), transform: parseTextureTransform(undefined), clampS: true, clampT: true });
  const pictures = Object.fromEntries(SKY_FACES.map((f, i) => [f, solid(i * 40, 0, 0)])) as Record<SkyFace, SkyPicture>;
  const face = buildCubeFace(pictures, 4, 4); // +z (viewer forward = Source x = bk), the middle of it
  assert.equal(face[(2 * 4 + 2) * 4], SKY_FACES.indexOf("bk") * 40);
  // top row of ft over 2 rows, scaled 1 2: v 0.75 reads past the end and clamps to the last row
  const strip: SkyPicture = { width: 1, height: 2, rgba: new Uint8Array([10, 0, 0, 255, 200, 0, 0, 255]), transform: parseTextureTransform("center 0 0 scale 1 2"), clampS: true, clampT: true };
  const p2 = { ...pictures, bk: strip } as Record<SkyFace, SkyPicture>;
  const f2 = buildCubeFace(p2, 8, 4);
  const lowRow = f2[(7 * 8 + 4) * 4];
  assert.equal(lowRow, 200, "below the horizon the last row repeats");
});
