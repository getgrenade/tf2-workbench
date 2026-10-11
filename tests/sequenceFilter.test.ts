// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { isJunkSequence } from "../src/viewer/sequenceFilter.ts";

test("the sequences of no use for showing a character are junk", () => {
  for (const name of ["a_SECONDARY2_reload_swim", "PRIMARY_reload", "MELEE_aimmatrix_idle", "gesture_wave", "g_Attack_Swim", "armslayer_melee_Swim_swing", "ragdoll", "ragdollspawn", "spell_arm_pose", "r_handposes", "r_armposes", "AttackSwim_PRIMARY", "Swim_primary", "user_ref", "test", "test_anim", "all", "AttackStand_PRIMARY", "AttackCrouch_SECONDARY2", "a_flinch_head", "A_FLINCH", "primary_placeSapper", "jumpland_Primary", "jumpland_Melee", "jumpland_Melee_allclass", "jumpland_loser", "jumpland_item1", "armslayer_melee_idle", "a_bodylayer_x", "BodyLayer", "Melee_swing", "Melee_Crouch_Swing", "Melee_allclass_Swing", "Melee_allclass_Crouch_Swing", "jumpland_ITEM1"]) assert.equal(isJunkSequence(name), true, name);
});

test("the ones that show a character are not", () => {
  for (const name of ["stand_PRIMARY", "run_MELEE", "taunt03", "Crouch_SECONDARY", "ref", "jump_float_melee", "layer_taunt03", "stand_MELEE_ALLCLASS", "Attack_Stand_MELEE", "latest_taunt", "airwalk_PRIMARY", "stand_MELEE", "run_MELEE", "Melee_idle"]) assert.equal(isJunkSequence(name), false, name);
});
