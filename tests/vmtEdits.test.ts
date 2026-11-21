// Run with: npm test -- vmtEdits
import assert from "node:assert/strict";
import { test } from "node:test";
import { VmtEdits } from "../src/viewer/vmtEdits.ts";
import type { MaterialData } from "../src/viewer/payload.ts";

const mat = (shader: string): MaterialData => ({ path: "Models/Hat", shader, params: {}, proxies: [], textures: {}, errors: [] });

test("an edited VMT keeps the game's material and text through every edit, until it is reset", () => {
  const edits = new VmtEdits();
  const game = mat("vertexlitgeneric");
  edits.set("Models/Hat", "a", game, "game text");
  edits.set("models/hat", "b", mat("unlitgeneric"), "a");
  assert.equal(edits.text("MODELS/HAT"), "b");
  assert.equal(edits.originalText("models/hat"), "game text");
  assert.equal(edits.edited("models/hat"), true);
  assert.equal(edits.take("models/hat"), game);
  assert.equal(edits.edited("models/hat"), false);
  assert.equal(edits.take("models/hat"), null);
});
