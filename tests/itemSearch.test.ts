// Run with: npm test -- itemSearch
import assert from "node:assert/strict";
import { test } from "node:test";
import { itemMatches } from "../src/viewer/itemSearch.ts";
import type { ItemInfo } from "../src/viewer/payload.ts";

const robro = { displayName: "RoBro 3000", name: "Pet Robro", typeName: "Robot", description: "The RoBro 3000 doesn't just watch your back in battle!" } as ItemInfo;

test("an item is found by its name, its type or its description", () => {
  assert.equal(itemMatches(robro, "robro"), true);
  assert.equal(itemMatches(robro, "robot"), true);
  assert.equal(itemMatches(robro, "watch your back"), true);
  assert.equal(itemMatches(robro, "robot battle"), true);
  assert.equal(itemMatches(robro, "hat"), false);
});
