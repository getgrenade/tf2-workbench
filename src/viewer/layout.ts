/** Where a character stands in the row: slot 0 at the origin, then +1, -1, +2, -2, ... times the spacing along x. */
export function slotOffset(slot: number, spacing: number): number {
  const n = Math.ceil(slot / 2);
  return n === 0 ? 0 : (slot % 2 === 1 ? n : -n) * spacing;
}

/** The first slot number not in `used` (a removed character's place is taken by the next one added). */
export function freeSlot(used: Iterable<number>): number {
  const taken = new Set(used);
  let slot = 0;
  while (taken.has(slot)) slot++;
  return slot;
}
