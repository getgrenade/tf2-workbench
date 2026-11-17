import { itemUsableBy, slotForClass, type ItemInfo } from "./payload";

/**
 * The weapon a class plays a sequence with, by the sequence's name: the animation set a weapon uses (its `anim_slot`, else its loadout
 * slot) is the end of the names of the sequences it plays (stand_PRIMARY, run_MELEE_ALLCLASS, crouch_ITEM1, competitive_winnerstate_
 * idle_SECONDARY). So stand_MELEE_ALLCLASS is played with an all-class melee (a Frying Pan) and not the class's own melee, whose set is
 * MELEE. The class's stock weapon wins among those of the set, else the oldest. Null for sequences of no weapon (taunts, idles).
 */
export function weaponForSequence(weapons: readonly ItemInfo[], sequence: string, gameClass: string): ItemInfo | null {
  const name = sequence.toLowerCase();
  if (/^(layer_)?taunt/.test(name)) return null;
  let best: { w: ItemInfo; len: number } | null = null;
  for (const w of weapons) {
    if (w.slot === "taunt" || w.workshop || !itemUsableBy(w, gameClass)) continue;
    const set = animationSets(w, gameClass).find((x) => name.endsWith(`_${x}`) || name.startsWith(`${x}_`));
    if (!set) continue;
    // the longest set the name ends with (melee_allclass over melee), then the stock weapon, then the oldest
    const better = !best || set.length > best.len
      || (set.length === best.len && (w.baseItem && !best.w.baseItem || (w.baseItem === best.w.baseItem && w.id < best.w.id)));
    if (better) best = { w, len: set.length };
  }
  return best?.w ?? null;
}

/**
 * The animation sets a weapon plays, as weaponIdleSequences has them: its `anim_slot` (melee_allclass, item1, ...), else its slot for
 * the class; the Spy's sapper (a `building` item) plays SAPPER, the Engineer's destruction PDA (`pda2`) PDA.
 */
export function animationSets(w: ItemInfo, gameClass: string): string[] {
  const anim = w.animSlot?.toLowerCase();
  if (anim && anim !== "force_not_used") return [anim];
  const slot = slotForClass(w, gameClass).toLowerCase();
  return slot === "building" ? [slot, "sapper"] : slot === "pda2" ? [slot, "pda"] : [slot];
}
