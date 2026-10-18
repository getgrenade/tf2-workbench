import test from "node:test";
import assert from "node:assert/strict";
import { cigaretteEffects, CONDITION_KEYS, NO_CONDITIONS, anyCondition, conditionParticles, materialEffects, parseConditions, uberMaterialPath } from "../../src/viewer/conditions";
import { evaluateMaterialVars, modulationColor, type ProxyDef } from "../../src/viewer/proxies";
import { ConditionParticles, type ConditionLane } from "../../src/viewer/particles/conditionLanes";
import { SourceMaterials } from "../../src/viewer/sourceMaterials";

const proxy = (name: string, params: Record<string, string>): ProxyDef => ({ name, params });

test("conditions are parsed strictly and say what they change", () => {
  assert.deepEqual(parseConditions(null), NO_CONDITIONS);
  assert.deepEqual(parseConditions({ uber: true, urine: "yes", nonsense: true }), { ...NO_CONDITIONS, uber: true });
  assert.equal(anyCondition(NO_CONDITIONS), false);
  assert.equal(anyCondition({ ...NO_CONDITIONS, crit: true }), true);
  assert.equal(CONDITION_KEYS.length, 7);
  assert.equal(materialEffects(NO_CONDITIONS, 0), undefined);
  assert.deepEqual(materialEffects({ ...NO_CONDITIONS, urine: true }, 0)!.yellow, [6, 9, 2]);
  assert.deepEqual(materialEffects({ ...NO_CONDITIONS, urine: true }, 1)!.yellow, [7, 5, 1]);
  assert.deepEqual(materialEffects({ ...NO_CONDITIONS, crit: true }, 1)!.glow, [5, 20, 80]);
  assert.equal(uberMaterialPath(0), "models/effects/invulnfx_red");
  assert.equal(uberMaterialPath(1), "models/effects/invulnfx_blue");
  const wet = { ...NO_CONDITIONS, urine: true, milk: true, burning: true };
  assert.deepEqual(conditionParticles(wet, 0).map((p) => p.system), ["peejar_drips", "peejar_drips_milk", "burningplayer_red"]);
  assert.deepEqual(conditionParticles({ ...NO_CONDITIONS, burning: true }, 1).map((p) => p.system), ["burningplayer_blue"]);
  assert.deepEqual(conditionParticles({ ...NO_CONDITIONS, phase: true }, 0).map((p) => p.system), ["warp_version"]);
  assert.deepEqual(conditionParticles({ ...NO_CONDITIONS, uber: true }, 0), []);
  // a crit boost sparks around the weapon, not the body
  assert.deepEqual(conditionParticles({ ...NO_CONDITIONS, crit: true }, 1), [{ system: "critgun_weaponmodel_blu", weapon: true }]);
  assert.ok(conditionParticles(wet, 0).every((p) => !p.weapon));
  // the Spy's cigarette smokes at the cig_smoke attachment of his model: not a lane, but an effect of his own (it runs on the fallback simulator too)
  assert.deepEqual(conditionParticles({ ...NO_CONDITIONS, cig: true }, 0), []);
  assert.deepEqual(cigaretteEffects({ ...NO_CONDITIONS, cig: true }).map((p) => [p.system, p.attachment]), [["cig_smoke", "cig_smoke"], ["cig_burn", "cig_smoke"]]);
  assert.deepEqual(cigaretteEffects(NO_CONDITIONS), []);
});

test("a player skin turns yellow through YellowLevel -> $yellow -> $color2, and only with the condition", () => {
  const params = { "$yellow": "0" };
  const proxies = [proxy("yellowlevel", { resultvar: "$yellow" }), proxy("equals", { srcvar1: "$yellow", resultvar: "$color2" })];
  assert.deepEqual(modulationColor(evaluateMaterialVars(params, proxies, { paint: null })), [1, 1, 1]);
  const wet = evaluateMaterialVars(params, proxies, { paint: null, fx: { yellow: [6, 9, 2] } });
  assert.deepEqual(wet["$color2"], [6, 9, 2]);
  assert.deepEqual(modulationColor(wet), [6, 9, 2]);
});

test("a crit boosted weapon glows: ModelGlowColor feeds the tint and the self-illumination, times the Jarate yellow", () => {
  const proxies = [
    proxy("modelglowcolor", { resultvar: "$glowcolor" }),
    proxy("equals", { srcvar1: "$glowcolor", resultvar: "$selfillumtint" }),
    proxy("equals", { srcvar1: "$glowcolor", resultvar: "$color2" }),
    proxy("yellowlevel", { resultvar: "$yellow" }),
    proxy("multiply", { srcvar1: "$color2", srcvar2: "$yellow", resultvar: "$color2" }),
  ];
  const params = { "$glowcolor": "1", "$yellow": "0" };
  assert.deepEqual(evaluateMaterialVars(params, proxies, { paint: null })["$color2"], [1, 1, 1]);
  const glowing = evaluateMaterialVars(params, proxies, { paint: null, fx: { glow: [80, 8, 5] } });
  assert.deepEqual(glowing["$selfillumtint"], [80, 8, 5]);
  assert.deepEqual(glowing["$color2"], [80, 8, 5]);
  const both = evaluateMaterialVars(params, proxies, { paint: null, fx: { glow: [80, 8, 5], yellow: [6, 9, 2] } });
  assert.deepEqual(both["$color2"], [480, 72, 10]);
});

test("InvulnLevel is 1 on the Ubercharge material and 0 on everything else; BurnLevel follows the burn", () => {
  const level = [proxy("invulnlevel", { resultvar: "$invulnlevel" }), proxy("burnlevel", { resultvar: "$detailblendfactor" })];
  const idle = evaluateMaterialVars({ "$invulnlevel": "0", "$detailblendfactor": "0" }, level, { paint: null });
  assert.equal(idle["$invulnlevel"][0], 0);
  assert.equal(idle["$detailblendfactor"][0], 0);
  const uber = evaluateMaterialVars({ "$invulnlevel": "0", "$detailblendfactor": "0" }, level, { paint: null, fx: { invuln: 1, burn: 1 } });
  assert.equal(uber["$invulnlevel"][0], 1);
  assert.equal(uber["$detailblendfactor"][0], 1);
});

test("materials for a condition are shared per state, separate from the plain ones", () => {
  const mats = new SourceMaterials(1, {});
  const plain = mats.material(null), wet = mats.material(null, undefined, null, { yellow: [6, 9, 2] });
  assert.notEqual(plain, wet);
  assert.equal(mats.material(null, undefined, null, { yellow: [6, 9, 2] }), wet);
  assert.equal(mats.material(null), plain);
  assert.notEqual(mats.material(null, undefined, null, { yellow: [7, 5, 1] }), wet);
});

/** A stand-in for a native helper: it only remembers who it was lent to. */
function fakeLanes() {
  const made: any[] = [];
  const make = async (system: string) => {
    const lane = { system, free: true, target: null as any, binds: 0, releases: 0, abandoned: 0,
      bind(t: any) { this.free = false; this.target = t; this.binds++; }, release() { this.free = true; this.releases++; }, abandon() { this.free = true; this.abandoned++; },
      step() {}, dispose() {} };
    made.push(lane);
    return lane as unknown as ConditionLane;
  };
  return { made, pool: new ConditionParticles(make, (e) => { throw e; }) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const actorOf = (n: number) => ({ name: `actor${n}` }) as any;
const want = (system = "peejar_drips", key = "models/player/scout.mdl") => ({ system, key, target: () => ({ actor: null as any, cp: () => null as any, boxes: () => [] }) });

test("a crowd soaked at once uses a few lanes, not one helper each", async () => {
  const { made, pool } = fakeLanes();
  const actors = Array.from({ length: 12 }, (_, i) => actorOf(i));
  for (const a of actors) pool.sync(a, [want()]);
  await settle();
  assert.equal(made.length, ConditionParticles.MAX_LANES, "no more helpers than the limit");
  assert.equal(pool.busy, ConditionParticles.MAX_LANES);
  assert.equal(made.reduce((n, l) => n + l.binds, 0), ConditionParticles.MAX_LANES);
});

test("a lane is lent again once its character leaves the condition, and a warmed lane is used before a new one is built", async () => {
  const { made, pool } = fakeLanes();
  pool.warm("peejar_drips", 2);
  await settle();
  assert.equal(made.length, 2);
  const [a, b, c] = [actorOf(1), actorOf(2), actorOf(3)];
  pool.sync(a, [want()]); pool.sync(b, [want()]);
  await settle();
  assert.equal(made.length, 2, "the warmed lanes were lent");
  pool.sync(a, []); // a dries off
  pool.sync(c, [want()]);
  await settle();
  assert.equal(made.length, 2, "a's lane went to c");
  assert.equal(made.reduce((n, l) => n + l.releases, 0), 1);
  assert.equal(made.reduce((n, l) => n + l.binds, 0), 3);
});

test("a changed weapon moves the particles to a lane of the new target, and a character that is removed lets go", async () => {
  const { made, pool } = fakeLanes();
  const a = actorOf(1);
  pool.sync(a, [want("critgun_weaponmodel_red", "models/weapons/w_models/w_a.mdl")]);
  await settle();
  pool.sync(a, [want("critgun_weaponmodel_red", "models/weapons/w_models/w_b.mdl")]);
  await settle();
  assert.equal(made.reduce((n, l) => n + l.binds, 0), 2);
  assert.equal(made.reduce((n, l) => n + l.releases, 0), 1, "the old target was let go");
  pool.sync(a, [want("critgun_weaponmodel_red", "models/weapons/w_models/w_b.mdl")]);
  assert.equal(made.reduce((n, l) => n + l.binds, 0), 2, "the same target does not restart");
  pool.forget(a);
  assert.equal(made.reduce((n, l) => n + l.abandoned, 0), 1);
});

test("a character that stops wanting a lane before it is built does not get it", async () => {
  const { made, pool } = fakeLanes();
  const a = actorOf(1);
  pool.sync(a, [want()]);
  pool.sync(a, []);
  await settle();
  assert.equal(made.length, 1);
  assert.equal(made[0].binds, 0, "built, but free for the next one");
  assert.equal(pool.busy, 0);
});

import { parseTextureFrames } from "../../src/viewer/sourceMaterials";

test("a burning character gets BurnLevel 1, and the frames of the fire layer are read from their block", () => {
  assert.equal(materialEffects({ ...NO_CONDITIONS, burning: true }, 0)!.burn, 1);
  assert.equal(materialEffects(NO_CONDITIONS, 0), undefined);
  const buffer = new ArrayBuffer(12 + 3 * 2 * 2 * 4);
  new DataView(buffer).setUint32(0, 2, true); new DataView(buffer).setUint32(4, 2, true); new DataView(buffer).setUint32(8, 3, true);
  new Uint8Array(buffer, 12 + 16, 4).set([9, 8, 7, 6]);
  const frames = parseTextureFrames(buffer);
  assert.equal(frames.length, 3);
  assert.deepEqual([frames[1].width, frames[1].height], [2, 2]);
  assert.deepEqual([...frames[1].rgba.slice(0, 4)], [9, 8, 7, 6]);
  assert.deepEqual(parseTextureFrames(new ArrayBuffer(4)), [], "a truncated block yields nothing");
});

test("only a burning character's skin material carries the fire layer, driven by BurnLevel", () => {
  const skin: any = {
    path: "materials/models/player/pyro/pyro_red.vmt", shader: "vertexlitgeneric", textures: {}, errors: [],
    params: { "$detail": "effects/tiledfire/fireLayeredSlowTiled512.vtf", "$detailscale": "5", "$detailblendfactor": "0", "$detailblendmode": "6" },
    proxies: [{ name: "burnlevel", params: { resultvar: "$detailblendfactor" } }],
  };
  const mats = new SourceMaterials(1, {});
  const plain = mats.material(skin), burning = mats.material(skin, undefined, null, { burn: 1 });
  assert.equal(plain.uniforms.uDetailBlend.value, 0);
  assert.equal(burning.uniforms.uDetailBlend.value, 1);
  assert.equal(burning.uniforms.uDetailScale.value, 5);
  assert.equal(plain.uniforms.uHasDetail.value, false);
  // other blend modes are left alone
  const other = mats.material({ ...skin, path: "x", params: { ...skin.params, "$detailblendmode": "0" } }, undefined, null, { burn: 1 });
  assert.equal(other.uniforms.uDetailBlend.value, 0);
});
