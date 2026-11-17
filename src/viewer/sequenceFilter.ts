/**
 * Sequences of the player models that are of no use for showing a character: the aim matrices, the gestures, the reloads, the
 * ragdoll poses, the hand and arm pose layers, everything for swimming, the attacks (standing and crouching), the flinches, and the
 * jump landings, the arm slayer and body layers, placing a sapper, the melee swings, the Passtime ball throws (`PASSTIME_throw_...`, `throw_fire`), the grappling hook and steering layers, every kart sequence, the air-walk attacks, and the sequences that are only there for the game's own testing and reference (`user_ref`, `test...`, and the one called just `all`).
 * `all` is matched as a whole name, since it is part of many good ones (stand_MELEE_ALLCLASS).
 */
const JUNK = /aimmatrix|gesture|reload|ragdoll|attack_?swim|attackstand|attackcrouch|a_flinch|user_ref|placesapper|jumpland|armslayer|bodylayer|melee_(allclass_)?(crouch_)?swing|spell_arm_pose|r_handposes|r_armposes|swim|passtime_throw|throw_fire|a_grapple|a_steer|kart|attackairwalk|(^|_)test|^all$/i;

export function isJunkSequence(name: string): boolean {
  return JUNK.test(name);
}

/**
 * The weapon slot a sequence is played with, by its name (stand_PRIMARY, run_MELEE_ALLCLASS, crouch_SECONDARY, competitive_winnerstate_PDA):
 * primary, secondary, melee, pda or building; null for the ones played with no weapon in particular (taunts, the class's own idles).
 */
export function sequenceSlot(name: string): string | null {
  if (/^(layer_)?taunt/i.test(name)) return null;
  return /primary|secondary|melee|pda|building/i.exec(name)?.[0].toLowerCase() ?? null;
}
