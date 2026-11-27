// Run with: npm test -- updates
import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewer, versionParts } from "../src/updates.ts";

test("a release tag is read number by number", () => {
  assert.deepEqual(versionParts("v0.2.10-beta"), [0, 2, 10]);
  assert.deepEqual(versionParts("1.0"), [1, 0]);
  assert.deepEqual(versionParts("latest"), []);
});

test("a release is newer only when one of its numbers is higher", () => {
  assert.equal(isNewer("v0.2.0", "0.1.0"), true);
  assert.equal(isNewer("v0.1.10", "0.1.9"), true);
  assert.equal(isNewer("0.1", "0.1.0"), false);
  assert.equal(isNewer("v0.1.0", "0.2.0"), false);
  assert.equal(isNewer("nightly", "0.1.0"), false);
});
