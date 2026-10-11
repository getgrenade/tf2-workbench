import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPalette, encodeGif, lzwEncode, type GifFrame } from "../src/viewer/gif.ts";

/** Reads LZW data the way a GIF viewer does (the reference to check the encoder against). */
function lzwDecode(data: Uint8Array, minCodeSize: number, length: number): Uint8Array {
  const clear = 1 << minCodeSize, end = clear + 1;
  const out: number[] = [];
  let table: number[][] = [];
  const reset = () => { table = []; for (let i = 0; i < clear; i++) table.push([i]); table.push([], []); };
  reset();
  let width = minCodeSize + 1, bits = 0, count = 0, pos = 0, prev: number[] | null = null;
  while (out.length < length) {
    while (count < width && pos < data.length) { bits |= data[pos++] << count; count += 8; }
    if (count < width) break;
    const code = bits & ((1 << width) - 1);
    bits >>>= width; count -= width;
    if (code === clear) { reset(); width = minCodeSize + 1; prev = null; continue; }
    if (code === end) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error("bad code");
    out.push(...entry);
    if (prev && table.length < 4096) table.push([...prev, entry[0]]);
    if (table.length === 1 << width && width < 12) width++;
    prev = entry;
  }
  return Uint8Array.from(out);
}

test("LZW data decodes to what was encoded, also when the table fills up", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8;
  const noise = Uint8Array.from({ length: 30000 }, () => rnd() % 200);
  const flat = new Uint8Array(5000).fill(3);
  for (const data of [noise, flat, Uint8Array.from([1, 2, 3, 1, 2, 3, 1, 2, 3, 4])]) {
    assert.deepEqual(lzwDecode(lzwEncode(data, 8), 8, data.length), data);
  }
});

const solid = (w: number, h: number, rgb: number[], paint?: (x: number, y: number) => number[] | null): GifFrame => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = paint?.(x, y) ?? rgb;
    data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return { data };
};

test("a GIF has the header, the size, the loop, one frame per picture and the trailer", () => {
  const frames = [0, 1, 2].map((n) => solid(16, 8, [20, 30, 40], (x, y) => (x === n * 4 && y < 4 ? [250, 10, 10] : null)));
  const gif = encodeGif(frames, 16, 8, { fps: 10, dither: 0 });
  assert.equal(new TextDecoder().decode(gif.subarray(0, 6)), "GIF89a");
  assert.equal(gif[6] | (gif[7] << 8), 16);
  assert.equal(gif[8] | (gif[9] << 8), 8);
  assert.equal(gif[gif.length - 1], 0x3b);
  assert.equal(new TextDecoder().decode(gif).includes("NETSCAPE2.0"), true);
  let images = 0;
  for (let i = 0; i < gif.length - 1; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4) images++;
  assert.equal(images, 3);
});

test("later frames store only the changed box, and still decode to the right colours", () => {
  const w = 32, h = 32;
  const a = solid(w, h, [30, 60, 90]);
  const b = solid(w, h, [30, 60, 90], (x, y) => (x >= 10 && x < 14 && y >= 20 && y < 24 ? [240, 200, 20] : null));
  const gif = encodeGif([a, b], w, h, { fps: 10, dither: 0, tolerance: 0 });
  const palette = gif.subarray(13, 13 + 768);
  // find the second image descriptor
  const starts: number[] = [];
  for (let i = 13 + 768; i < gif.length - 10; i++) if (gif[i] === 0x2c && gif[i - 8] === 0x21 && gif[i - 7] === 0xf9) starts.push(i);
  assert.equal(starts.length, 2);
  const at = starts[1];
  const [x0, y0, bw, bh] = [gif[at + 1] | (gif[at + 2] << 8), gif[at + 3] | (gif[at + 4] << 8), gif[at + 5] | (gif[at + 6] << 8), gif[at + 7] | (gif[at + 8] << 8)];
  assert.deepEqual([x0, y0, bw, bh], [10, 20, 4, 4]);
  // read the blocks of the second frame back
  let p = at + 11;
  const blocks: number[] = [];
  while (gif[p] !== 0 && p < gif.length) { blocks.push(...gif.subarray(p + 1, p + 1 + gif[p])); p += gif[p] + 1; }
  const pixels = lzwDecode(Uint8Array.from(blocks), 8, 16);
  const [r, g, bl] = [palette[pixels[0] * 3], palette[pixels[0] * 3 + 1], palette[pixels[0] * 3 + 2]];
  assert.ok(Math.abs(r - 240) < 12 && Math.abs(g - 200) < 12 && Math.abs(bl - 20) < 12, `${r},${g},${bl}`);
});

test("a picture that does not change costs almost nothing", () => {
  const f = solid(64, 64, [10, 10, 10], (x, y) => [x * 4, y * 4, 128]);
  const one = encodeGif([f], 64, 64, { fps: 10 }).length;
  const ten = encodeGif(Array.from({ length: 10 }, () => f), 64, 64, { fps: 10 }).length;
  assert.ok(ten - one < 400, `${ten - one} bytes for nine still frames`);
});

test("the palette uses its colours: a picture of many colours does not collapse into a few", () => {
  const w = 120, h = 80;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 2, y * 3, (x * y) % 256, 255], (y * w + x) * 4);
  const palette = buildPalette([{ data }], 255);
  const distinct = new Set<string>();
  for (let i = 0; i < palette.length; i += 3) distinct.add(`${palette[i]},${palette[i + 1]},${palette[i + 2]}`);
  assert.equal(palette.length / 3, 255);
  assert.ok(distinct.size > 200, `${distinct.size} distinct colours`);
});
