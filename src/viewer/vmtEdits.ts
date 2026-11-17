/**
 * Materials whose VMT was edited in the Textures panel: the text as typed, and the game's own material to go back to. The edits are drawn
 * as they are typed (see tab.ts); a text that does not parse leaves the last good one on the model.
 */
import type { MaterialData } from "./payload";

interface Edit {
  /** The material's path as it was given. */
  path: string;
  original: MaterialData;
  originalText: string;
  text: string;
}

const key = (path: string) => path.toLowerCase();

export class VmtEdits {
  private readonly list = new Map<string, Edit>();

  /** Keeps an edit; the first one of a material remembers the game's material and text. */
  set(path: string, text: string, original: MaterialData, originalText: string) {
    const k = key(path);
    const was = this.list.get(k);
    this.list.set(k, { path, original: was?.original ?? original, originalText: was?.originalText ?? originalText, text });
  }

  /** Forgets an edit, giving back the game's material (null when the material was not edited). */
  take(path: string): MaterialData | null {
    const k = key(path);
    const was = this.list.get(k);
    this.list.delete(k);
    return was?.original ?? null;
  }

  text(path: string): string | null { return this.list.get(key(path))?.text ?? null; }
  originalText(path: string): string | null { return this.list.get(key(path))?.originalText ?? null; }
  edited(path: string): boolean { return this.list.has(key(path)); }
  get size() { return this.list.size; }
  paths(): string[] { return [...this.list.values()].map((e) => e.path); }
}
