// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeCanvas, readPsd } from "ag-psd";
import { adaptAlpha, buildPsd, planLayers, rimLayerName, rimLayerPixels, sceneOnlyLook, type ExportLayer } from "../src/viewer/layerExport.ts";

// the reader makes its pixel buffers through a canvas; in node there is none, so a plain one does
const imageData = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
initializeCanvas((width, height) => ({ width, height, getContext: () => ({ createImageData: imageData }) }) as unknown as HTMLCanvasElement, imageData as never);

const on = <T extends object>(s: T) => ({ enabled: true, ...s });

test("only the effects that are on get a layer, from the bottom up, and the Scene is always there", () => {
  assert.deepEqual(planLayers({}, { ao: false, fog: false }).map((l) => l.name), ["Scene"]);
  const look = {
    vignette: on({ strength: 0.5, size: 0.5, softness: 0.5, roundness: 1, color: "#000000" }),
    grain: on({ amount: 0.3, size: 1, shadows: 0.5, colored: false }),
    bloom: on({ intensity: 0.5, threshold: 0.8, radius: 0.5 }),
    scanlines: { enabled: false, strength: 0.5, lines: 200 },
    dust: on({ amount: 0.4, size: 1, opacity: 0.8, color: "#ffffff", seed: 1 }),
    leaks: on({ strength: 0, size: 0.5, position: 0, color: "#ff7a30" }),
  };
  const plan = planLayers(look, { ao: true, fog: true });
  assert.deepEqual(plan.map((l) => l.name), ["Scene", "Ambient occlusion", "Fog", "Bloom", "Vignette", "Film grain", "Dust"]);
  const mode = (name: string) => plan.find((l) => l.name === name)!.blend;
  assert.equal(mode("Ambient occlusion"), "multiply");
  assert.equal(mode("Bloom"), "screen");
  assert.equal(mode("Vignette"), "multiply");
  assert.equal(mode("Film grain"), "linear light");
  assert.equal(mode("Fog"), "normal");
});

test("a light or coloured vignette is a colour over the picture, not a multiplication", () => {
  const plan = planLayers({ vignette: on({ strength: 1, size: 0.5, softness: 0.5, roundness: 1, color: "#ffffff" }) }, { ao: false, fog: false });
  const v = plan.find((l) => l.name === "Vignette")!;
  assert.equal(v.blend, "normal");
  assert.equal(v.alt, 1);
});

test("the Scene keeps what reads the picture differently or changes its colours", () => {
  const kept = sceneOnlyLook({
    distortion: on({ amount: 0.3 }), aberration: on({ strength: 0.4 }), grade: on({ exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 }),
    vignette: on({ strength: 1, size: 0.5, softness: 0.5, roundness: 1, color: "#000000" }), bloom: on({ intensity: 1, threshold: 0.8, radius: 0.5 }),
  });
  assert.deepEqual(Object.keys(kept).filter((k) => kept[k as keyof typeof kept]).sort(), ["aberration", "distortion", "grade"]);
});

test("the PSD keeps the layers, their order, names and blend modes, and their pixels", () => {
  const w = 4, h = 3;
  const solid = (r: number, g: number, b: number, a: number) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set([r, g, b, a], i * 4); return d; };
  const layers: ExportLayer[] = [
    { name: "Scene", blend: "normal", data: solid(200, 100, 50, 255) },
    { name: "Vignette", blend: "multiply", data: solid(128, 128, 128, 255) },
    { name: "Bloom", blend: "screen", data: solid(10, 20, 30, 255) },
    { name: "Film grain", blend: "linear light", data: solid(128, 128, 128, 90) },
  ];
  const bytes = buildPsd(w, h, solid(1, 2, 3, 255), layers);
  const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true });
  assert.equal(psd.width, w);
  assert.equal(psd.height, h);
  const got = psd.children!;
  assert.deepEqual(got.map((l) => l.name), ["Scene", "Vignette", "Bloom", "Film grain"]);
  assert.deepEqual(got.map((l) => l.blendMode), ["normal", "multiply", "screen", "linear light"]);
  assert.deepEqual([...got[0].imageData!.data.slice(0, 4)], [200, 100, 50, 255]);
  assert.deepEqual([...got[3].imageData!.data.slice(0, 4)], [128, 128, 128, 90]);
  assert.deepEqual([...psd.imageData!.data.slice(0, 4)], [1, 2, 3, 255]);
});

test("a rim light layer screens the picture without the light into the picture with it", () => {
  const under = new Uint8ClampedArray([100, 100, 100, 255, 20, 40, 60, 255, 200, 200, 200, 0]);
  const over = new Uint8ClampedArray([180, 100, 120, 255, 20, 40, 60, 255, 200, 210, 200, 0]);
  const rim = rimLayerPixels(under, over);
  const screen = (b: number, s: number) => 255 * (1 - (1 - b / 255) * (1 - s / 255));
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(screen(under[c], rim[c]) - over[c]) <= 1.5, `channel ${c} merges back`);
  assert.deepEqual([...rim.slice(4, 8)], [0, 0, 0, 255], "where the light adds nothing the layer is black");
  assert.equal(rim[3], 255);
  assert.equal(rim[11], 0, "the alpha is the picture's");
  assert.equal(rimLayerName(1, 1), "Fresnel rim light");
  assert.equal(rimLayerName(2, 3), "Fresnel rim light 2");
});

test("the alpha of a layer is the one that blends it over what is under it into the picture", () => {
  const under = new Uint8ClampedArray([100, 100, 100, 255, 10, 20, 30, 255, 50, 50, 50, 255, 0, 0, 0, 255]);
  const layer = new Uint8ClampedArray([200, 200, 200, 255, 10, 20, 30, 255, 150, 150, 150, 128, 255, 255, 255, 0]);
  const over = new Uint8ClampedArray([150, 150, 150, 255, 10, 20, 30, 255, 60, 60, 60, 255, 0, 0, 0, 255]);
  adaptAlpha(layer, under, over);
  assert.equal(layer[3], 128, "half way from 100 to 200 is 150");
  assert.equal(layer[7], 255, "a colour that is what is under it keeps its alpha");
  assert.equal(layer[11], Math.round(255 * 0.1), "a tenth of the way from 50 to 150");
  assert.equal(layer[15], 0, "what is empty stays empty");
});
