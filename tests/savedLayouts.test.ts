// Layouts registered from the Layout menu.
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyLayout, hidePanel, movePanel, parseLayout, type DockLayout } from "../src/dock/dockModel.ts";
import { deleteSavedLayout, hasSavedLayout, layoutName, loadSavedLayouts, registerLayout } from "../src/dock/savedLayouts.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

const base = (): DockLayout => {
  const l = emptyLayout();
  l.docks.left.groups = [{ tabs: ["outliner"], active: "outliner", weight: 1 }, { tabs: ["properties"], active: "properties", weight: 1 }];
  l.docks.right.groups = [{ tabs: ["cosmetics"], active: "cosmetics", weight: 1 }];
  l.docks.bottom.groups = [{ tabs: ["anim", "poses"], active: "anim", weight: 1 }];
  return l;
};
const IDS = ["outliner", "properties", "cosmetics", "anim", "poses"];

test("a registered layout keeps the places of the panels and the ones that were put away, and comes back as it was", () => {
  const store = memory();
  const moved = hidePanel(movePanel(base(), "outliner", { kind: "tab", dock: "right", group: 0, index: 1 }), "poses");
  registerLayout("Animating", moved, store);
  const [saved] = loadSavedLayouts(store);
  assert.equal(saved.name, "Animating");
  const back = parseLayout(saved.layout, IDS, base());
  assert.deepEqual(back.docks.right.groups[0].tabs, ["cosmetics", "outliner"]);
  assert.deepEqual(back.hidden, ["poses"]);
  // a copy: the layout that was registered does not follow later changes to the one given
  moved.hidden.push("anim");
  assert.deepEqual(parseLayout(loadSavedLayouts(store)[0].layout, IDS, base()).hidden, ["poses"]);
});

test("a layout of the same name is replaced, names are tidied, and several are kept in order", () => {
  const store = memory();
  registerLayout("  Posing   room ", base(), store);
  registerLayout("Lighting", base(), store);
  registerLayout("posing room", hidePanel(base(), "anim"), store);
  const list = loadSavedLayouts(store);
  assert.deepEqual(list.map((s) => s.name), ["posing room", "Lighting"]);
  assert.deepEqual(parseLayout(list[0].layout, IDS, base()).hidden, ["anim"]);
  assert.equal(layoutName("   "), "");
  assert.equal(registerLayout("   ", base(), store).length, 2, "an empty name registers nothing");
  assert.ok(hasSavedLayout("LIGHTING", store));
  assert.ok(!hasSavedLayout("Other", store));
});

test("a layout is deleted by its name, and broken storage gives an empty list", () => {
  const store = memory();
  registerLayout("A", base(), store);
  registerLayout("B", base(), store);
  assert.deepEqual(deleteSavedLayout("a", store).map((s) => s.name), ["B"]);
  assert.deepEqual(loadSavedLayouts(store).map((s) => s.name), ["B"]);
  const broken = { getItem: () => "{not json", setItem: () => {} };
  assert.deepEqual(loadSavedLayouts(broken), []);
  assert.deepEqual(loadSavedLayouts({ getItem: () => JSON.stringify([{ name: 3 }, null, { name: "x", layout: null }, { name: "ok", layout: {} }]), setItem: () => {} }).map((s) => s.name), ["ok"]);
});
