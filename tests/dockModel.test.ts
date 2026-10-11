// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { activatePanel, emptyLayout, findPanel, hidePanel, movePanel, parseLayout, setFolded, showPanel, type DockLayout } from "../src/dock/dockModel.ts";

const base = (): DockLayout => {
  const l = emptyLayout();
  l.docks.left.groups = [{ tabs: ["outliner"], active: "outliner", weight: 1 }, { tabs: ["properties"], active: "properties", weight: 1 }];
  l.docks.right.groups = [{ tabs: ["cosmetics"], active: "cosmetics", weight: 1 }, { tabs: ["weapons"], active: "weapons", weight: 1 }];
  l.docks.bottom.groups = [{ tabs: ["anim", "flex", "poses"], active: "anim", weight: 1 }];
  return l;
};
const IDS = ["outliner", "properties", "cosmetics", "weapons", "anim", "flex", "poses"];
const shape = (l: DockLayout) => Object.fromEntries((["left", "right", "bottom"] as const).map((d) => [d, l.docks[d].groups.map((g) => g.tabs.join("+")).join(" | ")]));

test("a panel dragged onto the tabs of a group becomes one of them", () => {
  const next = movePanel(base(), "outliner", { kind: "tab", dock: "right", group: 0, index: 1 });
  assert.deepEqual(shape(next), { left: "properties", right: "cosmetics+outliner | weapons", bottom: "anim+flex+poses" });
  assert.equal(next.docks.right.groups[0].active, "outliner");
});

test("a panel can be dragged to another dock as a group of its own, before or after a group", () => {
  const split = movePanel(base(), "cosmetics", { kind: "split", dock: "left", group: 1, after: false });
  assert.deepEqual(shape(split), { left: "outliner | cosmetics | properties", right: "weapons", bottom: "anim+flex+poses" });
  const after = movePanel(base(), "weapons", { kind: "split", dock: "bottom", group: 0, after: true });
  assert.deepEqual(shape(after), { left: "outliner | properties", right: "cosmetics", bottom: "anim+flex+poses | weapons" });
});

test("a dock that was emptied takes a panel dropped on it", () => {
  let l = movePanel(base(), "cosmetics", { kind: "dock", dock: "left" });
  l = movePanel(l, "weapons", { kind: "dock", dock: "left" });
  assert.deepEqual(shape(l), { left: "outliner | properties | cosmetics | weapons", right: "", bottom: "anim+flex+poses" });
  const back = movePanel(l, "weapons", { kind: "dock", dock: "right" });
  assert.deepEqual(shape(back), { left: "outliner | properties | cosmetics", right: "weapons", bottom: "anim+flex+poses" });
});

test("tabs are put in order inside their own group", () => {
  assert.deepEqual(shape(movePanel(base(), "anim", { kind: "tab", dock: "bottom", group: 0, index: 3 })), { left: "outliner | properties", right: "cosmetics | weapons", bottom: "flex+poses+anim" });
  assert.deepEqual(shape(movePanel(base(), "poses", { kind: "tab", dock: "bottom", group: 0, index: 0 })), { left: "outliner | properties", right: "cosmetics | weapons", bottom: "poses+anim+flex" });
  assert.deepEqual(shape(movePanel(base(), "anim", { kind: "tab", dock: "bottom", group: 0, index: 1 })), { left: "outliner | properties", right: "cosmetics | weapons", bottom: "anim+flex+poses" });
});

test("a group that is left empty goes away, and a lone panel dropped beside itself stays", () => {
  const l = movePanel(base(), "properties", { kind: "tab", dock: "left", group: 0, index: 1 });
  assert.deepEqual(shape(l), { left: "outliner+properties", right: "cosmetics | weapons", bottom: "anim+flex+poses" });
  assert.deepEqual(shape(movePanel(base(), "outliner", { kind: "split", dock: "left", group: 0, after: true })), shape(base()));
});

test("hidden panels come back where they were", () => {
  const hidden = hidePanel(base(), "flex");
  assert.equal(findPanel(hidden, "flex"), null);
  assert.deepEqual(hidden.hidden, ["flex"]);
  const back = showPanel(hidden, "flex", "right");
  assert.deepEqual(shape(back), { left: "outliner | properties", right: "cosmetics | weapons", bottom: "anim+poses+flex" });
  assert.equal(back.docks.bottom.groups[0].active, "flex");
  // a panel of an emptied dock comes back as its group
  let l = hidePanel(base(), "anim");
  l = hidePanel(hidePanel(l, "flex"), "poses");
  assert.deepEqual(l.docks.bottom.groups, []);
  assert.deepEqual(shape(showPanel(l, "flex", "right")), { left: "outliner | properties", right: "cosmetics | weapons", bottom: "flex" });
});

test("a panel moved after it was hidden is not hidden any more", () => {
  const l = movePanel(hidePanel(base(), "weapons"), "weapons", { kind: "dock", dock: "left" });
  assert.deepEqual(l.hidden, []);
  assert.equal(findPanel(l, "weapons")?.dock, "left");
});

test("activating a tab and folding a dock", () => {
  assert.equal(activatePanel(base(), "poses").docks.bottom.groups[0].active, "poses");
  assert.deepEqual(setFolded(setFolded(base(), "left", true), "right", true).folded, ["left", "right"]);
  assert.deepEqual(setFolded(setFolded(base(), "left", true), "left", false).folded, []);
});

test("a saved layout is repaired: unknown and double panels go, missing ones come home", () => {
  const raw = { v: 1, docks: { left: { groups: [{ tabs: ["outliner", "ghost", "anim"], active: "ghost", weight: 2 }, { tabs: [], active: "" }] }, right: { size: 9999, groups: [{ tabs: ["anim", "cosmetics"], active: "cosmetics", weight: "x" }] }, bottom: { size: 300 } }, hidden: ["flex", "outliner", "nope"], lastDock: { flex: "bottom", ghost: "left" }, folded: ["left", "up"] };
  const l = parseLayout(raw, IDS, base());
  assert.deepEqual(shape(l), { left: "outliner+anim | properties", right: "cosmetics | weapons", bottom: "poses" });
  assert.equal(l.docks.left.groups[0].active, "outliner");
  assert.equal(l.docks.right.size, undefined);
  assert.equal(l.docks.bottom.size, 300);
  assert.equal(l.docks.right.groups[0].weight, 1);
  assert.deepEqual(l.hidden, ["flex"]);
  assert.deepEqual(l.lastDock, { flex: "bottom", properties: "left", weapons: "right", poses: "bottom" });
  assert.deepEqual(l.folded, ["left"]);
});

test("nothing usable falls back to the default layout", () => {
  assert.deepEqual(parseLayout(null, IDS, base()), base());
  assert.deepEqual(parseLayout({ v: 2 }, IDS, base()), base());
  assert.deepEqual(parseLayout("junk", IDS, base()), base());
});

test("a panel added after a layout was saved joins the group it shares in the default layout (when that one is still in its dock)", () => {
  const defaults = emptyLayout();
  defaults.docks.left.groups = [{ tabs: ["a", "b"], active: "a", weight: 1 }, { tabs: ["c"], active: "c", weight: 1 }];
  const saved = emptyLayout();
  saved.docks.left.groups = [{ tabs: ["c"], active: "c", weight: 1 }, { tabs: ["a"], active: "a", weight: 2 }];
  const parsed = parseLayout(JSON.parse(JSON.stringify(saved)), ["a", "b", "c"], defaults);
  assert.equal(parsed.docks.left.groups.map((g) => g.tabs.join("+")).join(" | "), "c | a+b");
  assert.equal(parsed.docks.left.groups[1].active, "a", "the active tab stays");
});
