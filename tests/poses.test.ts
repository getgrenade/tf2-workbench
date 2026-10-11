import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHandFile, parsePoseFile, toHandFile, toPoseFile, type PoseData } from "../src/viewer/poseRig.ts";

const bones = ["bip_pelvis", "bip_hand_L", "bip_index_0_L", "bip_index_1_L", "bip_hand_R", "bip_index_0_R", "bip_index_1_R"];
const blank = (): PoseData => ({ pos: new Float32Array(bones.length * 3), quat: new Float32Array(bones.flatMap(() => [0, 0, 0, 1])) });

test("a hand pose holds only the finger bones of its hand", () => {
  const p = blank();
  p.quat.set([0.5, 0, 0, 0.866], 3 * 4); // bip_index_1_L
  const file = toHandFile("soldier", bones, p, "L");
  assert.deepEqual(file.bones, ["bip_index_0_L", "bip_index_1_L"]);
  assert.equal(file.kind, "hand");
  assert.deepEqual(file.pos, []);
  const back = parsePoseFile(JSON.stringify(file));
  assert.equal(back.hand, "L");
  assert.equal(back.bones.length, 2);
});

test("a hand pose goes on the hand that is chosen, whichever hand it was captured from, and changes nothing else", () => {
  const p = blank();
  p.quat.set([0.5, 0, 0, 0.866], 3 * 4);
  const left = toHandFile("soldier", bones, p, "L");
  const onLeft = applyHandFile(left, bones, blank(), "L");
  assert.equal(onLeft.pose.quat[3 * 4], 0.5);
  assert.equal(onLeft.pose.quat[6 * 4], 0, "the other hand is not touched");
  assert.equal(onLeft.changed, 2);
  const onRight = applyHandFile(left, bones, blank(), "R");
  assert.equal(onRight.pose.quat[6 * 4], 0.5, "a pose captured from the left hand goes on the right one");
  assert.equal(onRight.pose.quat[3 * 4], 0);
  // and the other way round
  const q = blank();
  q.quat.set([0, 0.5, 0, 0.866], 6 * 4);
  const right = toHandFile("soldier", bones, q, "R");
  assert.equal(applyHandFile(right, bones, blank(), "L").pose.quat[3 * 4 + 1], 0.5);
  assert.equal(applyHandFile(right, bones, blank(), "R").pose.quat[6 * 4 + 1], 0.5);
  // the pelvis and the hands themselves are untouched
  assert.equal(onRight.pose.quat[0 * 4 + 3], 1);
  assert.equal(onRight.pose.quat[4 * 4], 0);
  assert.equal(applyHandFile(left, ["bip_pelvis"], blank(), "R").changed, 0, "a skeleton without those fingers changes nothing");
});

test("a whole pose file keeps its thumbnail", () => {
  const file = toPoseFile("soldier", bones, blank(), undefined, "data:image/webp;base64,AAAA");
  const back = parsePoseFile(JSON.stringify(file));
  assert.equal(back.kind, "pose");
  assert.equal(back.thumb, "data:image/webp;base64,AAAA");
  assert.equal(parsePoseFile(JSON.stringify({ ...file, thumb: "javascript:alert(1)" })).thumb, undefined);
});
