// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { rollLoadout, type LoadoutRule } from "../src/viewer/randomLoadout.ts";
import type { ItemInfo, PaintInfo } from "../src/viewer/payload.ts";

let nextId = 1;
const item = (displayName: string, equipRegions: string[], extra: Partial<ItemInfo> = {}): ItemInfo =>
  ({ id: nextId++, name: displayName, displayName, equipRegions, medal: false, workshop: false, paintable: true, styles: [], slot: "misc", classes: [], ...extra }) as unknown as ItemInfo;

const hats = [item("Hat A", ["hat"]), item("Hat B", ["hat"]), item("Helmet", ["hat", "face"])];
const shirts = [item("Shirt A", ["shirt"]), item("Shirt B", ["shirt"])];
const medals = Array.from({ length: 200 }, (_, i) => item(`Medal ${i}`, ["medal"], { medal: true }));
const mine = item("My Hat", ["hat"], { workshop: true });
const glasses = item("Glasses", ["glasses"]);
const pool = [...hats, ...shirts, ...medals, mine, glasses];
const paints = [{ id: 1, name: "p", displayName: "Paint", rgb: 1, rgb2: null }] as unknown as PaintInfo[];
const conflicts = (a: ItemInfo, b: ItemInfo) => a.equipRegions.some((r) => b.equipRegions.includes(r));
const opts = { count: 3, paintChance: 0, styles: false, workshop: false };
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test("the rules are met on every roll: must include a shirt and my hat, no medals", () => {
  const rules: LoadoutRule[] = [
    { mode: "include", kind: "region", value: "shirt" },
    { mode: "include", kind: "item", value: String(mine.id) },
    { mode: "exclude", kind: "medal", value: "" },
  ];
  for (let s = 1; s < 200; s++) {
    const r = rollLoadout(pool, paints, conflicts, rules, opts, seeded(s));
    assert.ok("items" in r);
    const picked = r.items.map((x) => x.item);
    assert.ok(picked.includes(mine), "the named workshop item is worn although workshop items are off");
    assert.ok(picked.some((x) => x.equipRegions.includes("shirt")));
    assert.ok(!picked.some((x) => x.medal));
    for (const a of picked) for (const b of picked) if (a !== b) assert.ok(!conflicts(a, b), "no two items share a region");
    assert.equal(picked.length, 3);
  }
});

test("medals are rare without a rule, though there are many of them", () => {
  let withMedal = 0;
  for (let s = 1; s < 300; s++) {
    const r = rollLoadout(pool, paints, conflicts, [], { ...opts, count: 1 }, seeded(s));
    if ("items" in r && r.items[0].item.medal) withMedal++;
  }
  assert.ok(withMedal < 150, `medals came up ${withMedal} times in 300`);
});

test("a rule nothing can meet is reported", () => {
  const rule: LoadoutRule = { mode: "include", kind: "region", value: "feet" };
  const r = rollLoadout(pool, paints, conflicts, [rule], opts, seeded(3));
  assert.deepEqual(r, { failed: rule });
});

test("a region left out is never picked, and workshop items only when asked", () => {
  for (let s = 1; s < 100; s++) {
    const r = rollLoadout(pool, paints, conflicts, [{ mode: "exclude", kind: "region", value: "hat" }], opts, seeded(s));
    assert.ok("items" in r);
    assert.ok(!r.items.some((x) => x.item.equipRegions.includes("hat") || x.item.workshop));
  }
});

test("paint chance: never paints at 0, always paints a paintable item at 1", () => {
  const r0 = rollLoadout(pool, paints, conflicts, [], opts, seeded(9));
  const r1 = rollLoadout(pool, paints, conflicts, [], { ...opts, paintChance: 1 }, seeded(9));
  assert.ok("items" in r0 && "items" in r1);
  assert.ok(r0.items.every((x) => x.paint === null));
  assert.ok(r1.items.every((x) => x.paint !== null));
});
