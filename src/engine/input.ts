/**
 * Input Mapping
 *
 * Maps hardware keyboard and gamepad inputs to abstract actions
 * defined in the .msc script.  Accessibility-friendly: any key or
 * pad button can be remapped.
 */

export type ActionMap = Map<string, Set<string>>;

/**
 * Build an action → set-of-keys map from MSC input bindings.
 */
export function buildActionMap(
  bindings: Array<{ key: string; action: string }>
): ActionMap {
  const map: ActionMap = new Map();
  for (const { key, action } of bindings) {
    if (!map.has(action)) map.set(action, new Set());
    map.get(action)!.add(key);
  }
  return map;
}

export interface InputState {
  /** Set of currently active action names. */
  active: Set<string>;
}

/**
 * Normalize a KeyboardEvent.code so that browser codes like "KeyW"
 * match the MSC-format "Key_W", and "Space" matches "Key_Space".
 */
function normalizeCode(code: string): string {
  const letterFixed = code.replace(/^Key([A-Z])$/, "Key_$1");
  if (letterFixed !== code) return letterFixed;
  if (code === "Space") return "Key_Space";
  return code;
}

export class InputManager {
  private readonly actionMap: ActionMap;
  private readonly heldKeys: Set<string> = new Set();
  private readonly heldButtons: Set<string> = new Set();
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  /** Pre-allocated set reused every frame to avoid GC pressure. */
  private readonly _activeCache: Set<string> = new Set();
  /** Pre-allocated InputState object reused every frame. */
  private readonly _stateCache: InputState;

  constructor(bindings: Array<{ key: string; action: string }>) {
    this.actionMap = buildActionMap(bindings);
    this._stateCache = { active: this._activeCache };
    this.onKeyDown = (e) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      this.heldKeys.add(normalizeCode(e.code));
    };
    this.onKeyUp = (e) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      this.heldKeys.delete(normalizeCode(e.code));
    };
    this.attachKeyboardListeners();
  }

  private attachKeyboardListeners(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /** Poll gamepad and merge button state. */
  pollGamepad(): void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    this.heldButtons.clear();
    for (const gp of navigator.getGamepads()) {
      if (!gp) continue;
      gp.buttons.forEach((btn, idx) => {
        if (btn.pressed) this.heldButtons.add(`Pad_${idx}`);
      });
    }
  }

  /** Return current input state (which actions are active). */
  sample(): InputState {
    this.pollGamepad();
    this._activeCache.clear();
    for (const [action, keys] of this.actionMap) {
      for (const key of keys) {
        if (this.heldKeys.has(key) || this.heldButtons.has(key)) {
          this._activeCache.add(action);
          break;
        }
      }
    }
    return this._stateCache;
  }

  getDebugInfo(): { held: string[]; active: string[] } {
    const active: string[] = [];
    for (const [action, keys] of this.actionMap) {
      for (const key of keys) {
        if (this.heldKeys.has(key) || this.heldButtons.has(key)) {
          active.push(action);
          break;
        }
      }
    }
    return {
      held: Array.from(this.heldKeys).concat(Array.from(this.heldButtons)),
      active,
    };
  }

  dispose(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
