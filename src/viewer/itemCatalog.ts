import { listItems } from "../api";
import { parseItems, type ItemDb } from "./payload";

let loading: Promise<ItemDb> | null = null;

/** Forgets the loaded catalog and reads it again (after the workshop zips changed). */
export function reloadItemDb(): Promise<ItemDb> {
  loading = null;
  return loadItemDb();
}

/** The items catalog (cosmetics, weapons, paints), loaded once and shared by every browser. Retries after a failure. */
export function loadItemDb(): Promise<ItemDb> {
  loading ??= listItems()
    .then(parseItems)
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
