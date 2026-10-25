// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { coversSpyHead } from "../src/viewer/conditions.ts";

const item = (equipRegions: string[], bodygroups: Record<string, number> = {}, styles: { bodygroups?: Record<string, number> }[] = []) => ({ item: { equipRegions, bodygroups, styles } });

test("a Spy's head is covered by a mask, a hood, or an item that hides his head; not by a hat", () => {
  assert.equal(coversSpyHead([]), false);
  assert.equal(coversSpyHead([item(["hat"], { hat: 1 })]), false);
  assert.equal(coversSpyHead([item(["whole_head"], { hat: 1 })]), true);
  assert.equal(coversSpyHead([item(["hat"]), item(["face"])]), true);
  assert.equal(coversSpyHead([item(["beard"], { head: 1 })]), true);
  // a style that hides the head
  assert.equal(coversSpyHead([{ ...item(["hat"], {}, [{}, { bodygroups: { head: 1 } }]), style: 1 }]), true);
  assert.equal(coversSpyHead([{ ...item(["hat"], {}, [{}, { bodygroups: { head: 1 } }]), style: 0 }]), false);
});
