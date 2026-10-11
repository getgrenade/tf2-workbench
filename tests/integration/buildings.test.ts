import test from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, buildingCls, buildingLabel, buildingOf, classPath, defaultBuildingSequence, isBuildingCls, type BuildingKind } from "../../src/viewer/buildings";
import { buildingWants, defaultFx, laneWants, readFx } from "../../src/viewer/buildingFx";
import { parseScene } from "../../src/viewer/scene";

test("a building's cls is its model, and a class stays a bare name", () => {
  assert.equal(isBuildingCls("soldier"), false);
  assert.equal(classPath("soldier"), "models/player/soldier.mdl");
  assert.equal(classPath("buildables/sentry2"), "models/buildables/sentry2.mdl");
  assert.equal(buildingCls("sentry", 3), "buildables/sentry3");
  assert.equal(buildingCls("sentry", 2, "building"), "buildables/sentry2_heavy");
  assert.equal(buildingCls("dispenser", 1), "buildables/dispenser_light");
  assert.equal(buildingCls("dispenser", 3, "building"), "buildables/dispenser_lvl3");
  // the finished teleporter is the model with the spin and the arrow; the one that is being built has the build animation
  assert.equal(classPath(buildingCls("teleporter", 2, "finished", "exit")), "models/buildables/teleporter_light.mdl");
  assert.equal(classPath(buildingCls("teleporter", 1, "building")), "models/buildables/teleporter.mdl");
});

test("every model of the table reads back as the building, level and stage it was made from", () => {
  for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
    for (let level = 1; level <= BUILDINGS[kind].levels.length; level++) {
      for (const stage of ["finished", "building"] as const) {
        for (const mode of ["entrance", "exit"] as const) {
          const info = buildingOf(buildingCls(kind, level, stage, mode));
          assert.ok(info, `${kind} ${level} ${stage}`);
          assert.equal(info.kind, kind);
          assert.equal(info.level, level);
          assert.equal(info.stage, stage);
          if (kind === "teleporter") assert.equal(info.mode, mode);
        }
      }
    }
  }
  assert.equal(buildingOf("soldier"), null);
  assert.equal(buildingOf("buildables/sapper_placed"), null);
  assert.equal(buildingLabel(buildingOf("buildables/sentry2")!), "Sentry L2");
  assert.equal(buildingLabel(buildingOf(buildingCls("teleporter", 3, "finished", "exit"))!), "Teleporter exit L3");
});

test("a building starts on a sequence of its model, never the bind pose", () => {
  assert.equal(defaultBuildingSequence("buildables/sentry1"), "idle_off");
  assert.equal(defaultBuildingSequence("buildables/dispenser_lvl2_light"), "ref");
  assert.equal(defaultBuildingSequence(buildingCls("teleporter", 1)), "running");
  assert.equal(defaultBuildingSequence("buildables/dispenser"), "build");
  assert.equal(defaultBuildingSequence("buildables/dispenser_lvl3"), "upgrade");
  assert.equal(defaultBuildingSequence("buildables/sentry1_heavy"), "dummy");
  assert.equal(defaultBuildingSequence("buildables/sentry3_heavy"), "upgrade");
});

test("what a building runs follows the SDK's client classes", () => {
  const fx = { ...defaultFx(), damage: 2, firing: true, shield: true };
  const names = (cls: string, team: number, f = fx) => buildingWants(buildingOf(cls)!, f, team).map((w) => `${w.id}:${w.system}@${w.anchor}`);
  assert.deepEqual(names("buildables/sentry1", 0), ["damage:sentrydamage_2@build_point_0", "shield:turret_shield@origin", "muzzle:muzzle_sentry@muzzle"]);
  // level 3 smokes from its own attachment and fires from two muzzles in turn
  assert.deepEqual(names("buildables/sentry3", 1), [
    "damage:sentrydamage_2@sentrydamage", "shield:turret_shield@origin", "muzzleL:muzzle_sentry2@muzzle_l", "muzzleR:muzzle_sentry2@muzzle_r",
  ]);
  const r = buildingWants(buildingOf("buildables/sentry3")!, fx, 0).filter((w) => w.burst);
  assert.deepEqual(r.map((w) => w.burst), [{ every: 0.2, phase: 0 }, { every: 0.2, phase: 0.1 }]);
  assert.deepEqual(names(buildingCls("teleporter", 2, "finished", "exit"), 1, { ...defaultFx(), damage: 1 }), [
    "damage:tpdamage_1@origin", "charged:teleporter_blue_charged_level2@origin", "direction:teleporter_blue_exit_level2@origin",
    "armL:teleporter_arms_circle_blue@arm_attach_L", "armR:teleporter_arms_circle_blue@arm_attach_R",
  ]);
  assert.deepEqual(names(buildingCls("teleporter", 1), 0, { ...defaultFx(), active: false }), []);
  assert.deepEqual(names("buildables/dispenser_light", 0, { ...defaultFx(), healing: true, damage: 4 }), ["damage:dispenserdamage_4@origin", "heal:dispenser_heal_red@heal_origin"]);
  // nothing runs on a building that is still being built
  assert.deepEqual(names("buildables/sentry2_heavy", 0), []);
});

test("a want whose attachment the model lacks is left out, and the others anchor on theirs", () => {
  const actor = { particleBoneFrame: () => null } as never;
  const model = { attachments: [{ name: "muzzle", bone: 0, local: { clone() { return this; } } }], hitboxes: [] } as never;
  const wants = buildingWants(buildingOf("buildables/sentry1")!, { ...defaultFx(), firing: true, shield: true }, 0);
  assert.deepEqual(laneWants(actor, model, wants, () => []).map((w) => w.id), ["shield", "muzzle"]);
  const keys = laneWants(actor, model, wants, () => []).map((w) => w.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("a saved effect state is read back, and what is wrong takes the default", () => {
  const fx = { damage: 3, metal: 250, healing: true, firing: true, shield: false, active: false };
  assert.deepEqual(readFx(JSON.parse(JSON.stringify(fx))), fx);
  assert.deepEqual(readFx(null), defaultFx());
  assert.deepEqual(readFx({ damage: 9, metal: 9999, active: "x", firing: 1 }), { ...defaultFx(), metal: 400 });
});

test("a scene keeps a building's state", () => {
  const scene = {
    app: "tf2-workbench", version: 1, camera: { position: [0, 0, 1], target: [0, 0, 0] }, light: {}, pointLight: {}, shadow: {},
    entities: [{ cls: "buildables/dispenser_lvl2_light", team: 1, building: { damage: 2, metal: 40 }, placement: {}, loadout: [] }, { cls: "soldier", placement: {} }],
  };
  const parsed = parseScene(JSON.stringify(scene));
  assert.equal(parsed.entities[0].cls, "buildables/dispenser_lvl2_light");
  assert.deepEqual(parsed.entities[0].building, { ...defaultFx(), damage: 2, metal: 40 });
  assert.equal(parsed.entities[1].building, undefined);
});
