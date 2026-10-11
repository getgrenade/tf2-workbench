export interface PlacementSnapshot {
  position: [number, number, number];
  yaw: number;
  /** The tip of a character that is not upright (zero when missing). */
  pitch?: number;
  roll?: number;
  scale: [number, number, number];
  placed: boolean;
}

const copy = (state: PlacementSnapshot): PlacementSnapshot => ({ ...state, position: [...state.position], scale: [...state.scale] });

/** Only completed edits enter history: canceled/no-op drags preserve the redo branch. */
/** A snapshot with the id of the group edit it belongs to (one drag of several things at once), when it does. */
interface Entry { state: PlacementSnapshot; group?: number }

export class PlacementHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  constructor(private readonly limit = 100) {}

  /** The group edit that undo (or redo) would step over next; none for an edit of a single thing. */
  undoGroup(): number | undefined { return this.undoStack[this.undoStack.length - 1]?.group; }
  redoGroup(): number | undefined { return this.redoStack[this.redoStack.length - 1]?.group; }

  commit(before: PlacementSnapshot, after: PlacementSnapshot, group?: number) {
    const values = (state: PlacementSnapshot) => [...state.position, state.yaw, state.pitch ?? 0, state.roll ?? 0, ...state.scale];
    const previous = values(before);
    if (before.placed === after.placed && values(after).every((value, index) => Math.abs(value - previous[index]) < 1e-6)) return;
    this.undoStack.push({ state: copy(before), group });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(current: PlacementSnapshot): PlacementSnapshot | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ state: copy(current), group: entry.group });
    return entry.state;
  }

  redo(current: PlacementSnapshot): PlacementSnapshot | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ state: copy(current), group: entry.group });
    return entry.state;
  }
}
