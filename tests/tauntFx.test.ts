// Run with: npm test -- tauntFx
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseParticleEvent, planTauntFx, runningParticles, sequenceClock, tauntSoundNames } from "../src/viewer/tauntFx.ts";
import { Playback } from "../src/viewer/animator.ts";
import type { ClipData, ItemInfo } from "../src/viewer/payload.ts";

const item = (over: Partial<ItemInfo>): ItemInfo => ({ id: 1, name: "x", displayName: "x", slot: "taunt", classes: [], perClass: {}, model: null, image: null, bodygroups: {}, equipRegions: [], paintable: false, skinOverride: false, medal: false, quality: "unique", tauntScenes: {}, tauntPropScenes: {}, workshop: false, poseParams: {}, styles: [], ...over } as ItemInfo);

test("a particle event names the system, how it is attached and where", () => {
  assert.deepEqual(parseParticleEvent("taunt_yeti_fistslam start_at_attachment effect_hand_R", 5.3), { start: 5.3, system: "taunt_yeti_fistslam", attachment: "effect_hand_R", follow: false });
  assert.deepEqual(parseParticleEvent("taunt_headbutt_impact follow_attachment head", 1), { start: 1, system: "taunt_headbutt_impact", attachment: "head", follow: true });
  // an origin type leaves out the attachment even when one is written (taunt_ENGINEER_SPARKS start_at_origin back_lower)
  assert.deepEqual(parseParticleEvent("taunt_ENGINEER_SPARKS start_at_origin back_lower", 0), { start: 0, system: "taunt_ENGINEER_SPARKS", attachment: null, follow: false });
  // several spaces between the parts, as some models have them
  assert.equal(parseParticleEvent("taunt_pyro_gasblast_match       follow_attachment weapon_bone_1", 0)?.attachment, "weapon_bone_1");
  assert.equal(parseParticleEvent("lonely_system", 0), null);
  assert.equal(parseParticleEvent("x follow_attachment", 0), null);
  assert.equal(parseParticleEvent("x somewhere head", 0), null);
});

test("the sequence's sound and particle events go into the plan; the rest are not effects", () => {
  const plan = planTauntFx([
    { time: 0.4, name: "AE_CL_PLAYSOUND", options: "Scout.TauntBat" },
    { time: 0.5, name: "AE_CL_PLAYSOUND", options: "Nothing.Here" },
    { time: 0.0, name: "AE_WPN_HIDE", options: "" },
    { time: 1.8, name: "AE_CL_CREATE_PARTICLE_EFFECT", options: "taunt_headbutt_impact follow_attachment head" },
  ], { "scout.tauntbat": { name: "Scout.TauntBat", waves: ["player/bat.wav"] } }, null, [], false);
  assert.deepEqual(plan.sounds, [{ start: 0.4, name: "Scout.TauntBat", waves: ["player/bat.wav"], looping: false }]);
  assert.equal(plan.particles.length, 1);
});

test("the Shred Alert plays its riff and lightning when it starts, at the feet where it started", () => {
  const shred = item({ tauntAttack: "TAUNTATK_ALLCLASS_GUITAR_RIFF", tauntAttackTime: 0, tauntScenes: { scout: "taunt_brutalLegend" } });
  assert.deepEqual(tauntSoundNames(shred, []), ["Taunt.GuitarRiff"]);
  const plan = planTauntFx([], { "taunt.guitarriff": { name: "Taunt.GuitarRiff", waves: ["player/brutal_legend_taunt.wav"] } }, shred, [], true);
  assert.deepEqual(plan.sounds.map((s) => [s.name, s.start]), [["Taunt.GuitarRiff", 0]]);
  assert.deepEqual(plan.particles, [{ start: 0, system: "bl_killtaunt", attachment: null, follow: false }]);
  // not taunting (the sequence is something else): none of the item's
  assert.deepEqual(planTauntFx([], { "taunt.guitarriff": { name: "Taunt.GuitarRiff", waves: ["a.wav"] } }, shred, [], false), { sounds: [], particles: [] });
});

test("a taunt's success sound loop and a worn item's taunt sound are heard while taunting", () => {
  const taunt = item({ tauntSounds: [{ name: "Taunt.Music", offset: 1.5, looping: true }] });
  const boombox = item({ slot: "misc", tauntSounds: [{ name: "scout.boombox", offset: 0, looping: false }] });
  assert.deepEqual(tauntSoundNames(taunt, [boombox]).sort(), ["Taunt.Music", "scout.boombox"]);
  const plan = planTauntFx([], { "taunt.music": { name: "Taunt.Music", waves: ["m.wav"] }, "scout.boombox": { name: "scout.boombox", waves: ["b.wav"] } }, taunt, [boombox], true);
  assert.deepEqual(plan.sounds.map((s) => [s.name, s.start, s.looping]), [["Taunt.Music", 1.5, true], ["scout.boombox", 0, false]]);
});

test("a particle system runs from its event on, and starts again each time the sequence does", () => {
  const plan = { sounds: [], particles: [{ start: 1, system: "a", attachment: null, follow: true }, { start: 2, system: "b", attachment: "head", follow: true }] };
  assert.deepEqual(runningParticles(plan, 0.5, 0).map((p) => p.system), []);
  assert.deepEqual(runningParticles(plan, 1.5, 0).map((p) => p.system), ["a"]);
  const later = runningParticles(plan, 2.5, 3);
  assert.deepEqual(later.map((p) => [p.system, p.key]), [["a", "3"], ["b", "3"]]);
});

test("the sequence clock counts the times a looping clip started over", () => {
  const pb = new Playback();
  pb.clip = { fps: 30, looping: false, frames: 31, numBones: 0, pos: new Float32Array(), quat: new Float32Array() } as ClipData;
  pb.time = 2.5; // two and a half seconds of a one second clip, played over and over
  const c = sequenceClock(pb);
  assert.equal(c.pass, 2);
  assert.ok(Math.abs(c.time - 0.5) < 1e-6);
});
