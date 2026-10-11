import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { decodeTga, encodeTga, iconProblem, isPowerOfTwo, textureProblem, TgaError } from "../src/compiler/tga.ts";

function tga(type: number, width: number, height: number, depth: number, body: number[], descriptor = 0x20, header: number[] = []) {
  const h = new Uint8Array(18);
  h[1] = header.length ? 1 : 0; h[5] = header.length / 3; h[7] = header.length ? 24 : 0; h[2] = type; h[12] = width & 255; h[13] = width >> 8; h[14] = height & 255; h[15] = height >> 8; h[16] = depth; h[17] = descriptor;
  return new Uint8Array([...h, ...header, ...body]);
}

test("a 32 bit TGA decodes to RGBA, in either row order", () => {
  const top = decodeTga(tga(2, 2, 1, 32, [3, 2, 1, 255, 30, 20, 10, 128], 0x28));
  assert.deepEqual([...top.rgba], [1, 2, 3, 255, 10, 20, 30, 128]);
  assert.equal(top.hasAlpha, true); assert.equal(top.usesAlpha, true);
  // bottom-left origin: the first row in the file is the last on screen
  const bottom = decodeTga(tga(2, 1, 2, 24, [0, 0, 255, 255, 0, 0], 0x00));
  assert.deepEqual([...bottom.rgba], [0, 0, 255, 255, 255, 0, 0, 255]);
  assert.equal(bottom.hasAlpha, false);
});

test("a 32 bit file keeps its alpha whatever the descriptor says", () => {
  const image = decodeTga(tga(2, 1, 1, 32, [1, 2, 3, 77], 0x20));
  assert.deepEqual([...image.rgba], [3, 2, 1, 77]);
  assert.equal(image.hasAlpha, true);
});

test("run-length, grayscale and colour-mapped images decode", () => {
  const rle = decodeTga(tga(10, 4, 1, 24, [0x83, 9, 8, 7]));
  assert.deepEqual([...rle.rgba], [7, 8, 9, 255, 7, 8, 9, 255, 7, 8, 9, 255, 7, 8, 9, 255]);
  const raw = decodeTga(tga(10, 3, 1, 24, [0x02, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.deepEqual([...raw.rgba.slice(0, 4)], [3, 2, 1, 255]);
  const gray = decodeTga(tga(3, 2, 1, 8, [10, 200]));
  assert.deepEqual([...gray.rgba], [10, 10, 10, 255, 200, 200, 200, 255]);
  // 2 palette entries of 24 bits: 0 -> red, 1 -> blue
  const mapped = decodeTga(Object.assign(tga(1, 2, 1, 8, [1, 0], 0x20, [0, 0, 255, 255, 0, 0]), {}));
  assert.equal(mapped.rgba.length, 8);
});

test("bad files are reported, not guessed", () => {
  assert.throws(() => decodeTga(new Uint8Array(5)), TgaError);
  assert.throws(() => decodeTga(tga(2, 2, 2, 24, [1, 2, 3])), /cut short/);
  assert.throws(() => decodeTga(tga(0, 1, 1, 24, [])), /Unsupported/);
  assert.throws(() => decodeTga(tga(10, 2, 1, 24, [0xff, 1, 2, 3])), /run goes past/);
});

test("texture and icon limits follow the importer", () => {
  assert.equal(isPowerOfTwo(256), true); assert.equal(isPowerOfTwo(300), false);
  assert.equal(textureProblem({ width: 512, height: 512 }, "color"), null);
  assert.match(textureProblem({ width: 1024, height: 1024 }, "color")!, /limit is 512/);
  assert.match(textureProblem({ width: 512, height: 512 }, "illum")!, /limit is 256/);
  assert.match(textureProblem({ width: 300, height: 256 }, "normal")!, /power of two/);
  const blank = (alpha: boolean) => ({ width: 512, height: 512, hasAlpha: alpha, usesAlpha: false, rgba: new Uint8Array(512 * 512 * 4) });
  assert.equal(iconProblem(blank(true)), null);
  assert.match(iconProblem(blank(false))!, /alpha/);
  const outside = blank(true); outside.rgba[3] = 255;
  assert.match(iconProblem(outside)!, /safe zone/);
  assert.match(iconProblem({ ...blank(true), width: 256 })!, /512x512/);
});

test("an RGBA image written as a TGA reads back the same, with its alpha and the top row first", () => {
  const w = 4, h = 3;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([i * 20, 255 - i * 10, i * 5, i % 2 ? 255 : 40], i * 4);
  const bytes = encodeTga(rgba, w, h);
  assert.equal(bytes.length, 18 + w * h * 4);
  const back = decodeTga(bytes);
  assert.equal(back.width, w);
  assert.equal(back.height, h);
  assert.equal(back.hasAlpha, true);
  assert.deepEqual([...back.rgba], [...rgba]);
});
