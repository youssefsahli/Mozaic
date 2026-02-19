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

export class InputManager {
  private readonly actionMap: ActionMap;
  private readonly heldKeys: Set<string> = new Set();
  private readonly heldButtons: Set<string> = new Set();

  constructor(bindings: Array<{ key: string; action: string }>) {
    this.actionMap = buildActionMap(bindings);
    this.attachKeyboardListeners();
  }

  private attachKeyboardListeners(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", (e) => this.heldKeys.add(e.code));
    window.addEventListener("keyup", (e) => this.heldKeys.delete(e.code));
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
    const active = new Set<string>();
    for (const [action, keys] of this.actionMap) {
      for (const key of keys) {
        if (this.heldKeys.has(key) || this.heldButtons.has(key)) {
          active.add(action);
          break;
        }
      }
    }
    return { active };
  }

  dispose(): void {
    // Keyboard listeners are anonymous; a production version would
    // keep references for removeEventListener.
  }
}
