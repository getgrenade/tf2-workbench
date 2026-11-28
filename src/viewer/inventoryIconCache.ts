/** The browsers' item icons, decoded once each. */
export class InventoryIconCache {
  private readonly thumbnails = new Map<string, Promise<string | null>>();
  constructor(private readonly decode: (image: string) => Promise<string | null>) {}
  small(image: string): Promise<string | null> {
    let result = this.thumbnails.get(image);
    if (!result) { result = this.decode(image); this.thumbnails.set(image, result); }
    return result;
  }
  purge(match: (image: string) => boolean) {
    for (const key of this.thumbnails.keys()) if (match(key)) this.thumbnails.delete(key);
  }
}
