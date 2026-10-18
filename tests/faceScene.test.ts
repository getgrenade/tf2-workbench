// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { addLipSync, curveValue, sceneFace, trackValue, type PhonemeClasses, type SceneData } from "../src/viewer/faceScene.ts";

const near = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test("a curve passes through its samples and rests on its edge values", () => {
  const s: [number, number, number][] = [[0.5, 1, 0], [1.5, 0.2, 0]];
  near(curveValue(s, 0.5, 2, 0, 0), 1);
  near(curveValue(s, 1.5, 2, 0, 0), 0.2);
  near(curveValue(s, 0, 2, 0, 0), 0);
  near(curveValue(s, 2, 2, 0, 0.7), 0.7);
  const mid = curveValue(s, 1, 2, 0, 0);
  assert.ok(mid > 0.2 && mid < 1, `between: ${mid}`);
});

test("linear and hold curves", () => {
  const linear = (6 << 8) | 6, hold = (15 << 8) | 15;
  near(curveValue([[0, 0, linear], [1, 1, linear]], 0.25, 1, 0, 0), 0.25);
  near(curveValue([[0, 0.3, hold], [1, 1, hold]], 0.6, 1, 0, 0), 0.3);
});

test("a track's value is in the controller's range, and a stereo track shares it out by its balance", () => {
  const t = { controller: "smile", combo: true, min: -1, max: 1, samples: [[0, 1, 0], [2, 1, 0]] as [number, number, number][], balance: [[0, 1, 0], [2, 1, 0]] as [number, number, number][] };
  near(trackValue(t, 1, 2, 1), 1); // balance all to the left: the left side is full
  near(trackValue(t, 1, 2, 0), 0); // and the right one gets none
});

const scene: SceneData = {
  path: "x",
  ramp: [],
  sounds: {},
  expressions: { "player/heavy/emotion/emotion": { mad: [["brow_lower", 1, 1]] } },
  events: [
    { kind: "expression", name: "mad", start: 1, end: 3, params: "player\\heavy\\emotion\\emotion", params2: "mad", ramp: [], tracks: [] },
    { kind: "flexanimation", name: "anim", start: 0, end: 2, params: "", params2: "", ramp: [], tracks: [{ controller: "jaw", combo: false, min: 0, max: 1, samples: [[0, 0.5, 1542], [2, 0.5, 1542]], balance: [] }] }, // linear
  ],
};

test("a scene sets its controllers while its events run, and leaves the others to the character", () => {
  const before = sceneFace(scene, 0.5, new Map([["blink", 0.3]]), new Set());
  near(before.get("jaw")!, 0.5);
  assert.equal(before.get("brow_lower"), undefined); // the expression has not started
  near(before.get("blink")!, 0.3);
  const during = sceneFace(scene, 2, new Map(), new Set());
  near(during.get("brow_lower")!, 1);
  const after = sceneFace(scene, 3.5, new Map(), new Set());
  assert.equal(after.get("brow_lower"), undefined);
});

const classes: PhonemeClasses = { normal: { "593": [["AH", 1]] } };

test("a phoneme adds its mouth shape while it is said, and none after", () => {
  const out = new Map<string, number>();
  addLipSync(out, classes, { phonemes: [[593, 0.2, 0.5]], emphasis: [] }, 0.35, 1);
  assert.ok((out.get("ah") ?? 0) > 0.5);
  const quiet = new Map<string, number>();
  addLipSync(quiet, classes, { phonemes: [[593, 0.2, 0.5]], emphasis: [] }, 0.9, 1);
  assert.equal(quiet.get("ah"), undefined);
});
