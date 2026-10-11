import { BODY_GROUP_DATA } from "./bodyGroupData";
import { defaultRegionsFor } from "./bodyRegions";

export type BodyClass = keyof typeof BODY_GROUP_DATA;
export interface BodyGroup { readonly id: string; readonly label: string; readonly category: string; readonly bit?: number; readonly material?: string }
export const bodyGroups = (cls: BodyClass): readonly BodyGroup[] => BODY_GROUP_DATA[cls];
export function bodyClass(modelPath: string): BodyClass | null {
  const match = modelPath.replace(/\\/g, "/").toLowerCase().match(/models\/player\/(scout|soldier|pyro|demo|demoman|engineer|heavy|hvyweapon|medic|sniper|spy)\.mdl$/);
  if (!match) return null;
  return (match[1] === "hvyweapon" ? "heavy" : match[1] === "demoman" ? "demo" : match[1]) as BodyClass;
}
export function hiddenBodyBits(cls: BodyClass, shown: ReadonlySet<string>): number {
  if (shown.has("*")) return 0;
  return bodyGroups(cls).reduce((bits, g) => bits | (g.bit !== undefined && !shown.has(g.id) ? 1 << g.bit : 0), 0);
}
export function materialBodyGroup(path: string): string | null {
  const name = path.toLowerCase().split("/").pop() ?? "";
  if (/eyeball/.test(name)) return "head";
  if (/_head_|mask_spy|smiley/.test(name)) return "head";
  if (/medic_backpack/.test(name)) return "backpack";
  if (/sniper_lens/.test(name)) return "glasses";
  if (/engineer_mech_hand/.test(name)) return "rightarm";
  if (/c_arrow/.test(name)) return "quiver";
  if (/medals/.test(name)) return "body";
  return null;
}
export function usesBodyAtlas(path: string): boolean {
  return /models\/player\/(?:scout|soldier|pyro|demo|engineer|hvyweapon|medic|sniper|spy)\/(?:scout|soldier|pyro|demoman|engineer|hvyweapon|medic|sniper|spy)_(?:red|blue|blu)(?:_sheen)?\.vmt$/i.test(path);
}
/** Migrate the old anatomical regions, also preserving cosmetic inspection's familiar isolation. */
export function legacyBodyGroups(cls: BodyClass, regions: Iterable<string>): string[] {
  const names = [...regions];
  const categories = new Set<string>();
  for (const name of names) {
    if (/head/.test(name)) categories.add("head");
    if (/neck|spine|pelvis|shoulder/.test(name)) categories.add("torso");
    if (/upperArm|forearm/.test(name)) categories.add("arms");
    if (/hand/.test(name)) categories.add("hands");
    if (/thigh|shin/.test(name)) categories.add("legs");
    if (/foot/.test(name)) categories.add("feet");
  }
  return bodyGroups(cls).filter(g => categories.has(g.category)).map(g => g.id);
}
export function defaultBodyGroupsFor(cls: string, equipRegions: string[]): string[] {
  const key = cls === "demoman" ? "demo" : cls;
  if (!(key in BODY_GROUP_DATA)) return [];
  const regions = defaultRegionsFor(equipRegions);
  // Neck geometry lives on the body sheet. Hats should isolate head groups, whereas shirts must hide heads.
  if (regions.includes("head") && !regions.some(r => /spine|pelvis|upperArm|forearm/.test(r))) {
    return bodyGroups(key as BodyClass).filter(g => g.category === "head").map(g => g.id);
  }
  return legacyBodyGroups(key as BodyClass, regions);
}
