/**
 * The Spy's disguise mask (C_TFPlayer::GetSkin, c_tf_player.cpp): while he is disguised, his spyMask body group is on and his skin is the
 * team's plus 4 + 2 * (class - 1), the classes in the game's order (TF_CLASS_SCOUT is 1 ... TF_CLASS_ENGINEER is 9).
 */
export const SPY_MASKS = ["scout", "sniper", "soldier", "demoman", "medic", "heavy", "pyro", "spy", "engineer"] as const;

/** The skin family past the team's that puts a class's face on the mask, or null for none. */
export function spyMaskFamily(gameClass: string | null | undefined): number | null {
  const i = SPY_MASKS.indexOf((gameClass ?? "") as (typeof SPY_MASKS)[number]);
  return i < 0 ? null : 4 + i * 2;
}
