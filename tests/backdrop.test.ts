// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_GRADIENT, colourBackdrop, customBackdrop, deleteGradient, fadeBackdrop, gradientPresets, renameGradient, parseBackdrop, saveGradient, savedGradients, stopsBackdrop, stopsOf } from "../src/viewer/backdropPresets.ts";
import { SHIPPED_GRADIENTS } from "../src/viewer/shippedBackdrops.ts";
import { blendAt, colourAt, hexOfRgb, parseStops, sampleStops, unitGradientLine } from "../src/viewer/gradientStops.ts";

const night = stopsBackdrop([{ at: 0, color: "#1b2a52" }, { at: 1, color: "#070b16" }]);
const spotlight = stopsBackdrop([{ at: 0, color: "#f0c050" }, { at: 0.5, color: "#6b4a14" }, { at: 1, color: "#1c1406" }], "radial", { softness: 0.6, cx: 0.5, cy: 0.4 });

/** A place to keep what is saved (a window of the app has one). */
function memoryStorage() {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test("a gradient of stops has the first and last colour as its from and to (a border takes them)", () => {
  assert.equal(night.kind, "gradient");
  assert.equal(night.from, "#1b2a52");
  assert.equal(night.to, "#070b16");
  assert.equal(night.angle, 90);
});

test("a custom gradient starts from what was there, as stops, with no preset", () => {
  const custom = customBackdrop({ ...night, preset: "x" });
  assert.equal(custom.preset, undefined);
  assert.deepEqual(custom.stops, night.stops);
  // with nothing to start from (a picture), it starts from the default one
  assert.deepEqual(customBackdrop({ ...colourBackdrop("#000000"), kind: "picture", image: "data:image/jpeg;base64,AAAA" }).stops, DEFAULT_GRADIENT.stops);
  // a colour is a gradient of one colour; a gradient from before stops (the bottom first, at angle 270) is turned into the top first
  assert.deepEqual(customBackdrop(colourBackdrop("#123456")).stops!.map((s) => s.color), ["#123456", "#123456"]);
  const old = { kind: "gradient" as const, from: "#111111", to: "#eeeeee", angle: 270, glow: "#ffffff", glowAmount: 0, vignette: 0 };
  assert.deepEqual(stopsOf(old).stops, [{ at: 0, color: "#eeeeee" }, { at: 1, color: "#111111" }]);
  assert.equal(stopsOf({ ...old, glowAmount: 0.5 }).shape, "radial");
});

test("a blend leans toward the midpoint, and softness eases it", () => {
  assert.equal(blendAt(0.5, undefined, 0), 0.5);
  assert.ok(Math.abs(blendAt(0.3, 0.3, 0) - 0.5) < 1e-9, "half way at the midpoint");
  assert.ok(blendAt(0.5, 0.2, 0) > 0.5, "a low midpoint reaches the second colour sooner");
  assert.ok(blendAt(0.25, undefined, 1) < 0.25 && blendAt(0.75, undefined, 1) > 0.75, "soft: slower out of a stop, faster between");
  assert.equal(blendAt(0, 0.7, 1), 0);
  assert.equal(blendAt(1, 0.7, 1), 1);
});

test("the colour of a gradient of stops: its stops' own, and between them the blend", () => {
  const stops = [{ at: 0, color: "#000000" }, { at: 0.5, color: "#ff0000" }, { at: 1, color: "#0000ff" }];
  assert.deepEqual(colourAt(stops, 0, 0), [0, 0, 0]);
  assert.deepEqual(colourAt(stops, 0, 0.5), [255, 0, 0]);
  assert.deepEqual(colourAt(stops, 0, 1), [0, 0, 255]);
  assert.deepEqual(colourAt(stops, 0, 0.25), [127.5, 0, 0]);
  assert.deepEqual(colourAt(stops, 0, -1), [0, 0, 0]);
  const samples = sampleStops(stops, 0, 5);
  assert.deepEqual(samples.map((s) => s.color), ["#000000", "#800000", "#ff0000", "#800080", "#0000ff"]);
  assert.equal(hexOfRgb([300, -5, 12.4]), "#ff000c");
});

test("a linear gradient's line puts the corners at its ends, so a picture of any shape gets all of the gradient", () => {
  const near = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} is not ${b}`));
  near(unitGradientLine(90), [0.5, 0, 0.5, 1]); // down: the top edge to the bottom edge
  near(unitGradientLine(270), [0.5, 1, 0.5, 0]);
  near(unitGradientLine(0), [0, 0.5, 1, 0.5]);
  near(unitGradientLine(45), [0, 0, 1, 1]); // corner to corner
  near(unitGradientLine(315), [0, 1, 1, 0]);
});

test("stops read back from a file are in order and in range, and a gradient needs two", () => {
  assert.equal(parseStops(undefined), null);
  assert.equal(parseStops([{ at: 0, color: "#ffffff" }]), null);
  const stops = parseStops([{ at: 2, color: "#FF0000", mid: 9 }, { at: -1, color: "#00ff00" }, { at: 0.5, color: "red" }, null])!;
  assert.deepEqual(stops, [{ at: 0, color: "#00ff00" }, { at: 1, color: "#ff0000", mid: 0.98 }]);
});

test("a fade paints the second over the first with a rising opacity, and ends on the second itself", () => {
  const a = stopsBackdrop([{ at: 0, color: "#000000" }, { at: 1, color: "#000000" }], "linear", { angle: 90 });
  const b = stopsBackdrop([{ at: 0, color: "#ffffff" }, { at: 1, color: "#ffffff" }], "radial", { angle: 270 });
  assert.equal(fadeBackdrop(a, b, 0), a);
  assert.equal(fadeBackdrop(a, b, 1), b);
  const half = fadeBackdrop(a, b, 0.5);
  // (any two fade: a turned gradient, a radial one after a linear one: nothing turns or jumps, one is painted over the other)
  assert.equal(half.crossfade?.from, a);
  assert.equal(half.crossfade?.t, 0.5);
  assert.equal(half.shape, "radial");
  assert.equal(half.angle, 270);
  assert.ok(fadeBackdrop(colourBackdrop("#000000"), { ...b, kind: "picture", image: "data:image/jpeg;base64,AAAA" }, 0.3).crossfade);
});

test("a scene's background is read back, with what is wrong replaced", () => {
  assert.deepEqual(parseBackdrop(JSON.parse(JSON.stringify(night))), night);
  const back = parseBackdrop(JSON.parse(JSON.stringify(spotlight)))!;
  assert.equal(back.shape, "radial");
  assert.equal(back.softness, 0.6);
  assert.equal(back.cy, 0.4);
  assert.equal(parseBackdrop(undefined), undefined);
  assert.equal(parseBackdrop({ kind: "colour", from: "#ffffff" }), undefined);
  const odd = parseBackdrop({ kind: "gradient", from: "red", to: "#ABCDEF", angle: 999, glowAmount: -3, preset: "" })!;
  assert.equal(odd.from, "#404040");
  assert.equal(odd.to, "#abcdef");
  assert.equal(odd.angle, 360);
  assert.equal(odd.glowAmount, 0);
  assert.equal(odd.preset, undefined);
  assert.equal(odd.stops, undefined);
});

test("a picture is kept only when it is an image data URL", () => {
  assert.equal(parseBackdrop({ kind: "picture", from: "#000000", image: "http://example.com/a.jpg" }), undefined);
  assert.equal(parseBackdrop({ kind: "picture", from: "#000000" }), undefined);
  const ok = parseBackdrop({ kind: "picture", from: "#000000", image: "data:image/jpeg;base64,AAAA" });
  assert.equal(ok?.kind, "picture");
  assert.equal(ok?.image, "data:image/jpeg;base64,AAAA");
});

test("a saved gradient is named, kept, found again and taken out", () => {
  memoryStorage();
  assert.deepEqual(savedGradients(), []);
  assert.deepEqual(gradientPresets(), SHIPPED_GRADIENTS, "only those that ship with the app, so far");
  const first = saveGradient(night), second = saveGradient(spotlight);
  assert.equal(first.label, "Gradient 1");
  assert.equal(second.label, "Gradient 2");
  assert.notEqual(first.id, second.id);
  const list = savedGradients();
  assert.deepEqual(list.map((p) => p.label), ["Gradient 1", "Gradient 2"]);
  // (each remembers which entry it is, for the thumbnail that is lit)
  assert.equal(list[0].backdrop.preset, first.id);
  assert.equal(list[1].backdrop.shape, "radial");
  assert.deepEqual(list[0].backdrop.stops, night.stops);
  deleteGradient(first.id);
  assert.deepEqual(savedGradients().map((p) => p.label), ["Gradient 2"]);
  assert.equal(saveGradient(night).label, "Gradient 3", "a name that is taken is not used again");
});

test("a saved gradient can be renamed, but not to nothing", () => {
  memoryStorage();
  const a = saveGradient(night);
  renameGradient(a.id, "  Warm dusk  ");
  assert.equal(savedGradients()[0].label, "Warm dusk");
  renameGradient(a.id, "   ");
  assert.equal(savedGradients()[0].label, "Warm dusk");
  renameGradient("no such id", "x");
  assert.equal(savedGradients().length, 1);
  assert.equal(savedGradients()[0].backdrop.preset, a.id);
});

test("saved gradients that are not good are left out", () => {
  memoryStorage();
  (globalThis as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem("backdropGradients", JSON.stringify([
    { id: "a", label: "Fine", backdrop: night },
    { id: "b", label: "No stops", backdrop: { kind: "gradient", from: "#000000" } },
    { label: "No id", backdrop: night },
    null,
  ]));
  assert.deepEqual(savedGradients().map((p) => p.id), ["a"]);
  (globalThis as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem("backdropGradients", "not json");
  assert.deepEqual(savedGradients(), []);
});
