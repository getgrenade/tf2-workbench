// Run with: npm test -- materialEditsStore
import assert from "node:assert/strict";
import { test } from "node:test";
import { editsFor, loadMaterialEdits, saveMaterialEdits } from "../src/viewer/materialEditsStore.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

test("the edits are kept and read back, and nothing is kept when there are none", () => {
  const store = memory();
  const edits = { textures: [{ path: "Models/Hat", slot: "base", file: "C:\\\\mine.png" }], vmts: [{ path: "models/hat", text: "\"VertexLitGeneric\" {}" }] };
  saveMaterialEdits(edits, store);
  assert.deepEqual(loadMaterialEdits(store), edits);
  assert.deepEqual(editsFor(edits, "MODELS/HAT"), { vmt: "\"VertexLitGeneric\" {}", textures: [{ slot: "base", file: "C:\\\\mine.png" }] });
  saveMaterialEdits({ textures: [], vmts: [] }, store);
  assert.equal(store.m.size, 0);
});

test("what is not an edit is left out of what was kept", () => {
  const store = memory();
  store.setItem("tf2workbench.materialEdits", JSON.stringify({ textures: [{ path: 1 }, { path: "a", slot: "base", file: "f" }], vmts: "no" }));
  assert.deepEqual(loadMaterialEdits(store), { textures: [{ path: "a", slot: "base", file: "f" }], vmts: [] });
  store.setItem("tf2workbench.materialEdits", "not json");
  assert.deepEqual(loadMaterialEdits(store), { textures: [], vmts: [] });
});
