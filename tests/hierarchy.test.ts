// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { entityHidden, flatten, isInside, newGroupName, parseGroups, withDescendants, type HierarchyGroup, type NodeKind, type TreeNode } from "../src/viewer/hierarchyTree.ts";
import { DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, parseLook } from "../src/viewer/browserView.ts";

const node = (id: string, label: string, group?: string, off = false, kind: NodeKind = "character"): TreeNode => ({ key: `${kind}:${id}`, kind, id, label, keywords: "", group, off });
const groups: HierarchyGroup[] = [{ id: "a", name: "Team A" }, { id: "b", name: "Medics", parent: "a" }, { id: "c", name: "Empty" }];
const names = (items: ReturnType<typeof flatten>) => items.map((i) => (i.kind === "group" ? `[${i.group.name}]` : i.node.label));

test("folders come first with what they hold, then the loose things", () => {
  const rows = flatten(groups, [node("1", "Scout"), node("2", "Medic", "b"), node("3", "Soldier", "a")], new Set(), "");
  assert.deepEqual(names(rows), ["[Team A]", "[Medics]", "Medic", "Soldier", "[Empty]", "Scout"]);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 2, 1, 0, 0]);
  assert.equal((rows[0] as { count: number }).count, 2);
});

test("characters, lights and cameras can share a folder", () => {
  const all = [node("1", "Scout"), node("light-0", "Key light", "a", false, "light"), node("cam-1", "Shot", "a", false, "camera"), node("2", "Spy", "a")];
  assert.deepEqual(names(flatten(groups, all, new Set(), "")), ["[Team A]", "[Medics]", "Key light", "Shot", "Spy", "[Empty]", "Scout"]);
  assert.equal((flatten(groups, all, new Set(), "")[0] as { count: number }).count, 3);
});

test("a collapsed folder hides its rows, a search opens it", () => {
  const all = [node("2", "Medic", "b"), node("3", "Soldier", "a")];
  assert.deepEqual(names(flatten(groups, all, new Set(["a"]), "")), ["[Team A]", "[Empty]"]);
  assert.deepEqual(names(flatten(groups, all, new Set(["a"]), "medic")), ["[Team A]", "[Medics]", "Medic"]);
});

test("a search for a folder name shows everything in it", () => {
  const all = [node("2", "Medic", "b"), node("3", "Soldier", "a"), node("4", "Scout")];
  assert.deepEqual(names(flatten(groups, all, new Set(), "team a")), ["[Team A]", "[Medics]", "Medic", "Soldier"]);
});

test("a thing in a folder that is gone is shown at the top level", () => {
  assert.deepEqual(names(flatten(groups, [node("1", "Pyro", "missing")], new Set(), "")), ["[Team A]", "[Medics]", "[Empty]", "Pyro"]);
});

test("a hidden folder hides what is in it and in the folders inside it", () => {
  const hid = groups.map((g) => (g.id === "a" ? { ...g, hidden: true } : g));
  assert.equal(entityHidden(hid, { group: "b", hidden: false }), true);
  assert.equal(entityHidden(hid, { group: "c", hidden: false }), false);
  assert.equal(entityHidden(groups, { hidden: true }), true);
  const rows = flatten(hid, [node("2", "Medic", "b"), node("3", "Soldier", "c")], new Set(), "");
  assert.equal(rows.find((r) => r.kind === "node" && r.node.label === "Medic")?.dimmed, true);
  assert.equal(rows.find((r) => r.kind === "node" && r.node.label === "Soldier")?.dimmed, false);
});

test("a folder cannot go into itself or into what it holds", () => {
  assert.equal(isInside(groups, "b", "a"), true);
  assert.equal(isInside(groups, "a", "a"), true);
  assert.equal(isInside(groups, "a", "b"), false);
  assert.equal(isInside(groups, undefined, "a"), false);
});

test("a folder and the folders inside it", () => {
  const all: HierarchyGroup[] = [{ id: "a", name: "A" }, { id: "b", name: "B", parent: "a" }, { id: "c", name: "C", parent: "b" }, { id: "d", name: "D" }];
  assert.deepEqual([...withDescendants(all, "a")].sort(), ["a", "b", "c"]);
  assert.deepEqual([...withDescendants(all, "d")], ["d"]);
});

test("new folders get a free name", () => {
  assert.equal(newGroupName([]), "Folder");
  assert.equal(newGroupName([{ id: "x", name: "Folder" }]), "Folder 2");
  assert.equal(newGroupName([{ id: "x", name: "Folder" }, { id: "y", name: "Folder 2" }]), "Folder 3");
});

test("saved folders are checked: bad ones go, loops and missing parents are cut", () => {
  const read = parseGroups([{ id: "a", name: "A", parent: "b" }, { id: "b", name: "B", parent: "a" }, { id: "c", name: "C", parent: "gone", hidden: true }, { id: "a", name: "dup" }, { name: "no id" }, 7]);
  assert.deepEqual(read.map((g) => g.id), ["a", "b", "c"]);
  assert.equal(read.every((g) => !g.parent), true);
  assert.equal(read[2].hidden, true);
  assert.deepEqual(parseGroups("nope"), []);
});

test("the browser look reads what was saved and falls back to the default", () => {
  assert.deepEqual(parseLook(null), { mode: "grid", size: DEFAULT_SIZE });
  assert.deepEqual(parseLook("{{"), { mode: "grid", size: DEFAULT_SIZE });
  assert.deepEqual(parseLook('{"mode":"list","size":120}'), { mode: "list", size: 120 });
  assert.equal(parseLook('{"size":9999}').size, MAX_SIZE);
  assert.equal(parseLook('{"size":1}').size, MIN_SIZE);
  assert.equal(parseLook('{"mode":"cube"}').mode, "grid");
});
