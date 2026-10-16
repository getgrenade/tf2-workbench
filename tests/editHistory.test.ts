// The history of the edits of what the scene is made of, and how it is ordered against the history of a character's place.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EditHistory } from "../src/viewer/editHistory.ts";
import { PlacementHistory, type PlacementSnapshot } from "../src/viewer/placementHistory.ts";

const snap = (x: number): PlacementSnapshot => ({ position: [x, 0, 0], yaw: 0, scale: [1, 1, 1], placed: true }) as PlacementSnapshot;

test("undo and redo run the commands in order, and a new edit drops what could be redone", async () => {
  const h = new EditHistory();
  const log: string[] = [];
  const cmd = (n: string) => ({ label: n, undo: () => void log.push("u" + n), redo: () => void log.push("r" + n) });
  h.push(cmd("a")); h.push(cmd("b"));
  assert.equal(h.undoLabel, "b");
  await h.undo(); await h.undo();
  assert.equal(await h.undo(), false);
  await h.redo();
  h.push(cmd("c"));
  assert.equal(await h.redo(), false);
  assert.deepEqual(log, ["ub", "ua", "ra"]);
});

test("a step pushed while a command runs is not an edit of its own", async () => {
  const h = new EditHistory();
  h.push({ label: "x", undo: () => h.push({ label: "inner", undo() {}, redo() {} }), redo() {} });
  await h.undo();
  assert.equal(h.undoLabel, undefined);
  assert.equal(h.redoLabel, "x");
});

test("a command that fails is dropped", async () => {
  const h = new EditHistory();
  h.push({ label: "bad", undo: () => { throw new Error("no"); }, redo() {} });
  const quiet = console.error; console.error = () => {};
  try { assert.equal(await h.undo(), false); } finally { console.error = quiet; }
  assert.equal(h.undoLabel, undefined);
  assert.equal(h.redoLabel, undefined);
});

test("the more recent of a structural edit and a placement edit has the higher number", () => {
  const h = new EditHistory();
  const p = new PlacementHistory();
  p.commit(snap(0), snap(1));
  h.push({ label: "delete", undo() {}, redo() {} });
  assert.ok(h.topUndoSeq()! > p.undoSeq()!);
  p.commit(snap(1), snap(2));
  assert.ok(p.undoSeq()! > h.topUndoSeq()!);
  p.undo(snap(2));
  assert.ok(p.redoSeq()! > p.undoSeq()!);
});
