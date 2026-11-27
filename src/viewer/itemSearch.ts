import type { ItemInfo } from "./payload";

/**
 * Whether an item answers a search (lower case): its name, its internal name, its item type ("Cosmetic Robot") or its description. Every word
 * of the search has to be found in one of them ("robot pet" finds the RoBro 3000).
 */
export function itemMatches(item: ItemInfo, query: string): boolean {
  const text = [item.displayName, item.name, item.typeName ?? "", item.description ?? ""].join("\n").toLowerCase();
  return query.split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}
