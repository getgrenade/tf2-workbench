import type { ItemInfo } from "./payload";

/**
 * Cosmetics made for the robots of Mann vs. Machine and never given to players: the robots' own armor and helmets (tw_scoutbot_armor,
 * tw_scoutbot_hat, ... in the schema, "Scoutbot Armor"), the lights of the gate bots ("MvM GateBot Light Scout"), the Deflector, the
 * Heavy robots' minigun, and the MvM copies of weapons ("Gloves of Running Urgently MvM", beside the real one). They are in the game's item list but can't be had in game, so the Cosmetics and Weapons lists leave them out
 * unless Settings say otherwise.
 */
export function isRobotOnlyItem(item: Pick<ItemInfo, "name">): boolean {
  return /^tw_[a-z]+bot_/i.test(item.name) || /^mvm gatebot/i.test(item.name) || /^deflector$/i.test(item.name) || / mvm$/i.test(item.name);
}
