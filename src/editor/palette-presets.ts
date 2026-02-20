/**
 * Pixel Editor — Built-in Palette Presets
 *
 * Classic and industry-standard palettes for pixel art.
 */

import type { PalettePreset } from "./types.js";

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    name: "Mozaic Core 16",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751",
      "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436",
      "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ],
  },
  {
    name: "Pico-8",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751",
      "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436",
      "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ],
  },
  {
    name: "Gameboy",
    colors: [
      "#0f380f", "#306230", "#8bac0f", "#9bbc0f",
    ],
  },
  {
    name: "Dawnbringer 32",
    colors: [
      "#000000", "#222034", "#45283c", "#663931",
      "#8f563b", "#df7126", "#d9a066", "#eec39a",
      "#fbf236", "#99e550", "#6abe30", "#37946e",
      "#4b692f", "#524b24", "#323c39", "#3f3f74",
      "#306082", "#5b6ee1", "#639bff", "#5fcde4",
      "#cbdbfc", "#ffffff", "#9badb7", "#847e87",
      "#696a6a", "#595652", "#76428a", "#ac3232",
      "#d95763", "#d77bba", "#8f974a", "#8a6f30",
    ],
  },
  {
    name: "CGA",
    colors: [
      "#000000", "#555555", "#aaaaaa", "#ffffff",
      "#0000aa", "#5555ff", "#00aa00", "#55ff55",
      "#00aaaa", "#55ffff", "#aa0000", "#ff5555",
      "#aa00aa", "#ff55ff", "#aa5500", "#ffff55",
    ],
  },
  {
    name: "Commodore 64",
    colors: [
      "#000000", "#ffffff", "#880000", "#aaffee",
      "#cc44cc", "#00cc55", "#0000aa", "#eeee77",
      "#dd8855", "#664400", "#ff7777", "#333333",
      "#777777", "#aaff66", "#0088ff", "#bbbbbb",
    ],
  },
];
