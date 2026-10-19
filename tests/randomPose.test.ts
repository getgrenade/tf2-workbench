// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { choosePose, rollFace, rollPoseParams, UPPER_MAX, type PoseSource } from "../src/viewer/randomPose.ts";
import type { ItemInfo, PoseParamInfo, SequenceInfo } from "../src/viewer/payload.ts";

const weapon = (id: number, slot: string, animSlot = "", extra: Partial<ItemInfo> = {}) =>
  ({ id, displayName: `w${id}`, slot, animSlot, classes: [], model: "w.mdl", perClass: {}, styles: [], classSlots: {}, poseParams: {}, workshop: false, tauntScenes: {}, tauntPropScenes: {}, ...extra }) as unknown as ItemInfo;
const taunt = (id: number, scene: string, props = false) =>
  weapon(id, "taunt", "", { tauntScenes: { scout: scene }, tauntPropScenes: props ? { scout: "p" } : {} });
const seq = (index: number, name: string, frames = 50): SequenceInfo => ({ index, name, frames, fps: 30, looping: true, hidden: false });
const param = (name: string, start: number, end: number): PoseParamInfo => ({ name, start, end, looping: false, default: -start / (end - start) });

const params = [param("body_pitch", -45, 90), param("body_yaw", -45, 45), param("move_x", -1, 1), param("move_y", -1, 1)];
const source = (over: Partial<PoseSource> = {}): PoseSource => ({
  game: "scout",
  taunts: [taunt(1, "taunt01"), taunt(2, "taunt_yetipunch"), taunt(3, "taunt_prop", true)],
  weapons: [weapon(10, "primary"), weapon(11, "melee"), weapon(12, "melee", "MELEE_ALLCLASS")],
  sequences: [seq(0, "stand_PRIMARY"), seq(1, "run_MELEE"), seq(2, "stand_MELEE_ALLCLASS"), seq(3, "crouch_PRIMARY"), seq(4, "taunt01"), seq(5, "stand_loser"), seq(6, "run_SECONDARY")],
  poseParams: params,
  props: false,
  ...over,
});

test("a random taunt is never the Yeti's, and a prop taunt only when props are allowed", () => {
  const picked = new Set<number>();
  for (let i = 0; i < 80; i++) picked.add((choosePose("taunt", source())!.kind === "taunt" && (choosePose("taunt", source()) as { taunt: ItemInfo }).taunt.id) as number);
  assert.deepEqual([...picked].sort(), [1]);
  const withProps = new Set<number>();
  for (let i = 0; i < 80; i++) withProps.add((choosePose("taunt", source({ props: true })) as { taunt: ItemInfo }).taunt.id);
  assert.deepEqual([...withProps].sort(), [1, 3]);
});

test("a random animation is a stand or run animation with a weapon of its set", () => {
  const seen = new Map<string, Set<number>>();
  for (let i = 0; i < 200; i++) {
    const c = choosePose("anim", source());
    assert.equal(c?.kind, "anim");
    if (c?.kind !== "anim") continue;
    (seen.get(c.seq.name) ?? seen.set(c.seq.name, new Set()).get(c.seq.name)!).add(c.weapon.id);
  }
  // crouching, the taunt's own sequence, the class's idle and a set no weapon has are not picked
  assert.deepEqual([...seen.keys()].sort(), ["run_MELEE", "stand_MELEE_ALLCLASS", "stand_PRIMARY"]);
  assert.deepEqual([...seen.get("stand_PRIMARY")!], [10]);
  assert.deepEqual([...seen.get("run_MELEE")!], [11]);
  assert.deepEqual([...seen.get("stand_MELEE_ALLCLASS")!], [12]);
});

test("what the others of a scene have is avoided while there is something else", () => {
  const avoid = new Set(["sstand_PRIMARY", "srun_MELEE"]);
  for (let i = 0; i < 30; i++) assert.equal((choosePose("anim", source(), avoid) as { seq: SequenceInfo }).seq.name, "stand_MELEE_ALLCLASS");
  const everything = new Set(["sstand_PRIMARY", "srun_MELEE", "sstand_MELEE_ALLCLASS"]);
  assert.ok(choosePose("anim", source(), everything), "a repeat when all are taken");
  assert.equal(choosePose("anim", source({ sequences: [] })), null);
});

test("the pose parameters of a roll stay in their ranges; a standing character does not move", () => {
  for (let i = 0; i < 200; i++) {
    const run = rollPoseParams(seq(1, "run_MELEE"), weapon(11, "melee"), params);
    assert.ok(run.body_pitch >= -12 && run.body_pitch <= 4, `pitch ${run.body_pitch}`);
    assert.ok(Math.abs(run.body_yaw) <= 45 * 0.25 + 1e-6, `yaw ${run.body_yaw}`);
    assert.ok(Math.abs(run.move_y) <= 0.25 + 1e-6, `move_y ${run.move_y}`);
    assert.ok(Math.abs(run.move_x) <= 1 + 1e-6);
    const stand = rollPoseParams(seq(0, "stand_PRIMARY"), weapon(10, "primary"), params);
    assert.equal(stand.move_x, 0);
    assert.equal(stand.move_y, 0);
  }
});

test("a random face adds up to at most 1 and keeps its upper flexes small", () => {
  const have = new Set(["gk", "t", "mb", "happybig", "happybigupper", "painbig", "painbigupper", "mad", "madupper", "scared", "eyes_updown"]);
  const shapes = [[["gk", 1], ["t", 1]], [["mb", 1]]] as const;
  for (let i = 0; i < 300; i++) {
    const face = rollFace(have, shapes);
    let sum = 0;
    for (const [name, value] of face) {
      assert.ok(have.has(name), name);
      sum += value;
      if (name.endsWith("upper")) assert.ok(value <= UPPER_MAX + 1e-9, `${name} ${value}`);
    }
    assert.ok(sum <= 1 + 1e-9, `sum ${sum}`);
    assert.ok(face.size > 0);
  }
  assert.equal(rollFace(new Set(["dummyblend"]), shapes).size, 0, "a model with no face");
});
