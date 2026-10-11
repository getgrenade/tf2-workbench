import test from "node:test";
import assert from "node:assert/strict";
import { InventoryIconCache } from "../../src/viewer/inventoryIconCache";

test("browsers load only small icons; overlays request large artwork once without replacing thumbnail entries", async () => {
  const reads: string[] = [];
  const cache = new InventoryIconCache(async image => { reads.push(image); return `pixels:${image}`; });
  assert.equal(await cache.small("hat"), "pixels:hat");
  await cache.small("taunt"); await cache.small("hat");
  assert.deepEqual(reads, ["hat", "taunt"]);
  const icons = await Promise.all([cache.overlay("hat"), cache.overlay("hat")]);
  assert.deepEqual(icons, ["pixels:hat_large", "pixels:hat_large"]);
  assert.equal(await cache.small("hat"), "pixels:hat");
  assert.deepEqual(reads, ["hat", "taunt", "hat_large"]);
});

test("missing large artwork falls back to the cached small icon and workshop refresh purges both qualities", async () => {
  const reads: string[] = [];
  const cache = new InventoryIconCache(async image => { reads.push(image); return image.endsWith("_large") ? null : "small pixels"; });
  await cache.small("workshop/hat");
  assert.equal(await cache.overlay("workshop/hat"), "small pixels");
  await cache.overlay("workshop/hat");
  assert.deepEqual(reads, ["workshop/hat", "workshop/hat_large"]);
  cache.purge(image => image.startsWith("workshop/"));
  await cache.overlay("workshop/hat");
  assert.deepEqual(reads.slice(2), ["workshop/hat_large", "workshop/hat"]);
});
