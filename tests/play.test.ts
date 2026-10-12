import { test } from "node:test";
import assert from "node:assert/strict";
import { blendPoses, findSequence, grounded, moveParams, newMotion, nextSlot, speedFraction, stepMotion, type MoveInput } from "../src/viewer/playLogic.ts";

const idle: MoveInput = { forward: 0, right: 0, crouch: false, jump: false };

test("weapon slots cycle through the ones the class has", () => {
  assert.equal(nextSlot("primary", ["primary", "secondary", "melee", "utility"]), "secondary");
  assert.equal(nextSlot("melee", ["primary", "secondary", "melee", "utility"]), "utility");
  assert.equal(nextSlot("utility", ["primary", "secondary", "melee", "utility"]), "primary");
  assert.equal(nextSlot("secondary", ["secondary", "melee"]), "melee");
  assert.equal(nextSlot("melee", ["secondary", "melee"]), "secondary");
  assert.equal(nextSlot(null, ["melee"]), "melee");
  assert.equal(nextSlot("melee", []), null);
});

test("sequences fall back to other weapon sets and kinds", () => {
  const names = new Map([["stand_melee", 1], ["run_primary", 2], ["jump_float_primary", 3], ["crouch_melee", 4]]);
  assert.equal(findSequence(names, "stand", ["primary"]), 1);
  assert.equal(findSequence(names, "run", ["melee"]), 2);
  assert.equal(findSequence(names, "crouch", ["melee"]), 4);
  assert.equal(findSequence(names, "crouch_walk", ["melee"]), 2);
  assert.equal(findSequence(names, "jump_start", ["primary"]), 3);
  assert.equal(findSequence(new Map(), "stand", []), null);
});

test("walking forward reaches the run speed and drives move_x", () => {
  const m = newMotion();
  const input = { ...idle, forward: 1 };
  for (let i = 0; i < 120; i++) stepMotion(m, input, 1 / 60, 240);
  assert.ok(m.z > 100, "moved along +z (the facing at yaw 0)");
  assert.ok(Math.abs(speedFraction(m, 240) - 1) < 0.02);
  const p = moveParams(m, 240);
  assert.ok(p.moveX > 0.95 && Math.abs(p.moveY) < 0.05);
});

test("strafing right moves to the character's right and drives move_y", () => {
  const m = newMotion();
  for (let i = 0; i < 120; i++) stepMotion(m, { ...idle, right: 1 }, 1 / 60, 240);
  assert.ok(m.x < -100, "right of a character facing +z is -x");
  const p = moveParams(m, 240);
  assert.ok(p.moveY > 0.95 && Math.abs(p.moveX) < 0.05);
});

test("turning changes what forward means", () => {
  const m = newMotion(0, 0, Math.PI / 2);
  for (let i = 0; i < 60; i++) stepMotion(m, { ...idle, forward: 1 }, 1 / 60, 240);
  assert.ok(m.x > 100 && Math.abs(m.z) < 1);
});

test("a jump leaves the ground and lands again; crouching cannot jump", () => {
  const m = newMotion();
  stepMotion(m, { ...idle, jump: true }, 1 / 60, 240);
  assert.ok(!grounded(m));
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    stepMotion(m, idle, 1 / 60, 240);
    peak = Math.max(peak, m.h);
  }
  assert.ok(peak > 30 && peak < 80, `peak ${peak}`);
  assert.ok(grounded(m));
  const c = newMotion();
  stepMotion(c, { ...idle, crouch: true, jump: true }, 1 / 60, 240);
  assert.ok(grounded(c) && c.crouching);
});

test("blending takes the short way round and keeps rotations unit length", () => {
  const a = { pos: new Float32Array([0, 0, 0]), quat: new Float32Array([0, 0, 0, 1]) };
  const b = { pos: new Float32Array([2, 0, 0]), quat: new Float32Array([0, 0, 0, -1]) };
  const out = blendPoses(a, b, 0.5, { pos: new Float32Array(3), quat: new Float32Array(4) });
  assert.equal(out.pos[0], 1);
  assert.ok(Math.abs(Math.hypot(...out.quat) - 1) < 1e-6 && Math.abs(out.quat[3]) > 0.99);
});

test("the torso twists first, then the feet turn under it", async () => {
  const { stepFeet, bodyYawDegrees } = await import("../src/viewer/playLogic.ts");
  const m = newMotion();
  m.yaw = (30 * Math.PI) / 180;
  for (let i = 0; i < 30; i++) stepFeet(m, false, 1 / 60);
  assert.equal(m.feetYaw, 0, "a small turn leaves the feet");
  assert.ok(Math.abs(bodyYawDegrees(m) - 30) < 1e-6);
  m.yaw = (100 * Math.PI) / 180;
  for (let i = 0; i < 60; i++) stepFeet(m, false, 1 / 60);
  assert.ok(Math.abs(bodyYawDegrees(m)) <= 45.001, "twist stays within the limit");
  assert.ok(m.feetYaw > 0.5, "the feet followed");
  stepFeet(m, true, 1);
  assert.ok(Math.abs(m.feetYaw - m.yaw) < 1e-6, "moving points the feet where the player looks");
});

test("attacks, reloads and gestures are found by weapon set and stance", async () => {
  const { findAction } = await import("../src/viewer/playLogic.ts");
  const names = new Map([
    ["attackstand_primary", 1], ["attackcrouch_primary", 2], ["reloadstand_primary", 3], ["reloadstand_primary_loop", 4], ["reloadstand_primary_end", 5],
    ["reloadairwalk_primary", 6], ["gesture_primary_go", 7], ["gesture_melee_help", 8], ["attackstand_melee", 9],
  ]);
  assert.deepEqual(findAction(names, "attack", ["primary"], false, false), [1]);
  assert.deepEqual(findAction(names, "attack", ["primary"], true, false), [2]);
  assert.deepEqual(findAction(names, "attack", ["melee"], true, false), [9], "crouching falls back to standing");
  assert.deepEqual(findAction(names, "reload", ["primary"], false, false), [3, 4, 5], "start, loop and end");
  assert.deepEqual(findAction(names, "reload", ["primary"], false, true), [6]);
  assert.deepEqual(findAction(names, "reload", ["primary"], true, false), [3, 4, 5], "no crouch reload: the standing one");
  assert.deepEqual(findAction(names, "go", ["primary"], false, false), [7]);
  assert.deepEqual(findAction(names, "help", ["primary"], false, false), [8], "any weapon set will do");
  assert.deepEqual(findAction(names, "cheer", ["primary"], false, false), []);
});

test("melee attacks recognize class naming forms and never fall back to gunfire", async () => {
  const { findAction } = await import("../src/viewer/playLogic.ts");
  const names = new Map([
    ["attackstand_primary", 1], ["melee_swing", 2], ["melee_crouch_swing", 3],
    ["melee_allclass_swing", 4], ["melee_allclass_crouch_swing", 5],
  ]);
  assert.deepEqual(findAction(names, "attack", ["melee"], false, false), [2]);
  assert.deepEqual(findAction(names, "attack", ["melee"], true, false), [3]);
  assert.deepEqual(findAction(names, "attack", ["melee_allclass", "melee"], false, false), [4]);
  assert.deepEqual(findAction(names, "attack", ["melee_allclass", "melee"], true, false), [5]);
  assert.deepEqual(findAction(names, "attack", ["melee"], false, true), [2]);
  assert.deepEqual(findAction(new Map([["attackstand_primary", 1]]), "attack", ["melee"], false, false), []);
  assert.deepEqual(findAction(new Map([["attack_stand_melee", 6], ["attack_crouch_melee", 7]]), "attack", ["melee"], true, false), [7]);
  assert.deepEqual(findAction(new Map([["attackstand_melee_l", 8], ["attackstand_melee_r", 9]]), "attack", ["melee"], false, false), [8]);
});

test("secondary states select TF2 deployed and transition animations for the held primary only", async () => {
  const { secondaryMode, findDeployedSequence, findMinigunTransition, findScopedAttack } = await import("../src/viewer/playLogic.ts");
  assert.equal(secondaryMode("heavy", "primary", ["primary"]), "minigun");
  assert.equal(secondaryMode("sniper", "primary", ["primary"]), "scope");
  assert.equal(secondaryMode("sniper", "primary", ["primary_alt", "primary"]), null, "Bows must not scope");
  assert.equal(secondaryMode("heavy", "melee", ["melee"]), null);
  const names = new Map([["stand_deployed_primary", 1], ["crouch_deployed_primary", 2], ["primary_deployed_movement", 3],
    ["deployed_crouch_walk_primary", 4], ["attackstand_primary_spoolup", 5], ["attackstand_primary_spooldown", 6],
    ["attackstand_primary_deployed_fire", 7], ["attackcrouch_primary_deployed", 8]]);
  assert.equal(findDeployedSequence(names, "stand"), 1);
  assert.equal(findDeployedSequence(names, "run"), 3);
  assert.equal(findDeployedSequence(names, "crouch_walk"), 4);
  assert.equal(findMinigunTransition(names, true, true), 5);
  assert.equal(findMinigunTransition(names, false, false), 6);
  assert.deepEqual(findScopedAttack(names, false), [7]);
  assert.deepEqual(findScopedAttack(names, true), [8]);
});

test("reloads find modern and mixed TF2 class naming schemes", async () => {
  const {findAction}=await import('../src/viewer/playLogic.ts');
  const scout=new Map([['primary_reload_start',1],['primary_reload_loop',2],['primary_reload_end',3],['primary_crouch_reload_start',4],['primary_crouch_reload_loop',5],['primary_crouch_reload_end',6]]);
  assert.deepEqual(findAction(scout,'reload',['primary'],false,false),[1,2,3]);
  assert.deepEqual(findAction(scout,'reload',['primary'],true,false),[4,5,6]);
  const engineer=new Map([['reloadstand_primary',7],['a_primary_reload_loop',8],['primary_reload_end',9]]);
  assert.deepEqual(findAction(engineer,'reload',['primary'],false,false),[7,8,9]);
  const heavy=new Map([['secondary_reload',10],['secondary_reload_loop',11],['a_secondary_reload_end',12]]);
  assert.deepEqual(findAction(heavy,'reload',['secondary'],false,false),[10,11,12]);
});


test("Huntsman deployed sequences use ITEM2 and Medi Gun has dedicated healing transitions",async()=>{
  const {findDeployedSequence,findHealingTransition}=await import("../src/viewer/playLogic.ts");
  const names=new Map([["stand_deployed_item2",1],["item2_deployed_movement",2],["crouch_walk_item2_deployed",3],["attackstand_secondary_prefire",4],["layer_attackstand_secondary_postfire",5],["attackcrouch_secondary_prefire",6]]);
  assert.equal(findDeployedSequence(names,"stand","item2"),1);assert.equal(findDeployedSequence(names,"run","item2"),2);
  assert.equal(findDeployedSequence(names,"crouch_walk","item2"),3);
  assert.equal(findHealingTransition(names,true,false),4);assert.equal(findHealingTransition(names,false,false),5);assert.equal(findHealingTransition(names,true,true),6);
});

test("the Huntsman's attack gesture is its ITEM2 fire sequence, and it has no reload gesture of its own to add", async () => {
  const { findAction } = await import("../src/viewer/playLogic.ts");
  const names = new Map([["attackstand_primary", 1], ["item2_fire", 2], ["item2_crouch_fire", 3], ["item2_reload", 4]]);
  assert.deepEqual(findAction(names, "attack", ["ITEM2"], false, false), [2]);
  assert.deepEqual(findAction(names, "attack", ["ITEM2"], true, false), [3]);
  assert.deepEqual(findAction(names, "attack", ["primary"], false, false), [1]);
});

test("an item that rewrites the attack activity plays the sequence of the new one, the team's own when the model has one for each", async () => {
  const { findReplacedAttack } = await import("../src/viewer/playLogic.ts");
  const names = new Map([["item1_buglecall_red", 1], ["item1_buglecall_blue", 2], ["throw_fire", 3]]);
  const acts = new Map([["ACT_MP_ATTACK_STAND_ITEM1_SECONDARY", [1, 2]], ["ACT_MP_THROW", [3]]]);
  // a Buff Banner: the melee set's secondary-fire attack becomes the bugle call; a crouching one falls back to the standing entry
  const banner = { ACT_MP_ATTACK_STAND_MELEE_SECONDARY: "ACT_MP_ATTACK_STAND_ITEM1_SECONDARY", ACT_MP_ATTACK_CROUCH_MELEE_SECONDARY: "ACT_MP_ATTACK_STAND_ITEM1_SECONDARY" };
  assert.equal(findReplacedAttack(acts, names, banner, ["melee", "secondary"], false, false, 0), 1);
  assert.equal(findReplacedAttack(acts, names, banner, ["melee", "secondary"], false, false, 1), 2);
  assert.equal(findReplacedAttack(acts, names, banner, ["melee", "secondary"], true, false, 0), 1);
  // a jar with the melee_allclass animation set throws
  assert.equal(findReplacedAttack(acts, names, { ACT_MP_ATTACK_STAND_MELEE_ALLCLASS: "ACT_MP_THROW" }, ["melee_allclass", "secondary"], false, false, 0), 3);
  // nothing rewritten, or another set: the usual sequence is looked up by name
  assert.equal(findReplacedAttack(acts, names, undefined, ["melee"], false, false, 0), null);
  assert.equal(findReplacedAttack(acts, names, banner, ["primary"], false, false, 0), null);
});
