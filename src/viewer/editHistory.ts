/**
 * The history of the edits that change what the scene is made of (a model, prop, light or camera deleted or added, a folder made, a name
 * changed ...). Each edit is a command with the two ways to take it: `undo` puts things as they were before, `redo` does it again.
 *
 * The edits of a character's place (see PlacementHistory) keep their own history; both number their steps from the same counter, so that
 * undo takes back whichever of the two was done last.
 */

let counter = 0;
/** The next number of the one sequence that orders every step of every history. */
export const nextEditSeq = () => ++counter;

export interface EditCommand {
  label: string;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
}

interface Entry { command: EditCommand; seq: number }

export class EditHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private running = false;
  private readonly listeners: (() => void)[] = [];
  constructor(private readonly limit = 100) {}

  /** Records an edit that was just done. A step taken while one is being undone or redone is not an edit of its own and is ignored. */
  push(command: EditCommand) {
    if (this.running) return;
    this.undoStack.push({ command, seq: nextEditSeq() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.changed();
  }

  /** The step undo would take, and the one redo would, by their numbers (undefined: none). */
  topUndoSeq(): number | undefined { return this.undoStack[this.undoStack.length - 1]?.seq; }
  topRedoSeq(): number | undefined { return this.redoStack[this.redoStack.length - 1]?.seq; }
  get undoLabel(): string | undefined { return this.undoStack[this.undoStack.length - 1]?.command.label; }
  get redoLabel(): string | undefined { return this.redoStack[this.redoStack.length - 1]?.command.label; }
  get busy() { return this.running; }

  /** Takes the last edit back. False when there is none, or when it could not be taken back (it is dropped then). */
  async undo(): Promise<boolean> {
    const entry = this.undoStack.pop();
    if (!entry || this.running) { if (entry) this.undoStack.push(entry); return false; }
    this.running = true;
    try {
      await entry.command.undo();
    } catch (error) {
      console.error(`Could not undo "${entry.command.label}"`, error);
      this.running = false;
      this.changed();
      return false;
    }
    this.running = false;
    this.redoStack.push({ command: entry.command, seq: nextEditSeq() });
    this.changed();
    return true;
  }

  /** Does the edit that was taken back again. */
  async redo(): Promise<boolean> {
    const entry = this.redoStack.pop();
    if (!entry || this.running) { if (entry) this.redoStack.push(entry); return false; }
    this.running = true;
    try {
      await entry.command.redo();
    } catch (error) {
      console.error(`Could not redo "${entry.command.label}"`, error);
      this.running = false;
      this.changed();
      return false;
    }
    this.running = false;
    this.undoStack.push({ command: entry.command, seq: nextEditSeq() });
    this.changed();
    return true;
  }

  /** Forgets everything (the scene was replaced: the edits are about things that are gone). */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.changed();
  }

  onChange(fn: () => void) { this.listeners.push(fn); }
  private changed() { for (const fn of this.listeners) fn(); }
}

/** The history of the scene that is open. */
export const editHistory = new EditHistory();
