/**
 * Mozaic Engine — Entry Point
 *
 * Bootstraps the engine against the #mozaic-canvas element.
 * A SpriteROM is loaded by passing the image URL as the `src` query
 * parameter:  ?src=level_1.mzk
 */

import { loadAsset } from "./engine/loader.js";
import { bake, type BakedAsset, type Point } from "./engine/baker.js";
import { Renderer } from "./engine/renderer.js";
import { InputManager } from "./engine/input.js";
import {
  EngineLoop,
  createInitialState,
  identityLogic,
} from "./engine/loop.js";
import { parseMsc, type MscDocument } from "./parser/msc.js";

type EditorMode = "script" | "config";
const LAST_ROM_STORAGE_KEY = "mozaic:last-rom";
const LAST_SCRIPT_STORAGE_KEY = "mozaic:last-script";
const MAX_UNDO_HISTORY = 50;
const DEFAULT_PALETTE = [
  "#000000",
  "#ffffff",
  "#ff00ff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#00ffff",
];

interface MozaicConfig {
  game: {
    newRomWidth: number;
    newRomHeight: number;
    newRomColor: string;
    autoCreateOnStart: boolean;
    autoLoadSrc?: string;
  };
  editor: {
    defaultPixelColor: string;
    defaultScript: string;
    showScriptEditor: boolean;
    showPixelEditor: boolean;
  };
}

const DEFAULT_CONFIG: MozaicConfig = {
  game: {
    newRomWidth: 64,
    newRomHeight: 64,
    newRomColor: "#000000",
    autoCreateOnStart: false,
  },
  editor: {
    defaultPixelColor: "#ff00ff",
    defaultScript: "",
    showScriptEditor: true,
    showPixelEditor: true,
  },
};

interface UiRefs {
  appRoot: HTMLDivElement;
  canvas: HTMLCanvasElement;
  newRomButton: HTMLButtonElement;
  openRomButton: HTMLButtonElement;
  openScriptButton: HTMLButtonElement;
  openConfigButton: HTMLButtonElement;
  toggleDocsButton: HTMLButtonElement;
  saveRomButton: HTMLButtonElement;
  reloadConfigButton: HTMLButtonElement;
  restartButton: HTMLButtonElement;
  textEditorTitle: HTMLDivElement;
  mscSection: HTMLDivElement;
  pixelSection: HTMLDivElement;
  mscEditor: HTMLTextAreaElement;
  mscHighlight: HTMLPreElement;
  mscStatus: HTMLDivElement;
  pixelColor: HTMLInputElement;
  paletteAddButton: HTMLButtonElement;
  eraserToggleButton: HTMLButtonElement;
  presetPencilButton: HTMLButtonElement;
  presetBrushButton: HTMLButtonElement;
  presetEraserButton: HTMLButtonElement;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  paletteSwatches: HTMLDivElement;
  pixelZoom: HTMLInputElement;
  zoomLevel: HTMLSpanElement;
  brushSize: HTMLInputElement;
  brushSizeLabel: HTMLSpanElement;
  gridInlineToggle: HTMLInputElement;
  gridCustomToggle: HTMLInputElement;
  debugCollisionToggle: HTMLInputElement;
  debugPathToggle: HTMLInputElement;
  debugPointsToggle: HTMLInputElement;
  debugIdsToggle: HTMLInputElement;
  gridSize: HTMLInputElement;
  gridMajor: HTMLInputElement;
  pixelStage: HTMLDivElement;
  pixelEditor: HTMLCanvasElement;
  pixelGridOverlay: HTMLCanvasElement;
  pixelCoords: HTMLSpanElement;
  docsPane: HTMLDivElement;
  docsSearch: HTMLInputElement;
  docsResults: HTMLDivElement;
  docsContent: HTMLDivElement;
}

interface DocEntry {
  id: string;
  title: string;
  category: string;
  content: string;
}

interface RuntimeState {
  ui: UiRefs;
  renderer: Renderer;
  loop: EngineLoop | null;
  inputManager: InputManager | null;
  imageData: ImageData | null;
  baked: BakedAsset | null;
  drawing: boolean;
  config: MozaicConfig;
  scriptText: string;
  configText: string;
  editorMode: EditorMode;
  persistTimer: number | null;
  zoom: number;
  palette: string[];
  selectedCollisionIndex: number | null;
  selectedPathIndex: number | null;
  brushSize: number;
  eraserMode: boolean;
  undoStack: Uint8ClampedArray[];
  redoStack: Uint8ClampedArray[];
  docsVisible: boolean;
  docsEntries: DocEntry[];
  docsFiltered: DocEntry[];
  selectedDocId: string | null;
}

async function main(): Promise<void> {
  const ui = getUiRefs();
  const runtime: RuntimeState = {
    ui,
    renderer: new Renderer(ui.canvas),
    loop: null,
    inputManager: null,
    imageData: null,
    baked: null,
    drawing: false,
    config: DEFAULT_CONFIG,
    scriptText: "",
    configText: JSON.stringify(DEFAULT_CONFIG, null, 2),
    editorMode: "script",
    persistTimer: null,
    zoom: 8,
    palette: [...DEFAULT_PALETTE],
    selectedCollisionIndex: null,
    selectedPathIndex: null,
    brushSize: 1,
    eraserMode: false,
    undoStack: [],
    redoStack: [],
    docsVisible: false,
    docsEntries: [],
    docsFiltered: [],
    selectedDocId: null,
  };

  wireUi(runtime);
  await loadDocsIndex(runtime);
  await loadAndApplyConfig(runtime);

  const params = new URLSearchParams(window.location.search);
  const src = params.get("src") ?? runtime.config.game.autoLoadSrc;

  if (src) {
    await loadRom(runtime, src);
  } else {
    const restoredScript = restoreLastScript();
    if (restoredScript !== null) {
      runtime.scriptText = restoredScript;
    }

    const restored = await restoreLastRom(runtime);
    if (restored) return;

    showPlaceholder(
      ui.canvas,
      "Mozaic Engine ready.",
      "Open a ROM and optionally a .msc script, then press Restart."
    );
    runtime.scriptText = runtime.config.editor.defaultScript;
    switchEditorMode(runtime, "script");
    if (runtime.config.game.autoCreateOnStart) {
      createNewRom(runtime);
    }
  }
}

function getUiRefs(): UiRefs {
  return {
    appRoot: requiredElement<HTMLDivElement>("mozaic-app"),
    canvas: requiredElement<HTMLCanvasElement>("mozaic-canvas"),
    newRomButton: requiredElement<HTMLButtonElement>("new-rom-button"),
    openRomButton: requiredElement<HTMLButtonElement>("open-rom-button"),
    openScriptButton: requiredElement<HTMLButtonElement>("open-script-button"),
    openConfigButton: requiredElement<HTMLButtonElement>("open-config-button"),
    toggleDocsButton: requiredElement<HTMLButtonElement>("toggle-docs-button"),
    saveRomButton: requiredElement<HTMLButtonElement>("save-rom-button"),
    reloadConfigButton: requiredElement<HTMLButtonElement>("reload-config-button"),
    restartButton: requiredElement<HTMLButtonElement>("restart-button"),
    textEditorTitle: requiredElement<HTMLDivElement>("text-editor-title"),
    mscSection: requiredElement<HTMLDivElement>("msc-section"),
    pixelSection: requiredElement<HTMLDivElement>("pixel-section"),
    mscEditor: requiredElement<HTMLTextAreaElement>("msc-editor"),
    mscHighlight: requiredElement<HTMLPreElement>("msc-highlight"),
    mscStatus: requiredElement<HTMLDivElement>("msc-status"),
    pixelColor: requiredElement<HTMLInputElement>("pixel-color"),
    paletteAddButton: requiredElement<HTMLButtonElement>("palette-add-button"),
    eraserToggleButton: requiredElement<HTMLButtonElement>("eraser-toggle-button"),
    presetPencilButton: requiredElement<HTMLButtonElement>("preset-pencil-button"),
    presetBrushButton: requiredElement<HTMLButtonElement>("preset-brush-button"),
    presetEraserButton: requiredElement<HTMLButtonElement>("preset-eraser-button"),
    undoButton: requiredElement<HTMLButtonElement>("undo-button"),
    redoButton: requiredElement<HTMLButtonElement>("redo-button"),
    clearButton: requiredElement<HTMLButtonElement>("clear-button"),
    paletteSwatches: requiredElement<HTMLDivElement>("palette-swatches"),
    pixelZoom: requiredElement<HTMLInputElement>("pixel-zoom"),
    zoomLevel: requiredElement<HTMLSpanElement>("zoom-level"),
    brushSize: requiredElement<HTMLInputElement>("brush-size"),
    brushSizeLabel: requiredElement<HTMLSpanElement>("brush-size-label"),
    gridInlineToggle: requiredElement<HTMLInputElement>("grid-inline-toggle"),
    gridCustomToggle: requiredElement<HTMLInputElement>("grid-custom-toggle"),
    debugCollisionToggle: requiredElement<HTMLInputElement>("debug-collision-toggle"),
    debugPathToggle: requiredElement<HTMLInputElement>("debug-path-toggle"),
    debugPointsToggle: requiredElement<HTMLInputElement>("debug-points-toggle"),
    debugIdsToggle: requiredElement<HTMLInputElement>("debug-ids-toggle"),
    gridSize: requiredElement<HTMLInputElement>("grid-size"),
    gridMajor: requiredElement<HTMLInputElement>("grid-major"),
    pixelStage: requiredElement<HTMLDivElement>("pixel-stage"),
    pixelEditor: requiredElement<HTMLCanvasElement>("pixel-editor"),
    pixelGridOverlay: requiredElement<HTMLCanvasElement>("pixel-grid-overlay"),
    pixelCoords: requiredElement<HTMLSpanElement>("pixel-coords"),
    docsPane: requiredElement<HTMLDivElement>("docs-pane"),
    docsSearch: requiredElement<HTMLInputElement>("docs-search"),
    docsResults: requiredElement<HTMLDivElement>("docs-results"),
    docsContent: requiredElement<HTMLDivElement>("docs-content"),
  };
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id) as T | null;
  if (!element) throw new Error(`Element #${id} not found`);
  return element;
}

function wireUi(runtime: RuntimeState): void {
  const { ui } = runtime;
  runtime.zoom = sanitizeDimension(Number(ui.pixelZoom.value), runtime.zoom);
  runtime.brushSize = sanitizeDimension(Number(ui.brushSize.value), runtime.brushSize);

  const romInput = document.createElement("input");
  romInput.type = "file";
  romInput.accept = ".mzk,.png,.jpg,.jpeg,.webp";
  romInput.style.display = "none";
  document.body.appendChild(romInput);

  const scriptInput = document.createElement("input");
  scriptInput.type = "file";
  scriptInput.accept = ".msc,.txt,.yaml,.yml";
  scriptInput.style.display = "none";
  document.body.appendChild(scriptInput);

  ui.newRomButton.addEventListener("click", () => {
    createNewRom(runtime);
  });
  ui.openRomButton.addEventListener("click", () => romInput.click());
  ui.openScriptButton.addEventListener("click", () => {
    switchEditorMode(runtime, "script");
    scriptInput.click();
  });
  ui.openConfigButton.addEventListener("click", () => {
    switchEditorMode(runtime, "config");
  });
  ui.toggleDocsButton.addEventListener("click", () => {
    runtime.docsVisible = !runtime.docsVisible;
    renderDocsPaneState(runtime);
  });
  ui.saveRomButton.addEventListener("click", () => {
    saveRom(runtime);
  });
  ui.reloadConfigButton.addEventListener("click", async () => {
    await reloadConfig(runtime);
  });
  ui.restartButton.addEventListener("click", () => {
    restart(runtime);
  });

  ui.paletteAddButton.addEventListener("click", () => {
    addPaletteColor(runtime, ui.pixelColor.value);
  });
  ui.eraserToggleButton.addEventListener("click", () => {
    runtime.eraserMode = !runtime.eraserMode;
    updateEraserUi(runtime);
  });
  ui.presetPencilButton.addEventListener("click", () => {
    setToolPreset(runtime, 1, false);
  });
  ui.presetBrushButton.addEventListener("click", () => {
    setToolPreset(runtime, 3, false);
  });
  ui.presetEraserButton.addEventListener("click", () => {
    setToolPreset(runtime, 3, true);
  });
  ui.undoButton.addEventListener("click", () => {
    undoEdit(runtime);
  });
  ui.redoButton.addEventListener("click", () => {
    redoEdit(runtime);
  });
  ui.clearButton.addEventListener("click", () => {
    clearImage(runtime);
  });
  ui.pixelZoom.addEventListener("input", () => {
    runtime.zoom = sanitizeDimension(Number(ui.pixelZoom.value), 8);
    ui.zoomLevel.textContent = `${runtime.zoom}×`;
    renderPixelEditor(runtime);
  });
  ui.brushSize.addEventListener("input", () => {
    runtime.brushSize = sanitizeDimension(Number(ui.brushSize.value), 1);
    ui.brushSizeLabel.textContent = `${runtime.brushSize}`;
  });
  ui.gridInlineToggle.addEventListener("change", () => {
    renderGridOverlay(runtime);
  });
  ui.gridCustomToggle.addEventListener("change", () => {
    renderGridOverlay(runtime);
  });
  ui.debugCollisionToggle.addEventListener("change", () => {
    renderGridOverlay(runtime);
  });
  ui.debugPathToggle.addEventListener("change", () => {
    renderGridOverlay(runtime);
  });
  ui.debugPointsToggle.addEventListener("change", () => {
    renderGridOverlay(runtime);
  });
  ui.debugIdsToggle.addEventListener("change", () => {
    renderGridOverlay(runtime);
  });
  ui.gridSize.addEventListener("input", () => {
    ui.gridSize.value = String(sanitizeDimension(Number(ui.gridSize.value), 8));
    renderGridOverlay(runtime);
  });
  ui.gridMajor.addEventListener("input", () => {
    ui.gridMajor.value = String(sanitizeDimension(Number(ui.gridMajor.value), 4));
    renderGridOverlay(runtime);
  });

  romInput.addEventListener("change", async () => {
    const file = romInput.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      await loadRom(runtime, objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  });

  scriptInput.addEventListener("change", async () => {
    const file = scriptInput.files?.[0];
    if (!file) return;
    runtime.scriptText = await file.text();
    persistScript(runtime.scriptText);
    switchEditorMode(runtime, "script");
  });

  ui.mscEditor.addEventListener("input", () => {
    if (runtime.editorMode === "script") {
      runtime.scriptText = ui.mscEditor.value;
      persistScript(runtime.scriptText);
    } else {
      runtime.configText = ui.mscEditor.value;
    }
    refreshHighlight(runtime);
    validateEditor(runtime);
  });
  ui.mscEditor.addEventListener("scroll", () => {
    ui.mscHighlight.scrollTop = ui.mscEditor.scrollTop;
    ui.mscHighlight.scrollLeft = ui.mscEditor.scrollLeft;
  });

  ui.pixelEditor.addEventListener("pointerdown", (event) => {
    if (event.altKey) {
      selectDebugLayer(runtime, event);
      return;
    }
    if (event.button === 2) {
      pickPixelColor(runtime, event);
      return;
    }
    beginStroke(runtime);
    runtime.drawing = true;
    drawPixel(runtime, event);
  });
  ui.pixelEditor.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  window.addEventListener("pointerup", () => {
    runtime.drawing = false;
  });
  ui.pixelEditor.addEventListener("pointermove", (event) => {
    updatePixelCoordinates(runtime, event);
    if (!runtime.drawing) return;
    drawPixel(runtime, event);
  });
  ui.pixelEditor.addEventListener("pointerleave", () => {
    ui.pixelCoords.textContent = "–, –";
  });

  ui.docsSearch.addEventListener("input", () => {
    filterDocs(runtime, ui.docsSearch.value);
  });

  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoEdit(runtime);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redoEdit(runtime);
    }
  });

  // Wire collapsible pane toggles (all panes with data-pane attribute)
  document.querySelectorAll<HTMLButtonElement>("[data-pane]").forEach((btn) => {
    const paneId = btn.dataset.pane!;
    const pane = document.getElementById(paneId);
    const dir = btn.dataset.dir === "left" ? "left" : "right";
    if (!pane) return;
    btn.addEventListener("click", () => {
      const collapsed = pane.classList.toggle("pane-collapsed");
      btn.textContent = collapsed
        ? (dir === "left" ? "›" : "‹")
        : (dir === "left" ? "‹" : "›");
    });
  });

  renderPalette(runtime);
  ui.zoomLevel.textContent = `${runtime.zoom}×`;
  ui.brushSizeLabel.textContent = `${runtime.brushSize}`;
  updateEraserUi(runtime);
  updateHistoryButtons(runtime);
  renderDocsPaneState(runtime);
}

async function loadDocsIndex(runtime: RuntimeState): Promise<void> {
  try {
    const response = await fetch(`/docs/search-index.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Docs index fetch failed");
    const docs = (await response.json()) as DocEntry[];
    runtime.docsEntries = docs;
  } catch {
    runtime.docsEntries = defaultDocs();
  }
  filterDocs(runtime, "");
}

function filterDocs(runtime: RuntimeState, query: string): void {
  const normalized = query.trim().toLowerCase();
  runtime.docsFiltered = runtime.docsEntries.filter((entry) => {
    if (!normalized) return true;
    return (
      entry.title.toLowerCase().includes(normalized) ||
      entry.category.toLowerCase().includes(normalized) ||
      entry.content.toLowerCase().includes(normalized)
    );
  });

  if (
    runtime.selectedDocId &&
    !runtime.docsFiltered.some((entry) => entry.id === runtime.selectedDocId)
  ) {
    runtime.selectedDocId = null;
  }

  if (!runtime.selectedDocId && runtime.docsFiltered.length > 0) {
    runtime.selectedDocId = runtime.docsFiltered[0].id;
  }

  renderDocsList(runtime);
  renderSelectedDoc(runtime);
}

function renderDocsPaneState(runtime: RuntimeState): void {
  runtime.ui.docsPane.classList.toggle("pane-collapsed", !runtime.docsVisible);
  runtime.ui.toggleDocsButton.textContent = runtime.docsVisible ? "›" : "‹";
  runtime.ui.toggleDocsButton.classList.toggle("is-active", runtime.docsVisible);
}

function renderDocsList(runtime: RuntimeState): void {
  const container = runtime.ui.docsResults;
  container.innerHTML = "";

  for (const entry of runtime.docsFiltered) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "doc-item";
    if (entry.id === runtime.selectedDocId) {
      item.classList.add("is-active");
    }
    item.innerHTML = `<div>${entry.title}</div><small>${entry.category}</small>`;
    item.addEventListener("click", () => {
      runtime.selectedDocId = entry.id;
      renderDocsList(runtime);
      renderSelectedDoc(runtime);
    });
    container.appendChild(item);
  }
}

function renderSelectedDoc(runtime: RuntimeState): void {
  if (!runtime.selectedDocId) {
    runtime.ui.docsContent.textContent = "No matching documentation entries.";
    return;
  }

  const selected = runtime.docsEntries.find((entry) => entry.id === runtime.selectedDocId);
  if (!selected) {
    runtime.ui.docsContent.textContent = "No matching documentation entries.";
    return;
  }
  runtime.ui.docsContent.textContent = `${selected.title}\n\n${selected.content}`;
}

function defaultDocs(): DocEntry[] {
  return [
    {
      id: "fallback-architecture",
      title: "Mozaic Architecture",
      category: "Architecture",
      content:
        "State buffer core, bake pipeline, and pure runtime tick. See docs/MOZAIC_ARCHITECTURE.md for full details.",
    },
    {
      id: "fallback-editor",
      title: "Pixel Editor",
      category: "Editor",
      content:
        "Brush, eraser, palettes, zoom, overlays, undo/redo and debug layer selection are available in the editor panel.",
    },
  ];
}

async function loadRom(runtime: RuntimeState, source: string): Promise<void> {
  const asset = await loadAsset(source);
  runtime.imageData = cloneImageData(asset.imageData);
  runtime.baked = bake(runtime.imageData);
  runtime.undoStack = [];
  runtime.redoStack = [];
  updateHistoryButtons(runtime);

  if (asset.scriptText !== undefined) {
    runtime.scriptText = asset.scriptText;
  } else {
    runtime.scriptText = runtime.config.editor.defaultScript;
  }
  persistScript(runtime.scriptText);

  switchEditorMode(runtime, "script");
  renderPixelEditor(runtime);
  schedulePersistRom(runtime);
  restart(runtime);
}

function restart(runtime: RuntimeState): void {
  const { ui } = runtime;
  if (!runtime.imageData) {
    showPlaceholder(ui.canvas, "No ROM loaded.", "Open a ROM file first.");
    return;
  }

  const script = getScriptDocument(runtime);
  if (!script) return;

  runtime.loop?.stop();
  runtime.inputManager?.dispose();

  const imageData = cloneImageData(runtime.imageData);
  ui.canvas.width = imageData.width;
  ui.canvas.height = imageData.height;

  const baked = runtime.baked ?? bake(imageData);
  runtime.baked = baked;
  const inputManager = new InputManager(collectBindings(script));
  const loop = new EngineLoop(createInitialState(imageData), {
    baked,
    script,
    logic: identityLogic,
    renderer: runtime.renderer,
    inputManager,
  });

  runtime.inputManager = inputManager;
  runtime.loop = loop;
  loop.start();
}

function createNewRom(runtime: RuntimeState): void {
  const { newRomWidth, newRomHeight, newRomColor } = runtime.config.game;
  runtime.imageData = createBlankImageData(newRomWidth, newRomHeight, newRomColor);
  runtime.baked = bake(runtime.imageData);
  runtime.undoStack = [];
  runtime.redoStack = [];
  updateHistoryButtons(runtime);
  runtime.scriptText = runtime.config.editor.defaultScript;
  persistScript(runtime.scriptText);
  switchEditorMode(runtime, "script");
  renderPixelEditor(runtime);
  schedulePersistRom(runtime);
  restart(runtime);
  runtime.ui.mscStatus.textContent = `New ${newRomWidth}x${newRomHeight} ROM created.`;
  runtime.ui.mscStatus.style.color = "#6a9955";
}

async function reloadConfig(runtime: RuntimeState): Promise<void> {
  if (runtime.editorMode === "config") {
    if (!applyConfigFromEditor(runtime)) return;
  } else {
    await loadAndApplyConfig(runtime);
  }
  if (runtime.imageData) restart(runtime);
  runtime.ui.mscStatus.textContent = "Config reloaded.";
  runtime.ui.mscStatus.style.color = "#6a9955";
}

async function loadAndApplyConfig(runtime: RuntimeState): Promise<void> {
  const loaded = await loadConfigFile();
  runtime.config = loaded.config;
  runtime.configText = loaded.text;
  applyConfig(runtime);
  if (runtime.editorMode === "config") {
    setEditorText(runtime, runtime.configText);
  }
}

async function loadConfigFile(): Promise<{ config: MozaicConfig; text: string }> {
  try {
    const response = await fetch(`/mozaic.config.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        config: DEFAULT_CONFIG,
        text: JSON.stringify(DEFAULT_CONFIG, null, 2),
      };
    }

    const text = await response.text();
    const raw = JSON.parse(text) as Partial<MozaicConfig>;
    return {
      config: mergeConfig(raw),
      text,
    };
  } catch {
    return {
      config: DEFAULT_CONFIG,
      text: JSON.stringify(DEFAULT_CONFIG, null, 2),
    };
  }
}

function applyConfigFromEditor(runtime: RuntimeState): boolean {
  try {
    const raw = JSON.parse(runtime.configText) as Partial<MozaicConfig>;
    runtime.config = mergeConfig(raw);
    runtime.configText = JSON.stringify(runtime.config, null, 2);
    applyConfig(runtime);
    setEditorText(runtime, runtime.configText);
    return true;
  } catch {
    runtime.ui.mscStatus.textContent = "Invalid config JSON.";
    runtime.ui.mscStatus.style.color = "#d16969";
    return false;
  }
}

function mergeConfig(raw: Partial<MozaicConfig>): MozaicConfig {
  const gameRaw: Partial<MozaicConfig["game"]> = raw.game ?? {};
  const editorRaw: Partial<MozaicConfig["editor"]> = raw.editor ?? {};

  return {
    game: {
      newRomWidth: sanitizeDimension(gameRaw.newRomWidth, DEFAULT_CONFIG.game.newRomWidth),
      newRomHeight: sanitizeDimension(gameRaw.newRomHeight, DEFAULT_CONFIG.game.newRomHeight),
      newRomColor: sanitizeHexColor(gameRaw.newRomColor, DEFAULT_CONFIG.game.newRomColor),
      autoCreateOnStart: Boolean(gameRaw.autoCreateOnStart),
      autoLoadSrc: typeof gameRaw.autoLoadSrc === "string" ? gameRaw.autoLoadSrc : undefined,
    },
    editor: {
      defaultPixelColor: sanitizeHexColor(
        editorRaw.defaultPixelColor,
        DEFAULT_CONFIG.editor.defaultPixelColor
      ),
      defaultScript:
        typeof editorRaw.defaultScript === "string"
          ? editorRaw.defaultScript
          : DEFAULT_CONFIG.editor.defaultScript,
      showScriptEditor:
        typeof editorRaw.showScriptEditor === "boolean"
          ? editorRaw.showScriptEditor
          : DEFAULT_CONFIG.editor.showScriptEditor,
      showPixelEditor:
        typeof editorRaw.showPixelEditor === "boolean"
          ? editorRaw.showPixelEditor
          : DEFAULT_CONFIG.editor.showPixelEditor,
    },
  };
}

function sanitizeDimension(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(512, Math.max(1, Math.floor(value)));
}

function sanitizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function applyConfig(runtime: RuntimeState): void {
  const { ui, config } = runtime;
  ui.pixelColor.value = config.editor.defaultPixelColor;
  addPaletteColor(runtime, config.editor.defaultPixelColor);
  ui.mscSection.style.display = config.editor.showScriptEditor ? "" : "none";
  ui.pixelSection.style.display = config.editor.showPixelEditor ? "" : "none";
  if (!runtime.scriptText) {
    runtime.scriptText = config.editor.defaultScript;
  }
}

function saveRom(runtime: RuntimeState): void {
  if (!runtime.imageData) {
    runtime.ui.mscStatus.textContent = "Load a ROM before saving.";
    runtime.ui.mscStatus.style.color = "#d16969";
    return;
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = runtime.imageData.width;
  exportCanvas.height = runtime.imageData.height;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) return;

  ctx.putImageData(runtime.imageData, 0, 0);
  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/png");
  link.download = `mozaic-rom-${Date.now()}.png`;
  link.click();

  runtime.ui.mscStatus.textContent = "ROM exported as PNG.";
  runtime.ui.mscStatus.style.color = "#6a9955";
}

function addPaletteColor(runtime: RuntimeState, color: string): void {
  const normalized = color.toLowerCase();
  if (runtime.palette.includes(normalized)) return;
  runtime.palette.push(normalized);
  renderPalette(runtime);
}

function updateEraserUi(runtime: RuntimeState): void {
  runtime.ui.eraserToggleButton.classList.toggle("is-active", runtime.eraserMode);
}

function setToolPreset(runtime: RuntimeState, brushSize: number, eraserMode: boolean): void {
  runtime.brushSize = sanitizeDimension(brushSize, 1);
  runtime.eraserMode = eraserMode;
  runtime.ui.brushSize.value = String(runtime.brushSize);
  runtime.ui.brushSizeLabel.textContent = `${runtime.brushSize}px`;
  updateEraserUi(runtime);
}

function updateHistoryButtons(runtime: RuntimeState): void {
  runtime.ui.undoButton.disabled = runtime.undoStack.length === 0;
  runtime.ui.redoButton.disabled = runtime.redoStack.length === 0;
}

function beginStroke(runtime: RuntimeState): void {
  if (!runtime.imageData) return;
  runtime.undoStack.push(new Uint8ClampedArray(runtime.imageData.data));
  if (runtime.undoStack.length > MAX_UNDO_HISTORY) {
    runtime.undoStack.shift();
  }
  runtime.redoStack = [];
  updateHistoryButtons(runtime);
}

function undoEdit(runtime: RuntimeState): void {
  if (!runtime.imageData) return;
  const previous = runtime.undoStack.pop();
  if (!previous) return;

  runtime.redoStack.push(new Uint8ClampedArray(runtime.imageData.data));
  applyImageSnapshot(runtime, previous);
  updateHistoryButtons(runtime);
}

function redoEdit(runtime: RuntimeState): void {
  if (!runtime.imageData) return;
  const next = runtime.redoStack.pop();
  if (!next) return;

  runtime.undoStack.push(new Uint8ClampedArray(runtime.imageData.data));
  applyImageSnapshot(runtime, next);
  updateHistoryButtons(runtime);
}

function clearImage(runtime: RuntimeState): void {
  if (!runtime.imageData) return;
  beginStroke(runtime);
  runtime.imageData.data.fill(0);
  runtime.baked = bake(runtime.imageData);
  renderPixelEditor(runtime);
  schedulePersistRom(runtime);
}

function applyImageSnapshot(runtime: RuntimeState, snapshot: Uint8ClampedArray): void {
  if (!runtime.imageData) return;
  if (snapshot.length !== runtime.imageData.data.length) return;

  runtime.imageData.data.set(snapshot);
  runtime.baked = bake(runtime.imageData);
  renderPixelEditor(runtime);
  schedulePersistRom(runtime);
}

function renderPalette(runtime: RuntimeState): void {
  const { paletteSwatches, pixelColor } = runtime.ui;
  paletteSwatches.innerHTML = "";

  for (const color of runtime.palette) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "palette-swatch";
    swatch.title = color;
    swatch.style.background = color;
    swatch.addEventListener("click", () => {
      pixelColor.value = color;
    });
    paletteSwatches.appendChild(swatch);
  }
}

function renderPixelEditor(runtime: RuntimeState): void {
  const { pixelEditor, pixelGridOverlay, pixelStage } = runtime.ui;
  if (!runtime.imageData) return;

  pixelEditor.width = runtime.imageData.width;
  pixelEditor.height = runtime.imageData.height;
  pixelGridOverlay.width = runtime.imageData.width;
  pixelGridOverlay.height = runtime.imageData.height;

  pixelEditor.style.width = `${runtime.imageData.width * runtime.zoom}px`;
  pixelEditor.style.height = `${runtime.imageData.height * runtime.zoom}px`;
  pixelGridOverlay.style.width = `${runtime.imageData.width * runtime.zoom}px`;
  pixelGridOverlay.style.height = `${runtime.imageData.height * runtime.zoom}px`;
  pixelStage.style.width = `${runtime.imageData.width * runtime.zoom}px`;
  pixelStage.style.height = `${runtime.imageData.height * runtime.zoom}px`;

  const ctx = pixelEditor.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(runtime.imageData, 0, 0);
  renderGridOverlay(runtime);
}

function drawPixel(runtime: RuntimeState, event: PointerEvent): void {
  const { imageData } = runtime;
  if (!imageData) return;

  const pos = getPixelPosition(runtime, event);
  if (!pos) return;
  const { x, y } = pos;

  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return;

  const [r, g, b] = hexToRgb(runtime.ui.pixelColor.value);
  const radius = Math.floor((runtime.brushSize - 1) / 2);

  for (let by = y - radius; by <= y + radius; by++) {
    for (let bx = x - radius; bx <= x + radius; bx++) {
      if (bx < 0 || by < 0 || bx >= imageData.width || by >= imageData.height) continue;
      const idx = (by * imageData.width + bx) * 4;
      if (runtime.eraserMode) {
        imageData.data[idx] = 0;
        imageData.data[idx + 1] = 0;
        imageData.data[idx + 2] = 0;
        imageData.data[idx + 3] = 0;
      } else {
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }
  }

  runtime.baked = bake(imageData);
  renderPixelEditor(runtime);
  schedulePersistRom(runtime);
}

function updatePixelCoordinates(runtime: RuntimeState, event: PointerEvent): void {
  const pos = getPixelPosition(runtime, event);
  if (!pos) return;
  runtime.ui.pixelCoords.textContent = `${pos.x}, ${pos.y}`;
}

function pickPixelColor(runtime: RuntimeState, event: PointerEvent): void {
  const { imageData } = runtime;
  if (!imageData) return;
  const pos = getPixelPosition(runtime, event);
  if (!pos) return;

  const idx = (pos.y * imageData.width + pos.x) * 4;
  const color = rgbToHex(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
  runtime.ui.pixelColor.value = color;
  addPaletteColor(runtime, color);
}

function getPixelPosition(runtime: RuntimeState, event: PointerEvent): { x: number; y: number } | null {
  const { imageData, ui } = runtime;
  if (!imageData) return null;

  const rect = ui.pixelEditor.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * imageData.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * imageData.height);
  return { x, y };
}

function renderGridOverlay(runtime: RuntimeState): void {
  const { imageData, ui } = runtime;
  if (!imageData) return;

  const ctx = ui.pixelGridOverlay.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, ui.pixelGridOverlay.width, ui.pixelGridOverlay.height);
  const inlineEnabled = ui.gridInlineToggle.checked;
  const customEnabled = ui.gridCustomToggle.checked;

  if (inlineEnabled) {
    drawGridLines(ctx, imageData.width, imageData.height, 1, "rgba(255,255,255,0.22)");
  }

  if (customEnabled) {
    const step = sanitizeDimension(Number(ui.gridSize.value), 8);
    const majorEvery = sanitizeDimension(Number(ui.gridMajor.value), 4);
    drawGridLines(ctx, imageData.width, imageData.height, step, "rgba(255,255,255,0.35)");
    drawGridLines(
      ctx,
      imageData.width,
      imageData.height,
      step * majorEvery,
      "rgba(255,255,255,0.55)"
    );
  }

  renderBakeDebugOverlay(runtime, ctx);
}

function renderBakeDebugOverlay(runtime: RuntimeState, ctx: CanvasRenderingContext2D): void {
  if (!runtime.baked) return;

  const showPoints = runtime.ui.debugPointsToggle.checked;
  const showIds = runtime.ui.debugIdsToggle.checked;
  const selectedCollision = runtime.selectedCollisionIndex;
  const selectedPath = runtime.selectedPathIndex;

  if (runtime.ui.debugCollisionToggle.checked) {
    runtime.baked.collisionPolygons.forEach((polygon, index) => {
      const isSelected = selectedCollision === index;
      const stroke =
        selectedCollision === null || isSelected
          ? "rgba(64,255,140,0.95)"
          : "rgba(64,255,140,0.35)";
      drawPolyline(ctx, polygon, stroke, true);
      if (showPoints) {
        drawPoints(ctx, polygon, stroke, isSelected ? 2 : 1);
      }
      if (showIds) {
        const anchor = polygonCentroid(polygon);
        drawOverlayLabel(
          ctx,
          `C${index}`,
          anchor.x,
          anchor.y,
          stroke,
          isSelected
        );
      }
    });
  }

  if (runtime.ui.debugPathToggle.checked) {
    runtime.baked.bezierPaths.forEach((path, index) => {
      const isSelected = selectedPath === index;
      const stroke =
        selectedPath === null || isSelected
          ? "rgba(255,190,64,0.95)"
          : "rgba(255,190,64,0.35)";
      drawPolyline(ctx, path, stroke, false);
      if (showPoints) {
        drawPoints(ctx, path, stroke, isSelected ? 2 : 1);
      }
      if (showIds && path.length > 0) {
        drawOverlayLabel(ctx, `P${index}`, path[0].x, path[0].y, stroke, isSelected);
      }
    });
  }
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  stroke: string,
  closePath: boolean
): void {
  if (points.length < 2) return;

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(points[0].x + 0.5, points[0].y + 0.5);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x + 0.5, points[i].y + 0.5);
  }
  if (closePath) {
    ctx.closePath();
  }
  ctx.stroke();
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  fill: string,
  radius = 1
): void {
  ctx.fillStyle = fill;
  for (const point of points) {
    const size = radius * 2 + 1;
    ctx.fillRect(point.x - radius, point.y - radius, size, size);
  }
}

function drawOverlayLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  strong = false
): void {
  ctx.save();
  ctx.font = strong ? "7px monospace" : "6px monospace";
  ctx.fillStyle = color;
  ctx.fillText(text, x + 1, y - 1);
  ctx.restore();
}

function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  return {
    x: sumX / points.length,
    y: sumY / points.length,
  };
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  step: number,
  stroke: string
): void {
  if (step <= 0) return;

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = step; x < width; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = step; y < height; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }

  ctx.stroke();
}

function selectDebugLayer(runtime: RuntimeState, event: PointerEvent): void {
  if (!runtime.baked) return;
  const pos = getPixelPosition(runtime, event);
  if (!pos) return;

  let bestType: "collision" | "path" | null = null;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  if (runtime.ui.debugCollisionToggle.checked) {
    runtime.baked.collisionPolygons.forEach((polygon, index) => {
      const distance = distanceToPolyline(pos, polygon, true);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestType = "collision";
        bestIndex = index;
      }
    });
  }

  if (runtime.ui.debugPathToggle.checked) {
    runtime.baked.bezierPaths.forEach((path, index) => {
      const distance = distanceToPolyline(pos, path, false);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestType = "path";
        bestIndex = index;
      }
    });
  }

  const threshold = 3.2;
  if (bestType && bestDistance <= threshold) {
    if (bestType === "collision") {
      runtime.selectedCollisionIndex = bestIndex;
      runtime.selectedPathIndex = null;
      runtime.ui.mscStatus.textContent = `Selected collision C${bestIndex}`;
    } else {
      runtime.selectedCollisionIndex = null;
      runtime.selectedPathIndex = bestIndex;
      runtime.ui.mscStatus.textContent = `Selected path P${bestIndex}`;
    }
    runtime.ui.mscStatus.style.color = "#6a9955";
  } else {
    runtime.selectedCollisionIndex = null;
    runtime.selectedPathIndex = null;
    runtime.ui.mscStatus.textContent = "Selection cleared.";
    runtime.ui.mscStatus.style.color = "#8f8f8f";
  }

  renderGridOverlay(runtime);
}

function distanceToPolyline(
  point: Point,
  polyline: Point[],
  closePath: boolean
): number {
  if (polyline.length === 0) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) {
    return Math.hypot(point.x - polyline[0].x, point.y - polyline[0].y);
  }

  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dist = pointToSegmentDistance(point, polyline[i], polyline[i + 1]);
    if (dist < minDistance) minDistance = dist;
  }

  if (closePath) {
    const tail = pointToSegmentDistance(point, polyline[polyline.length - 1], polyline[0]);
    if (tail < minDistance) minDistance = tail;
  }

  return minDistance;
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const apX = point.x - a.x;
  const apY = point.y - a.y;
  const abLenSq = abX * abX + abY * abY;

  if (abLenSq === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = Math.max(0, Math.min(1, (apX * abX + apY * abY) / abLenSq));
  const projX = a.x + abX * t;
  const projY = a.y + abY * t;
  return Math.hypot(point.x - projX, point.y - projY);
}

function schedulePersistRom(runtime: RuntimeState): void {
  if (runtime.persistTimer !== null) {
    window.clearTimeout(runtime.persistTimer);
  }
  runtime.persistTimer = window.setTimeout(() => {
    persistRom(runtime);
    runtime.persistTimer = null;
  }, 150);
}

function persistScript(scriptText: string): void {
  try {
    localStorage.setItem(LAST_SCRIPT_STORAGE_KEY, scriptText);
  } catch {}
}

function restoreLastScript(): string | null {
  try {
    return localStorage.getItem(LAST_SCRIPT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistRom(runtime: RuntimeState): void {
  if (!runtime.imageData) return;
  try {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = runtime.imageData.width;
    exportCanvas.height = runtime.imageData.height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.putImageData(runtime.imageData, 0, 0);
    const payload = {
      dataUrl: exportCanvas.toDataURL("image/png"),
      savedAt: Date.now(),
    };
    localStorage.setItem(LAST_ROM_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

async function restoreLastRom(runtime: RuntimeState): Promise<boolean> {
  try {
    const raw = localStorage.getItem(LAST_ROM_STORAGE_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw) as { dataUrl?: string };
    if (!parsed.dataUrl) return false;

    const imageData = await imageDataFromDataUrl(parsed.dataUrl);
    runtime.imageData = imageData;
    runtime.baked = bake(imageData);
    runtime.undoStack = [];
    runtime.redoStack = [];
    updateHistoryButtons(runtime);
    if (!runtime.scriptText) {
      runtime.scriptText = runtime.config.editor.defaultScript;
    }
    switchEditorMode(runtime, "script");
    renderPixelEditor(runtime);
    restart(runtime);
    runtime.ui.mscStatus.textContent = "Restored last ROM from memory.";
    runtime.ui.mscStatus.style.color = "#6a9955";
    return true;
  } catch {
    return false;
  }
}

async function imageDataFromDataUrl(dataUrl: string): Promise<ImageData> {
  const image = new Image();
  image.src = dataUrl;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to decode stored ROM image."));
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");

  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function hexToRgb(value: string): [number, number, number] {
  const clean = value.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function setEditorText(runtime: RuntimeState, text: string): void {
  runtime.ui.mscEditor.value = text;
  refreshHighlight(runtime);
  validateEditor(runtime);
}

function switchEditorMode(runtime: RuntimeState, mode: EditorMode): void {
  runtime.editorMode = mode;
  runtime.ui.textEditorTitle.textContent =
    mode === "script" ? "Script Editor (.msc)" : "Config Editor (JSON)";
  const text = mode === "script" ? runtime.scriptText : runtime.configText;
  setEditorText(runtime, text);
}

function refreshHighlight(runtime: RuntimeState): void {
  runtime.ui.mscHighlight.innerHTML =
    runtime.editorMode === "script"
      ? highlightMsc(runtime.ui.mscEditor.value)
      : highlightJson(runtime.ui.mscEditor.value);
}

function highlightMsc(source: string): string {
  let html = escapeHtml(source);
  html = html.replace(/^\s*#.*$/gm, (line) => `<span class="msc-comment">${line}</span>`);
  html = html.replace(/(["'][^"'\n]*["'])/g, '<span class="msc-string">$1</span>');
  html = html.replace(
    /^(\s*)(Entity\.[\w.]+|Source|Import|Schema|Events|Visual)(\s*:)/gm,
    '$1<span class="msc-keyword">$2</span>$3'
  );
  html = html.replace(/\$\w+/g, '<span class="msc-symbol">$&</span>');
  return html;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightJson(source: string): string {
  let html = escapeHtml(source);
  html = html.replace(/"([^"\\]|\\.)*"(?=\s*:)/g, '<span class="msc-keyword">$&</span>');
  html = html.replace(/:\s*"([^"\\]|\\.)*"/g, ': <span class="msc-string">"$1"</span>');
  html = html.replace(/\b(true|false|null)\b/g, '<span class="msc-symbol">$1</span>');
  html = html.replace(/\b-?\d+(?:\.\d+)?\b/g, '<span class="msc-symbol">$&</span>');
  return html;
}

function validateEditor(runtime: RuntimeState): void {
  if (runtime.editorMode === "script") {
    const scriptText = runtime.scriptText.trim();
    if (!scriptText) {
      runtime.ui.mscStatus.textContent =
        "No script loaded (engine runs with empty script).";
      runtime.ui.mscStatus.style.color = "#8f8f8f";
      return;
    }

    try {
      parseMsc(runtime.scriptText);
      runtime.ui.mscStatus.textContent = "Script parsed successfully.";
      runtime.ui.mscStatus.style.color = "#6a9955";
    } catch (error) {
      runtime.ui.mscStatus.textContent = `Parse error: ${String(error)}`;
      runtime.ui.mscStatus.style.color = "#d16969";
    }
    return;
  }

  try {
    JSON.parse(runtime.configText);
    runtime.ui.mscStatus.textContent = "Config JSON is valid.";
    runtime.ui.mscStatus.style.color = "#6a9955";
  } catch {
    runtime.ui.mscStatus.textContent = "Config JSON is invalid.";
    runtime.ui.mscStatus.style.color = "#d16969";
  }
}

function getScriptDocument(runtime: RuntimeState): MscDocument | null {
  const scriptText = runtime.scriptText.trim();
  if (!scriptText) return emptyScript();
  try {
    return parseMsc(runtime.scriptText);
  } catch {
    runtime.ui.mscStatus.textContent = "Fix script errors before restarting.";
    runtime.ui.mscStatus.style.color = "#d16969";
    return null;
  }
}

function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
}

function createBlankImageData(width: number, height: number, color: string): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = hexToRgb(color);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
}

function showPlaceholder(
  canvas: HTMLCanvasElement,
  line1: string,
  line2: string
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = 320;
  canvas.height = 240;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#aaa";
  ctx.font = "14px monospace";
  ctx.fillText(line1, 16, 24);
  ctx.fillText(line2, 16, 44);
}

function collectBindings(
  script: MscDocument | undefined
): Array<{ key: string; action: string }> {
  if (!script) return [];
  return Object.values(script.entities).flatMap((e) => e.inputs ?? []);
}

function emptyScript(): MscDocument {
  return { imports: [], schema: {}, entities: {}, events: [] };
}

main().catch(console.error);
