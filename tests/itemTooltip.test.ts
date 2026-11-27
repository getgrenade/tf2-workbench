// Run with: npm test -- itemTooltip
import assert from "node:assert/strict";
import { test } from "node:test";
import { itemTooltipLines } from "../src/viewer/itemTooltip.ts";
import { spellPaints } from "../src/viewer/spellPaints.ts";
import type { ItemInfo, PaintInfo } from "../src/viewer/payload.ts";

const item = (over: Partial<ItemInfo>) => ({ displayName: "Hat of Undeniable Wealth and Respect", name: "x", quality: "unique", slot: "head", typeName: "Hat", description: "Earned by completing 28 objectives.", level: [28, 28], workshop: false, ...over }) as ItemInfo;

test("the tooltip reads as the backpack's: name in the quality's colour, level and type, then the description", () => {
  const lines = itemTooltipLines(item({}));
  assert.deepEqual(lines.map((l) => [l.kind, l.text]), [["name", "Hat of Undeniable Wealth and Respect"], ["level", "Level 28 Hat"], ["neutral", "Earned by completing 28 objectives."]]);
  assert.equal(lines[0].color, "#ffd700");
});

test("a quality that is not Unique goes before the name, and a level range is not shown", () => {
  const lines = itemTooltipLines(item({ quality: "vintage", level: [1, 100] }));
  assert.equal(lines[0].text, "Vintage Hat of Undeniable Wealth and Respect");
  assert.equal(lines[0].color, "#476291");
  assert.equal(lines[1].text, "Hat");
});

test("a worn item says its paint, a spell as the game says it", () => {
  const paint = { id: 1, name: "x", displayName: "Team Spirit", rgb: 1, rgb2: 2 } as PaintInfo;
  assert.equal(itemTooltipLines(item({}), { paint })[2].text, "Paint Color: Team Spirit");
  const spell = itemTooltipLines(item({}), { paint: spellPaints()[0] })[2];
  assert.deepEqual([spell.kind, spell.text], ["halloween", "Halloween: Die Job (spell only active during event)"]);
});
