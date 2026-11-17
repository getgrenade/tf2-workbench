import { test } from "node:test";
import assert from "node:assert/strict";
import { EditedItems } from "../src/viewer/editedItems.ts";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test("an item is marked edited when one of its materials is, whatever the case of the path", () => {
  const e = new EditedItems(memory());
  e.learn(30000, ["models/player/items/all_class/hat.vmt", "models/player/items/all_class/hat_blue.vmt"]);
  assert.equal(e.has(30000), false);
  e.setEdited(["Models/Player/Items/All_Class/HAT_BLUE.vmt"]);
  assert.equal(e.has(30000), true);
  assert.equal(e.has(1), false);
  e.setEdited([]);
  assert.equal(e.has(30000), false);
});

test("what an item wears is kept for the next run", () => {
  const store = memory();
  new EditedItems(store).learn(7, ["a.vmt"]);
  const again = new EditedItems(store);
  again.setEdited(["a.vmt"]);
  assert.equal(again.has(7), true);
});

test("listeners hear only real changes", () => {
  const e = new EditedItems(memory());
  let n = 0;
  e.onChange(() => n++);
  e.learn(1, ["a"]); e.learn(1, ["A"]);
  e.setEdited(["a"]); e.setEdited(["a"]);
  assert.equal(n, 2);
});
