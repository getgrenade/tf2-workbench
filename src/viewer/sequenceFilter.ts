/**
 * Sequences of the player models that are of no use for showing a character: the aim matrices, the gestures, the reloads, the
 * ragdoll poses, the hand and arm pose layers, everything for swimming, the attacks (standing and crouching), the flinches, and the
 * jump landings, the arm slayer and body layers, placing a sapper, the melee swings, and the sequences that are only there for the game's own testing and reference (`user_ref`, `test...`, and the one called just `all`).
 * `all` is matched as a whole name, since it is part of many good ones (stand_MELEE_ALLCLASS).
 */
const JUNK = /aimmatrix|gesture|reload|ragdoll|attack_?swim|attackstand|attackcrouch|a_flinch|user_ref|placesapper|jumpland|armslayer|bodylayer|melee_(allclass_)?(crouch_)?swing|spell_arm_pose|r_handposes|r_armposes|swim|(^|_)test|^all$/i;

export function isJunkSequence(name: string): boolean {
  return JUNK.test(name);
}
