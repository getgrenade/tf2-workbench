import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompiledModel, loadModelSwaps, saveModelSwaps, swapMaterials } from "../src/viewer/modelSwaps";
import type { ModelData } from "../src/viewer/payload";

const mesh = (red: string, blu: string) => ({ material: red, materials: [red, blu], indices: new Uint32Array([0, 1, 2]) });
const original = { bodyParts: [{ models: [{ meshes: [mesh("models/x/hat.vmt", "models/x/hat_blue.vmt"), mesh("models/x/band.vmt", "models/x/band.vmt")] }] }] } as unknown as ModelData;

test("a source material named like the original's takes it; any other takes the first", () => {
  assert.deepEqual(swapMaterials(original, "band"), ["models/x/band.vmt", "models/x/band.vmt"]);
  assert.deepEqual(swapMaterials(original, "HAT_BLUE.vmt"), ["models/x/hat.vmt", "models/x/hat_blue.vmt"]);
  assert.deepEqual(swapMaterials(original, "something_else"), ["models/x/hat.vmt", "models/x/hat_blue.vmt"]);
});

test("swaps are kept and read back, and an empty list is forgotten", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  saveModelSwaps([{ path: "models/a.mdl", file: "C:/b.smd" }], storage);
  assert.deepEqual(loadModelSwaps(storage), [{ path: "models/a.mdl", file: "C:/b.smd" }]);
  saveModelSwaps([], storage);
  assert.equal(store.size, 0);
  assert.ok(isCompiledModel("C:/x/Y.MDL") && !isCompiledModel("y.smd"));
});
