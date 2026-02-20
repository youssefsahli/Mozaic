/**
 * Mozaic Engine — Entry Point
 *
 * Bootstraps the engine against the #mozaic-canvas element.
 * A SpriteROM is loaded by passing the image URL as the `src` query
 * parameter:  ?src=level_1.mzk
 */

import { loadAsset } from "./engine/loader.js";
import { bake, type BakedAsset } from "./engine/baker.js";
import { Renderer } from "./engine/renderer.js";
import { InputManager } from "./engine/input.js";
import {
  EngineLoop,
  createInitialState,
  identityLogic,
} from "./engine/loop.js";
import { parseMsc, type MscDocument } from "./parser/msc.js";
import { PixelEditor, type PixelEditorRefs } from "./editor/pixel-editor.js";

type EditorMode = "script" | "config";
const LAST_ROM_STORAGE_KEY = "mozaic:last-rom";
const LAST_SCRIPT_STORAGE_KEY = "mozaic:last-script";

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
  config: MozaicConfig;
  scriptText: string;
  configText: string;
  editorMode: EditorMode;
  persistTimer: number | null;
  pixelEditor: PixelEditor | null;
  docsVisible: boolean;
  docsEntries: DocEntry[];
  docsFiltered: DocEntry[];
  selectedDocId: string | null;
  activeTab: string;
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
    config: DEFAULT_CONFIG,
    scriptText: "",
    configText: JSON.stringify(DEFAULT_CONFIG, null, 2),
    editorMode: "script",
    persistTimer: null,
    pixelEditor: null,
    docsVisible: false,
    docsEntries: [],
    docsFiltered: [],
    selectedDocId: null,
    activeTab: "script",
  };

  // Create the pixel editor orchestrator
  const editorRefs = getEditorRefs(ui);
  runtime.pixelEditor = new PixelEditor(editorRefs, {
    onBake: (imageData) => bake(imageData),
    onPersist: () => schedulePersistRom(runtime),
    onStatusMessage: (text, color) => {
      ui.mscStatus.textContent = text;
      ui.mscStatus.style.color = color;
    },
  });

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

    // Load default Amiga-style ROM
    runtime.imageData = createAmigaStyleRom();
    runtime.baked = bake(runtime.imageData);
    runtime.scriptText = runtime.config.editor.defaultScript;
    switchEditorMode(runtime, "script");
    initPixelEditor(runtime);
    restart(runtime);

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
    pixelCoords: requiredElement<HTMLSpanElement>("pixel-coords"),
    docsPane: requiredElement<HTMLDivElement>("docs-pane"),
    docsSearch: requiredElement<HTMLInputElement>("docs-search"),
    docsResults: requiredElement<HTMLDivElement>("docs-results"),
    docsContent: requiredElement<HTMLDivElement>("docs-content"),
  };
}

/** Build PixelEditorRefs from the DOM. New elements use optional getElementById. */
function getEditorRefs(ui: UiRefs): PixelEditorRefs {
  return {
    pixelStage: requiredElement<HTMLDivElement>("pixel-stage"),
    pixelEditor: requiredElement<HTMLCanvasElement>("pixel-editor"),
    pixelGridOverlay: requiredElement<HTMLCanvasElement>("pixel-grid-overlay"),
    pixelColor: requiredElement<HTMLInputElement>("pixel-color"),
    paletteSwatches: requiredElement<HTMLDivElement>("palette-swatches"),
    pixelZoom: requiredElement<HTMLInputElement>("pixel-zoom"),
    zoomLevel: requiredElement<HTMLSpanElement>("zoom-level"),
    brushSize: requiredElement<HTMLInputElement>("brush-size"),
    brushSizeLabel: requiredElement<HTMLSpanElement>("brush-size-label"),
    pixelCoords: ui.pixelCoords,
    undoButton: requiredElement<HTMLButtonElement>("undo-button"),
    redoButton: requiredElement<HTMLButtonElement>("redo-button"),
    clearButton: requiredElement<HTMLButtonElement>("clear-button"),
    gridInlineToggle: requiredElement<HTMLInputElement>("grid-inline-toggle"),
    gridCustomToggle: requiredElement<HTMLInputElement>("grid-custom-toggle"),
    debugCollisionToggle: requiredElement<HTMLInputElement>("debug-collision-toggle"),
    debugPathToggle: requiredElement<HTMLInputElement>("debug-path-toggle"),
    debugPointsToggle: requiredElement<HTMLInputElement>("debug-points-toggle"),
    debugIdsToggle: requiredElement<HTMLInputElement>("debug-ids-toggle"),
    gridSize: requiredElement<HTMLInputElement>("grid-size"),
    gridMajor: requiredElement<HTMLInputElement>("grid-major"),
    mscStatus: ui.mscStatus,
    paletteAddButton: requiredElement<HTMLButtonElement>("palette-add-button"),
    eraserToggleButton: requiredElement<HTMLButtonElement>("eraser-toggle-button"),
    presetPencilButton: requiredElement<HTMLButtonElement>("preset-pencil-button"),
    presetBrushButton: requiredElement<HTMLButtonElement>("preset-brush-button"),
    presetEraserButton: requiredElement<HTMLButtonElement>("preset-eraser-button"),
    // New elements (optional — null if not in DOM)
    fillToolButton: document.getElementById("fill-tool-button") as HTMLButtonElement | null,
    selectToolButton: document.getElementById("select-tool-button") as HTMLButtonElement | null,
    pipetteToolButton: document.getElementById("pipette-tool-button") as HTMLButtonElement | null,
    stylusOnlyToggle: document.getElementById("stylus-only-toggle") as HTMLInputElement | null,
    pressureSizeToggle: document.getElementById("pressure-size-toggle") as HTMLInputElement | null,
    pressureDitherToggle: document.getElementById("pressure-dither-toggle") as HTMLInputElement | null,
    palettePresetSelect: document.getElementById("palette-preset-select") as HTMLSelectElement | null,
    paletteImportButton: document.getElementById("palette-import-button") as HTMLButtonElement | null,
    paletteExportButton: document.getElementById("palette-export-button") as HTMLButtonElement | null,
  };
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id) as T | null;
  if (!element) throw new Error(`Element #${id} not found`);
  return element;
}

/** Initialize the pixel editor with the current imageData. */
function initPixelEditor(runtime: RuntimeState): void {
  if (!runtime.imageData || !runtime.pixelEditor) return;
  runtime.pixelEditor.setImageData(runtime.imageData);
  if (runtime.baked) {
    runtime.pixelEditor.setBaked(runtime.baked);
  }
}

function wireUi(runtime: RuntimeState): void {
  const { ui } = runtime;

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
  ui.saveRomButton.addEventListener("click", () => {
    saveRom(runtime);
  });
  ui.reloadConfigButton.addEventListener("click", async () => {
    await reloadConfig(runtime);
  });
  ui.restartButton.addEventListener("click", () => {
    restart(runtime);
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

  ui.docsSearch.addEventListener("input", () => {
    filterDocs(runtime, ui.docsSearch.value);
  });

  // Wire tab buttons
  document.querySelectorAll<HTMLButtonElement>("#tab-bar .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;
      if (tabId) switchTab(runtime, tabId);
    });
  });

  // Wire split handle for resizable split screen
  const splitHandle = document.getElementById("split-handle");
  const canvasArea = document.getElementById("canvas-area");
  const sidePanel = document.getElementById("side-panel");

  if (splitHandle && canvasArea && sidePanel) {
    let isDragging = false;

    splitHandle.addEventListener("pointerdown", (e) => {
      isDragging = true;
      splitHandle.classList.add("is-dragging");
      splitHandle.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    window.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const workspace = document.getElementById("mozaic-workspace");
      if (!workspace) return;
      const rect = workspace.getBoundingClientRect();
      const handleW = splitHandle.offsetWidth;
      const x = e.clientX - rect.left;
      const minLeft = 200;
      const minRight = 280;
      const maxLeft = rect.width - minRight - handleW;
      const clampedX = Math.max(minLeft, Math.min(maxLeft, x));

      canvasArea.style.flex = "none";
      canvasArea.style.width = `${clampedX}px`;
      sidePanel.style.width = `${rect.width - clampedX - handleW}px`;
    });

    window.addEventListener("pointerup", () => {
      if (!isDragging) return;
      isDragging = false;
      splitHandle.classList.remove("is-dragging");
      document.body.style.userSelect = "";
    });
  }

  renderDocsPaneState(runtime);

  // Auto-resize game canvas when canvas-area changes size
  const canvasContainer = ui.canvas.parentElement;
  if (canvasContainer) {
    new ResizeObserver(() => resizeGameCanvas(ui)).observe(canvasContainer);
  }
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
  runtime.ui.toggleDocsButton.classList.toggle("is-active", runtime.docsVisible);
  if (runtime.docsVisible && runtime.activeTab !== "docs") {
    switchTab(runtime, "docs");
  }
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

  if (asset.scriptText !== undefined) {
    runtime.scriptText = asset.scriptText;
  } else {
    runtime.scriptText = runtime.config.editor.defaultScript;
  }
  persistScript(runtime.scriptText);

  switchEditorMode(runtime, "script");
  initPixelEditor(runtime);
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
  resizeGameCanvas(ui);
}

function createNewRom(runtime: RuntimeState): void {
  const { newRomWidth, newRomHeight, newRomColor } = runtime.config.game;
  runtime.imageData = createBlankImageData(newRomWidth, newRomHeight, newRomColor);
  runtime.baked = bake(runtime.imageData);
  runtime.scriptText = runtime.config.editor.defaultScript;
  persistScript(runtime.scriptText);
  switchEditorMode(runtime, "script");
  initPixelEditor(runtime);
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

  // Clear any stale inline display styles from old layout
  ui.mscSection.style.display = "";
  ui.pixelSection.style.display = "";

  // Show/hide tab buttons based on config
  const scriptTabBtn = document.querySelector<HTMLButtonElement>('[data-tab="script"]');
  const pixelTabBtn = document.querySelector<HTMLButtonElement>('[data-tab="pixel"]');

  if (scriptTabBtn) {
    scriptTabBtn.hidden = !config.editor.showScriptEditor;
  }
  if (!config.editor.showScriptEditor && runtime.activeTab === "script") {
    switchTab(runtime, "pixel");
  }

  if (pixelTabBtn) {
    pixelTabBtn.hidden = !config.editor.showPixelEditor;
  }
  if (!config.editor.showPixelEditor && runtime.activeTab === "pixel") {
    switchTab(runtime, "script");
  }

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
    if (!runtime.scriptText) {
      runtime.scriptText = runtime.config.editor.defaultScript;
    }
    switchEditorMode(runtime, "script");
    initPixelEditor(runtime);
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

function createAmigaStyleRom(): ImageData {
  const w = 64, h = 64;
  const data = new Uint8ClampedArray(w * h * 4);

  function set(x: number, y: number, r: number, g: number, b: number): void {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }

  function fill(fx: number, fy: number, fw: number, fh: number, r: number, g: number, b: number): void {
    for (let dy = 0; dy < fh; dy++)
      for (let dx = 0; dx < fw; dx++)
        set(fx + dx, fy + dy, r, g, b);
  }

  // Background gradient (dark navy to slightly lighter)
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const br = Math.round(12 + t * 10);
    const bg = Math.round(12 + t * 10);
    const bb = Math.round(30 + t * 18);
    for (let x = 0; x < w; x++) set(x, y, br, bg, bb);
  }

  // Subtle grid lines (Amiga Boing Ball demo grid feel)
  for (let x = 0; x < w; x += 8) {
    for (let y = 0; y < h; y++) set(x, y, 18, 18, 42);
  }

  // Classic Amiga colored bars (white, red, green, blue)
  const bx = 8, bw = 48;
  fill(bx, 20, bw, 3, 255, 255, 255);   // White
  fill(bx, 25, bw, 3, 255, 68, 0);      // Red-orange
  fill(bx, 30, bw, 3, 0, 204, 85);      // Green
  fill(bx, 35, bw, 3, 0, 68, 255);      // Blue

  // Accent diamond at bottom center
  const cx = 31, cy = 50;
  set(cx, cy - 2, 85, 187, 153);
  set(cx - 1, cy - 1, 85, 187, 153);
  set(cx, cy - 1, 85, 187, 153);
  set(cx + 1, cy - 1, 85, 187, 153);
  set(cx - 2, cy, 85, 187, 153);
  set(cx - 1, cy, 85, 187, 153);
  set(cx, cy, 85, 187, 153);
  set(cx + 1, cy, 85, 187, 153);
  set(cx + 2, cy, 85, 187, 153);
  set(cx - 1, cy + 1, 85, 187, 153);
  set(cx, cy + 1, 85, 187, 153);
  set(cx + 1, cy + 1, 85, 187, 153);
  set(cx, cy + 2, 85, 187, 153);

  return new ImageData(data, w, h);
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

  const area = canvas.parentElement;
  if (area) {
    const availW = area.clientWidth - 16;
    const availH = area.clientHeight - 16;
    if (availW > 0 && availH > 0) {
      const scale = Math.max(1, Math.floor(Math.min(availW / canvas.width, availH / canvas.height)));
      canvas.style.width = `${canvas.width * scale}px`;
      canvas.style.height = `${canvas.height * scale}px`;
    }
  }
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

function switchTab(runtime: RuntimeState, tabId: string): void {
  runtime.activeTab = tabId;

  document.querySelectorAll<HTMLButtonElement>("#tab-bar .tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tabId);
  });

  const tabToPaneId: Record<string, string> = {
    script: "msc-section",
    pixel: "pixel-section",
    debug: "pane-debug",
    docs: "docs-pane",
  };

  document.querySelectorAll<HTMLElement>("#tab-content .tab-pane").forEach((pane) => {
    pane.classList.remove("is-active");
  });

  const targetPane = document.getElementById(tabToPaneId[tabId]);
  if (targetPane) {
    targetPane.classList.add("is-active");
  }

  runtime.docsVisible = tabId === "docs";
}

function resizeGameCanvas(ui: UiRefs): void {
  const area = ui.canvas.parentElement;
  if (!area) return;
  const romW = ui.canvas.width;
  const romH = ui.canvas.height;
  if (romW === 0 || romH === 0) return;

  const availW = area.clientWidth - 16;
  const availH = area.clientHeight - 16;
  if (availW <= 0 || availH <= 0) return;

  const scale = Math.max(1, Math.floor(Math.min(availW / romW, availH / romH)));
  ui.canvas.style.width = `${romW * scale}px`;
  ui.canvas.style.height = `${romH * scale}px`;
}

main().catch(console.error);
