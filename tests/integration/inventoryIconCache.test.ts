import test from "node:test";
import assert from "node:assert/strict";
import { InventoryIconCache } from "../../src/viewer/inventoryIconCache";

test("icons are decoded once each", async () => {
  const reads: string[] = [];
  const cache = new InventoryIconCache(async image => { reads.push(image); return `pixels:${image}`; });
  assert.equal(await cache.small("hat"), "pixels:hat");
  await cache.small("taunt"); await cache.small("hat");
  assert.deepEqual(reads, ["hat", "taunt"]);
});

test("a workshop refresh purges the icons it matches", async () => {
  const reads: string[] = [];
  const cache = new InventoryIconCache(async image => { reads.push(image); return "pixels"; });
  await cache.small("workshop/hat"); await cache.small("hat");
  cache.purge(image => image.startsWith("workshop/"));
  await cache.small("workshop/hat"); await cache.small("hat");
  assert.deepEqual(reads, ["workshop/hat", "hat", "workshop/hat"]);
});
