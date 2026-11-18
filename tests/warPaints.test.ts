import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePaintKits, resolvePaintKit, seedOf, UniformRandomStream, warPaintWeaponOf, type PaintKitDefs } from "../src/viewer/warPaints.ts";

test("the engine's random stream gives the same numbers for a seed (vstdlib's ran1)", () => {
  const a = new UniformRandomStream(1234), b = new UniformRandomStream(1234), c = new UniformRandomStream(1235);
  const xs = [1, 2, 3].map(() => a.float(0, 1));
  assert.deepEqual(xs, [1, 2, 3].map(() => b.float(0, 1)));
  assert.notDeepEqual(xs, [1, 2, 3].map(() => c.float(0, 1)));
  for (const x of xs) assert.ok(x >= 0 && x < 1);
  // Numerical Recipes' ran1, seeded with -1: its first draw is 0.41599...
  assert.equal(new UniformRandomStream(0).float(0, 1).toFixed(5), "0.41600");
});

test("a seed as the game shows it (64 bits) folds into the 32 the stream takes", () => {
  assert.equal(seedOf("0"), 0);
  assert.equal(seedOf("1"), 1);
  assert.equal(seedOf(((5n << 32n) | 6n).toString()), 5 ^ 6);
  assert.equal(seedOf("not a number"), 0);
});

test("a weapon's war paint key is its model's name; the festive and Botkiller copies can't be painted", () => {
  assert.equal(warPaintWeaponOf({ model: "models/weapons/c_models/c_sniperrifle/c_sniperrifle.mdl", displayName: "Sniper Rifle" }), "sniperrifle");
  assert.equal(warPaintWeaponOf({ model: "models/weapons/c_models/c_scattergun.mdl", displayName: "Festive Scattergun" }), null);
  assert.equal(warPaintWeaponOf({ model: "models/weapons/c_models/c_minigun/c_minigun.mdl", displayName: "Silver Botkiller Minigun Mk.I" }), null);
  assert.equal(warPaintWeaponOf({ model: "models/weapons/c_models/c_bat.mdl", displayName: "Bat" }), null);
});

test("a weapon's paint at a wear: the wear's operation, and the values each level may change", () => {
  const d: PaintKitDefs = {
    ops: new Map([
      [1, { vars: [["a", "1", true], ["b", "2", false]], nodes: [["T", { texture: "$a" }]] }],
      [2, { vars: [["a", "9", true], ["b", "8", true]], nodes: [["T", { texture: "$a" }]] }],
    ]),
    itemDefs: new Map([[7, { itemIndex: 15000, vars: [["a", "3", true]], wears: [[null, []], [2, [["b", "5"]]]] }]]),
    kits: new Map([[14, { id: 14, name: "Night Owl", vars: [["a", "1", true], ["b", "2", false]], op: 1, weapons: { sniperrifle: [7, [["b", "4"]]] }, team: false }]]),
  };
  assert.deepEqual(resolvePaintKit(d, 14, "sniperrifle", 1), { op: 1, vars: { a: "3", b: "2" } });
  assert.deepEqual(resolvePaintKit(d, 14, "sniperrifle", 2), { op: 2, vars: { a: "3", b: "5" } });
  assert.equal(resolvePaintKit(d, 14, "scattergun", 1), null);
});

test("an empty definitions file has no paint kits", () => {
  const d = parsePaintKits(new Uint8Array(0), new Map(), () => undefined);
  assert.equal(d.kits.size, 0);
});
