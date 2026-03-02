/**
 * Pixel Editor — Palette Management
 *
 * Manages the color palette system for the pixel editor, providing:
 *
 * - **Palette State** — ordered array of colors with active selection
 * - **Indexed Color** — locked colors that perform global pixel replacement
 * - **MSC Binding** — colors linked to script logic rule IDs
 * - **Named Colors** — human-readable labels for palette slots
 * - **Preset Library** — built-in palettes (Pico-8, Gameboy, CGA, etc.)
 * - **Import/Export** — .hex (one color per line) and JASC-PAL formats
 * - **Swatch UI** — interactive color grid with click/right-click/rename
 *
 * ## Color Format
 *
 * All colors are stored as lowercase 7-character hex strings (#rrggbb).
 * The palette supports up to 256 colors extracted from the active image.
 *
 * ## Indexed Color Workflow
 *
 * When a palette slot's hex value is updated (via the Update button),
 * `applyIndexedColorChange()` scans all pixels in the ImageData and
 * replaces every occurrence of the old color with the new one. This
 * enables global color swaps across the entire ROM.
 */

import type { PaletteColor } from "./types.js";
import { PALETTE_PRESETS } from "./palette-presets.js";
import { hexToRgb, rgbToHex } from "../shared/color-utils.js";

export interface PaletteState {
  colors: PaletteColor[];
  activeIndex: number;
  activePreset: string | null;
}

export function createPaletteState(initialColors?: string[]): PaletteState {
  const colors: PaletteColor[] = (initialColors ?? []).map((hex) => ({
    hex: hex.toLowerCase(),
    locked: false,
    mscRuleId: null,
  }));
  return { colors, activeIndex: 0, activePreset: null };
}

export function getActiveColor(state: PaletteState): string {
  if (state.colors.length === 0) return "#ff00ff";
  return state.colors[Math.min(state.activeIndex, state.colors.length - 1)].hex;
}

export function addColor(state: PaletteState, hex: string): void {
  const normalized = hex.toLowerCase();
  if (state.colors.some((c) => c.hex === normalized)) return;
  state.colors.push({ hex: normalized, locked: false, mscRuleId: null });
}

export function removeColor(state: PaletteState, index: number): void {
  if (index < 0 || index >= state.colors.length) return;
  state.colors.splice(index, 1);
  if (state.activeIndex >= state.colors.length) {
    state.activeIndex = Math.max(0, state.colors.length - 1);
  }
}

export function toggleLock(state: PaletteState, index: number): void {
  if (index < 0 || index >= state.colors.length) return;
  state.colors[index].locked = !state.colors[index].locked;
}

/**
 * Set or clear the display name for a palette slot.
 * Pass an empty string to clear the name.
 */
export function setColorName(state: PaletteState, index: number, name: string): void {
  if (index < 0 || index >= state.colors.length) return;
  const trimmed = name.trim();
  state.colors[index].name = trimmed || undefined;
}

/**
 * Update the hex value of an existing palette slot.
 * Returns the old hex if the color actually changed, or null if unchanged or invalid.
 */
export function updateColorHex(state: PaletteState, index: number, newHex: string): string | null {
  if (index < 0 || index >= state.colors.length) return null;
  const normalized = newHex.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) return null;
  const oldHex = state.colors[index].hex;
  if (oldHex === normalized) return null;
  state.colors[index].hex = normalized;
  return oldHex;
}

/**
 * Apply an indexed color change: replace all pixels matching oldHex
 * with newHex in the ImageData.
 */
export function applyIndexedColorChange(
  imageData: ImageData,
  oldHex: string,
  newHex: string
): boolean {
  const [oR, oG, oB] = hexToRgb(oldHex);
  const [nR, nG, nB] = hexToRgb(newHex);
  const data = imageData.data;
  let changed = false;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === oR && data[i + 1] === oG && data[i + 2] === oB) {
      data[i] = nR;
      data[i + 1] = nG;
      data[i + 2] = nB;
      changed = true;
    }
  }

  return changed;
}

/** Load a preset palette by name. Returns null if not found. */
export function loadPreset(name: string): PaletteColor[] | null {
  const preset = PALETTE_PRESETS.find((p) => p.name === name);
  if (!preset) return null;
  return preset.colors.map((hex) => ({
    hex: hex.toLowerCase(),
    locked: false,
    mscRuleId: null,
  }));
}

/** Get all available preset names. */
export function getPresetNames(): string[] {
  return PALETTE_PRESETS.map((p) => p.name);
}

// ── Import / Export ────────────────────────────────────────────

/**
 * Export palette as .hex format (one hex color per line, no # prefix).
 */
export function exportHex(state: PaletteState): string {
  return state.colors.map((c) => c.hex.replace("#", "")).join("\n");
}

/**
 * Import palette from .hex format text.
 */
export function importHex(text: string): PaletteColor[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const colors: PaletteColor[] = [];

  for (const line of lines) {
    const cleaned = line.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      colors.push({ hex: `#${cleaned.toLowerCase()}`, locked: false, mscRuleId: null });
    }
  }

  return colors;
}

/**
 * Export palette as JASC-PAL format (.pal).
 */
export function exportPal(state: PaletteState): string {
  const lines = ["JASC-PAL", "0100", String(state.colors.length)];
  for (const color of state.colors) {
    const [r, g, b] = hexToRgb(color.hex);
    lines.push(`${r} ${g} ${b}`);
  }
  return lines.join("\r\n");
}

/**
 * Import palette from JASC-PAL format text.
 */
export function importPal(text: string): PaletteColor[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const colors: PaletteColor[] = [];

  // Skip header: "JASC-PAL", "0100", count
  let startLine = 0;
  if (lines[0] === "JASC-PAL") startLine = 3;

  for (let i = startLine; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length >= 3) {
      const r = parseInt(parts[0], 10);
      const g = parseInt(parts[1], 10);
      const b = parseInt(parts[2], 10);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        colors.push({ hex: rgbToHex(r, g, b), locked: false, mscRuleId: null });
      }
    }
  }

  return colors;
}

/**
 * Extract unique colors from an ImageData.
 */
export function extractFromImage(imageData: ImageData, maxColors = 256): string[] {
  const seen = new Set<string>();
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip transparent
    const hex = rgbToHex(data[i], data[i + 1], data[i + 2]);
    seen.add(hex);
    if (seen.size >= maxColors) break;
  }

  return Array.from(seen);
}

// ── Swatch rendering ──────────────────────────────────────────

/**
 * Render palette swatches into the container element.
 */
export function renderSwatches(
  state: PaletteState,
  container: HTMLElement,
  onSelect: (index: number) => void,
  onContextMenu: (index: number, e: MouseEvent) => void,
  onDoubleClick?: (index: number) => void
): void {
  container.innerHTML = "";

  state.colors.forEach((color, index) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "palette-swatch";
    swatch.title = color.name ? `${color.name} (${color.hex})` : color.hex;
    swatch.style.background = color.hex;

    if (index === state.activeIndex) {
      swatch.classList.add("is-active");
    }

    if (color.locked) {
      swatch.classList.add("is-locked");
      const lockIcon = document.createElement("span");
      lockIcon.className = "lock-indicator";
      lockIcon.textContent = "\u{1F512}";
      swatch.appendChild(lockIcon);
    }

    if (color.mscRuleId) {
      const indicator = document.createElement("span");
      indicator.className = "msc-indicator";
      indicator.title = `MSC: ${color.mscRuleId}`;
      swatch.appendChild(indicator);
    }

    if (color.name) {
      const nameLabel = document.createElement("span");
      nameLabel.className = "swatch-name";
      nameLabel.textContent = color.name;
      swatch.appendChild(nameLabel);
    }

    swatch.addEventListener("click", () => onSelect(index));
    swatch.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      onContextMenu(index, e);
    });
    if (onDoubleClick) {
      swatch.addEventListener("dblclick", (e) => {
        e.preventDefault();
        onDoubleClick(index);
      });
    }

    container.appendChild(swatch);
  });
}

// ── Helpers ────────────────────────────────────────────────────
