// Run with: npm test -- spellPaints
import assert from "node:assert/strict";
import { test } from "node:test";
import { spellPaintId, spellPaints, spellRgb } from "../src/viewer/spellPaints.ts";

test("a spell starts at the first sample of its cycle and blends to the next", () => {
  assert.equal(spellRgb(0, false, 0), 5328971); // Die Job (k_unWitchYellow[0])
  // halfway between the first two samples of Chromatic Corruption (5720667 -> 5720667: the same)
  assert.equal(spellRgb(1, false, 0.5 / 22), 5720667);
  // the cycle comes round after 256 samples
  assert.equal(spellRgb(2, false, 256 / 22), spellRgb(2, false, 0));
});

test("only Spectral Spectrum differs by team", () => {
  assert.notEqual(spellRgb(3, false, 3), spellRgb(3, true, 3));
  for (const s of [0, 1, 2, 4]) assert.equal(spellRgb(s, false, 3), spellRgb(s, true, 3));
});

test("the five spells are paints with ids no paint can has", () => {
  const all = spellPaints();
  assert.deepEqual(all.map((p) => p.displayName), ["Die Job", "Chromatic Corruption", "Putrescent Pigmentation", "Spectral Spectrum", "Sinister Staining"]);
  assert.ok(all.every((p) => p.id < 0 && p.spell !== undefined));
  assert.equal(all[3].id, spellPaintId(3));
});
