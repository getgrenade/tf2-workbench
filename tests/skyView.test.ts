import test from "node:test";
import assert from "node:assert/strict";
import { IDENTITY_TRANSFORM, renderSkyView, SKY_FACES, type SkyFace, type SkyPicture } from "../src/viewer/skyboxMath";
import { skyFade } from "../src/viewer/promoOverlay";

// a sky whose every face is one flat colour, so a pixel says which face it looked at
const COLOURS: Record<SkyFace, [number, number, number]> = { ft: [200, 0, 0], bk: [0, 200, 0], lf: [0, 0, 200], rt: [200, 200, 0], up: [0, 200, 200], dn: [200, 0, 200] };
const flat = (c: [number, number, number]): SkyPicture => ({ width: 2, height: 2, rgba: new Uint8Array([...c, 255, ...c, 255, ...c, 255, ...c, 255]), transform: IDENTITY_TRANSFORM, clampS: true, clampT: true });
const sky = Object.fromEntries(SKY_FACES.map((f) => [f, flat(COLOURS[f])])) as Record<SkyFace, SkyPicture>;
const middle = (px: Uint8ClampedArray, w: number, h: number) => [...px.slice(((h >> 1) * w + (w >> 1)) * 4, ((h >> 1) * w + (w >> 1)) * 4 + 3)];

test("the view looks at the front face at turn 0, and turns to the left, the back, the up and down faces", () => {
  const at = (turn: number, tilt: number) => middle(renderSkyView(sky, { turn, tilt, fov: 60 }, 9, 9), 9, 9);
  assert.deepEqual(at(0, 0), COLOURS.ft);
  assert.deepEqual(at(180, 0), COLOURS.bk);
  assert.deepEqual(at(0, 85), COLOURS.up);
  assert.deepEqual(at(0, -85), COLOURS.dn);
  // turned a quarter: one side face or the other, and opposite ones for opposite turns
  const left = at(90, 0), right = at(-90, 0);
  assert.notDeepEqual(left, right);
  assert.ok([COLOURS.lf, COLOURS.rt].some((c) => c.join() === left.join()));
  // the front face's right edge meets the left face (skyboxMath's FRAMES): looking a little right of the front at turn 0 stays on ft,
  // and the right edge of a wide view reaches the face that is to the right
  const wide = renderSkyView(sky, { turn: 0, tilt: 0, fov: 170 }, 41, 3);
  assert.deepEqual([...wide.slice((41 + 40) * 4, (41 + 40) * 4 + 3)], right);
});

test("the sky fades out smoothly at the top and the bottom, and not at all without fades", () => {
  assert.equal(skyFade({ fadeTop: 0, fadeBottom: 0 }, 0, 100), 1);
  assert.equal(skyFade({ fadeTop: 0, fadeBottom: 0 }, 100, 100), 1);
  assert.equal(skyFade({ fadeTop: 0.2, fadeBottom: 0 }, 0, 100), 0);
  assert.equal(skyFade({ fadeTop: 0.2, fadeBottom: 0 }, 20, 100), 1);
  assert.ok(Math.abs(skyFade({ fadeTop: 0.2, fadeBottom: 0 }, 10, 100) - 0.5) < 1e-9);
  assert.equal(skyFade({ fadeTop: 0, fadeBottom: 0.5 }, 100, 100), 0);
  assert.equal(skyFade({ fadeTop: 0, fadeBottom: 0.5 }, 50, 100), 1);
  assert.ok(skyFade({ fadeTop: 0, fadeBottom: 0.5 }, 90, 100) < skyFade({ fadeTop: 0, fadeBottom: 0.5 }, 70, 100));
});
