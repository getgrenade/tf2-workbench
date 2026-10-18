import { listItems } from "../api";
import { parseItems, type ItemDb, type ItemInfo } from "./payload";
import { applyWorkshopStyles } from "./workshopStyles";

let loading: Promise<ItemDb> | null = null;
/** The workshop cosmetics as their zips have them, before their styles are put together (for the Workshop styles window). */
let rawWorkshop: ItemInfo[] = [];
export const workshopItemsAsZipped = () => rawWorkshop;

/** Forgets the loaded catalog and reads it again (after the workshop zips changed). */
export function reloadItemDb(): Promise<ItemDb> {
  loading = null;
  return loadItemDb();
}

/** The items catalog (cosmetics, weapons, paints), loaded once and shared by every browser. Retries after a failure. */
export function loadItemDb(): Promise<ItemDb> {
  loading ??= listItems()
    .then(parseItems)
    .then((db) => {
      rawWorkshop = db.items.filter((i) => i.workshop).map((i) => ({ ...i, styles: [...i.styles] }));
      // the styles of workshop items (their own zips) go onto the items they are styles of
      return applyWorkshopStyles(db);
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
