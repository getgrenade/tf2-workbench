import { test } from "node:test";
import assert from "node:assert/strict";
import { weaponForSequence } from "../src/viewer/sequenceWeapon.ts";
import type { ItemInfo } from "../src/viewer/payload.ts";

function weapon(id: number, name: string, slot: string, animSlot: string, classes: string[], baseItem = false): ItemInfo {
  return { id, displayName: name, slot, animSlot, classes, baseItem, model: `models/${name}.mdl`, perClass: {}, styles: [], classSlots: {}, workshop: false } as unknown as ItemInfo;
}

const weapons = [
  weapon(2, "Fire Axe", "melee", "", ["pyro"], true),
  weapon(264, "Frying Pan", "melee", "MELEE_ALLCLASS", ["pyro", "scout"]),
  weapon(1071, "Golden Frying Pan", "melee", "MELEE_ALLCLASS", ["pyro", "scout"]),
  weapon(21, "Flame Thrower", "primary", "", ["pyro"], true),
  weapon(740, "Scorch Shot", "secondary", "ITEM1", ["pyro"]),
  weapon(12, "Shotgun", "secondary", "", ["pyro", "soldier"], true),
  weapon(735, "Sapper", "building", "", ["spy"], true),
];

test("an all-class melee sequence is played with an all-class melee (the oldest), not the class's own melee", () => {
  assert.equal(weaponForSequence(weapons, "stand_MELEE_ALLCLASS", "pyro")?.displayName, "Frying Pan");
  assert.equal(weaponForSequence(weapons, "stand_MELEE", "pyro")?.displayName, "Fire Axe");
});

test("the class's stock weapon wins within a set, and an anim_slot set needs a weapon of it", () => {
  assert.equal(weaponForSequence(weapons, "run_PRIMARY", "pyro")?.displayName, "Flame Thrower");
  assert.equal(weaponForSequence(weapons, "stand_deployed_PRIMARY", "pyro")?.displayName, "Flame Thrower");
  assert.equal(weaponForSequence(weapons, "stand_SECONDARY", "pyro")?.displayName, "Shotgun");
  assert.equal(weaponForSequence(weapons, "stand_ITEM1", "pyro")?.displayName, "Scorch Shot");
  assert.equal(weaponForSequence(weapons, "stand_ITEM4", "pyro"), null);
});

test("the Spy's sapper plays SAPPER; taunts and idles hold nothing", () => {
  assert.equal(weaponForSequence(weapons, "stand_SAPPER", "spy")?.displayName, "Sapper");
  assert.equal(weaponForSequence(weapons, "taunt_primary_fire", "pyro"), null);
  assert.equal(weaponForSequence(weapons, "competitive_winnerstate_idle", "pyro"), null);
});
