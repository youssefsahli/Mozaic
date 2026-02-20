/**
 * Pixel Editor — Undo/Redo History Manager
 *
 * Snapshot-based history using full Uint8ClampedArray copies.
 * Decoupled from rendering — the orchestrator handles bake() and render().
 */

const MAX_HISTORY = 50;

export class HistoryManager {
  private undoStack: Uint8ClampedArray[] = [];
  private redoStack: Uint8ClampedArray[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Push a snapshot before a destructive operation. Clears redo stack. */
  pushSnapshot(imageData: ImageData): void {
    this.undoStack.push(new Uint8ClampedArray(imageData.data));
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Undo: pop previous snapshot, push current state to redo.
   * Returns the snapshot to apply, or null if nothing to undo.
   */
  undo(currentImageData: ImageData): Uint8ClampedArray | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(new Uint8ClampedArray(currentImageData.data));
    return previous;
  }

  /**
   * Redo: pop next snapshot, push current state to undo.
   * Returns the snapshot to apply, or null if nothing to redo.
   */
  redo(currentImageData: ImageData): Uint8ClampedArray | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(new Uint8ClampedArray(currentImageData.data));
    return next;
  }

  /** Clear all history. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
