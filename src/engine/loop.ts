/**
 * Pure Execution Loop
 *
 * Implements the per-frame state machine:
 *   NextState = LogicCore(CurrentState, InputTextMap, Ruleset)
 *
 *   1. Sample  — read hardware input from InputManager
 *   2. Process — apply cached physics and .msc logic to the State Buffer
 *   3. Write   — generate the new State Buffer
 *   4. Render  — push visuals to WebGL
 */

import type { BakedAsset } from "./baker.js";
import type { InputState } from "./input.js";
import type { MscDocument } from "../parser/msc.js";
import type { Renderer } from "./renderer.js";
import { InputManager } from "./input.js";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  shake: number;
  tint: [number, number, number, number];
}

export interface EngineState {
  /** Raw pixel memory — the "state PNG" flattened to RGBA bytes. */
  buffer: Uint8ClampedArray;
  width: number;
  height: number;
  frameCount: number;
  tickCount: number;
  camera: CameraState;
}

export type LogicFn = (
  state: EngineState,
  input: InputState,
  baked: BakedAsset,
  script: MscDocument
) => EngineState;

export interface LoopOptions {
  baked: BakedAsset;
  script: MscDocument;
  logic: LogicFn;
  renderer: Renderer;
  inputManager: InputManager;
  onPostTick?: (state: EngineState) => void;
}

export class EngineLoop {
  private state: EngineState;
  private readonly options: LoopOptions;
  private rafId: number | null = null;

  constructor(initialState: EngineState, options: LoopOptions) {
    this.state = initialState;
    this.options = options;
  }

  /** Start the engine loop. */
  start(): void {
    if (this.rafId !== null) return;
    this.tick();
  }

  /** Stop the engine loop. */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick(): void {
    this.state.tickCount++;
    const { baked, script, logic, renderer, inputManager } = this.options;

    // 1. Sample
    const input = inputManager.sample();

    // 2 & 3. Process + Write (evaluator handles events + ECS component systems)
    this.state = logic(this.state, input, baked, script);

    // 4. Render
    renderer.render(this.state);

    this.options.onPostTick?.(this.state);

    this.state.frameCount++;
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  /** Access the current engine state (e.g. for debugging). */
  getState(): Readonly<EngineState> {
    return this.state;
  }
}

/**
 * Create the initial engine state from a loaded ImageData.
 */
export function createInitialState(imageData: ImageData): EngineState {
  return {
    buffer: new Uint8ClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
    frameCount: 0,
    tickCount: 0,
    camera: { x: 0, y: 0, zoom: 1, shake: 0, tint: [1, 1, 1, 1] },
  };
}

/**
 * Default identity logic — passes the state through unchanged.
 * Replace with your game-specific logic function.
 */
export const identityLogic: LogicFn = (state) => state;
