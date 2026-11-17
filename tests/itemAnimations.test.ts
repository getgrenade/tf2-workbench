// Run with: npm test -- itemAnimations
import assert from "node:assert/strict";
import { test } from "node:test";
import { activitySequence, clipMoves, clockSequence } from "../src/viewer/itemAnimations.ts";
import type { ClipData, SequenceInfo } from "../src/viewer/payload.ts";

const seq = (index: number, name: string, frames: number, over: Partial<SequenceInfo> = {}): SequenceInfo => ({ index, name, frames, fps: 30, looping: false, hidden: false, ...over });

test("an item's clock sequence is its longest autoplay or real-time one that has frames to play", () => {
  // the Hat of Undeniable Wealth and Respect: a still ref and a real-time blink
  assert.equal(clockSequence([seq(0, "ref", 1, { activity: "ACT_IDLE" }), seq(1, "blink", 499, { onClock: true })])?.name, "blink");
  // the Pet RoBro: its autoplay idle
  assert.equal(clockSequence([seq(0, "idle", 30, { onClock: true })])?.name, "idle");
  // an all-class hat: an ordinary first sequence, posed and held, not run
  assert.equal(clockSequence([seq(0, "ref", 30)]), null);
  assert.equal(clockSequence([seq(0, "ref", 1, { onClock: true })]), null);
});

test("playback_activity picks the sequence of its activity", () => {
  const list = [seq(0, "stopped", 1, { activity: "ACT_IDLE" }), seq(1, "started", 48, { activity: "ACT_RUN" })];
  assert.equal(activitySequence(list, "ACT_RUN")?.name, "started");
  assert.equal(activitySequence(list, "act_run")?.name, "started");
  assert.equal(activitySequence(list, "ACT_WALK"), null);
  assert.equal(activitySequence(list, ""), null);
});

test("a clip moves when any bone leaves where it is on the first frame", () => {
  const clip = (quats: number[][]): ClipData => ({ fps: 30, looping: true, frames: quats.length, numBones: 1, pos: new Float32Array(quats.length * 3), quat: new Float32Array(quats.flat()) });
  assert.equal(clipMoves(clip([[0, 0, 0, 1], [0, 0, 0, 1]])), false);
  assert.equal(clipMoves(clip([[0, 0, 0, 1], [0, 0, 0.38, 0.92]])), true);
});
