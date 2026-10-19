// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyWorkshopStyles, namedStyleOf } from "../src/viewer/workshopStyles.ts";
import type { ItemDb, ItemInfo } from "../src/viewer/payload.ts";

let id = 1;
const ws = (name: string): ItemInfo =>
  ({ id: id++, name, displayName: name, workshop: true, slot: "head", model: `models/workshop/${name}.mdl`, perClass: {}, image: null, bodygroups: {}, styles: [] }) as unknown as ItemInfo;
const db = (items: ItemInfo[]) => ({ items, weapons: [], taunts: [], paints: [], equipConflicts: {} }) as ItemDb;

test("a style by its name goes onto its item and leaves the list", () => {
  const base = ws("cighat"), style = ws("cighat_style"), style3 = ws("cighat_style3"), other = ws("allpirate");
  const out = applyWorkshopStyles(db([base, style, style3, other]), {});
  assert.deepEqual(out.items.map((i) => i.name), ["cighat", "allpirate"]);
  assert.deepEqual(base.styles.map((s) => [s.name, s.model]), [["Style 1", "models/workshop/cighat.mdl"], ["Style 2", "models/workshop/cighat_style.mdl"], ["Style 4", "models/workshop/cighat_style3.mdl"]]);
  assert.equal(other.styles.length, 0);
});

test("a style linked by hand, whatever its name, with its own label", () => {
  const base = ws("cighat"), noband = ws("cighat_noband");
  const out = applyWorkshopStyles(db([base, noband]), { cighat: [{ name: "cighat_noband", label: "No band" }] });
  assert.deepEqual(out.items.map((i) => i.name), ["cighat"]);
  assert.deepEqual(base.styles.map((s) => s.name), ["Style 1", "No band"]);
});

test("names that only look like styles stay items", () => {
  assert.equal(namedStyleOf("_style"), null);
  assert.deepEqual(namedStyleOf("brim_reaper_style2"), { base: "brim_reaper", order: 2 });
  const lone = ws("lonely_style");
  assert.deepEqual(applyWorkshopStyles(db([lone]), {}).items.map((i) => i.name), ["lonely_style"]);
});
