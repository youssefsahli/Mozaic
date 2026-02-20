/**
 * Pixel Editor — Shared Type Definitions
 *
 * Central types reused across all editor modules.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface CameraState {
  /** Viewport origin X in document space. */
  x: number;
  /** Viewport origin Y in document space. */
  y: number;
  /** Zoom multiplier (1 = 1:1, 8 = 8x magnification). */
  zoom: number;
}

export const enum ToolType {
  Draw = 0,
  Erase = 1,
  Fill = 2,
  Select = 3,
  Pipette = 4,
}

export interface PointerInfo {
  /** Pointer X relative to the viewport element. */
  canvasX: number;
  /** Pointer Y relative to the viewport element. */
  canvasY: number;
  /** Document pixel X (after inverse camera transform). */
  docX: number;
  /** Document pixel Y (after inverse camera transform). */
  docY: number;
  /** Normalised pressure 0–1 from the stylus. */
  pressure: number;
  /** Stylus tilt X in degrees (-90 to 90). */
  tiltX: number;
  /** Stylus tilt Y in degrees (-90 to 90). */
  tiltY: number;
  /** "mouse" | "pen" | "touch" */
  pointerType: string;
  /** Mouse button (0 = primary, 1 = middle, 2 = secondary). */
  button: number;
  /** Pointer ID for multi-touch tracking. */
  pointerId: number;
}

export type PressureMode = "size" | "dither";

export interface BrushSettings {
  /** Base brush radius in pixels. */
  size: number;
  /** How stylus pressure is interpreted. */
  pressureMode: PressureMode;
  /** Current drawing color (hex string). */
  color: string;
}

export interface EditorConfig {
  /** When true, touch events only navigate; pen events only draw. */
  stylusOnly: boolean;
  /** How stylus pressure is interpreted. */
  pressureMode: PressureMode;
}

export interface PaletteColor {
  /** Hex color string (#rrggbb). */
  hex: string;
  /** If true, changing this color globally replaces all matching pixels. */
  locked: boolean;
  /** MSC rule ID bound to this color, or null. */
  mscRuleId: string | null;
}

export interface PalettePreset {
  name: string;
  colors: string[];
}

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
