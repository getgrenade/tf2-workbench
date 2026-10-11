/** Keep browser thumbnails and on-demand camera artwork in separate caches. */
export class InventoryIconCache {
  private readonly thumbnails = new Map<string, Promise<string | null>>();
  private readonly overlays = new Map<string, Promise<string | null>>();
  constructor(private readonly decode: (image: string) => Promise<string | null>) {}
  small(image: string): Promise<string | null> {
    let result = this.thumbnails.get(image);
    if (!result) { result = this.decode(image); this.thumbnails.set(image, result); }
    return result;
  }
  overlay(image: string): Promise<string | null> {
    if (image.endsWith("_large")) return this.small(image);
    let result = this.overlays.get(image);
    if (!result) {
      // Source's item panel uses this material suffix for IMAGETYPE_LARGE.
      result = this.decode(`${image}_large`).then(url => url ?? this.small(image));
      this.overlays.set(image, result);
    }
    return result;
  }
  purge(match: (image: string) => boolean) {
    for (const cache of [this.thumbnails, this.overlays]) for (const key of cache.keys()) if (match(key)) cache.delete(key);
  }
}
