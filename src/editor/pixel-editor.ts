/**
 * Pixel Editor — Orchestrator
 *
 * Wires all editor modules together: camera, layers, tools,
 * input handling, palette, history, and grid overlay.
 *
 * External callers interact exclusively through the PixelEditor class.
 */

import type { BakedAsset } from "../engine/baker.js";
import type { MscDocument } from "../parser/msc.js";
import type {
  CameraState,
  ToolType,
  PointerInfo,
  BrushSettings,
  EditorConfig,
  SelectionRect,
  PressureMode,
} from "./types.js";
import { createCamera, setZoom } from "./camera.js";
import {
  initLayers,
  resizeLayers,
  renderBackground,
  renderDocument,
  clearDraft,
  mergeDraftToDocument,
  setMergeCamera,
  disposeLayers,
  type LayerStack,
} from "./layers.js";
import { getToolByType, type Tool, type ToolContext } from "./tools.js";
import { attachInputHandler, type InputHandler } from "./input-handler.js";
import {
  createPaletteState,
  getActiveColor,
  addColor,
  renderSwatches,
  loadPreset,
  getPresetNames,
  importHex,
  exportHex,
  importPal,
  exportPal,
  setColorName,
  updateColorHex,
  applyIndexedColorChange,
  type PaletteState,
} from "./palette.js";
import { HistoryManager } from "./history.js";
import { renderOverlay, selectDebugLayer, inspectPixelAt, type OverlayOptions } from "./grid-overlay.js";

// ── Public interfaces ─────────────────────────────────────────

/** DOM element references the orchestrator needs. */
export interface PixelEditorRefs {
  pixelStage: HTMLElement;
  pixelEditor: HTMLCanvasElement;
  pixelGridOverlay: HTMLCanvasElement;
  pixelColor: HTMLInputElement;
  paletteSwatches: HTMLElement;
  pixelZoom: HTMLInputElement;
  zoomLevel: HTMLElement;
  brushSize: HTMLInputElement;
  brushSizeLabel: HTMLElement;
  pixelCoords: HTMLElement;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  gridInlineToggle: HTMLInputElement;
  gridCustomToggle: HTMLInputElement;
  debugCollisionToggle: HTMLInputElement;
  debugPathToggle: HTMLInputElement;
  debugPointsToggle: HTMLInputElement;
  debugIdsToggle: HTMLInputElement;
  gridSize: HTMLInputElement;
  gridMajor: HTMLInputElement;
  mscStatus: HTMLElement;
  paletteAddButton: HTMLButtonElement;
  eraserToggleButton: HTMLButtonElement;
  presetPencilButton: HTMLButtonElement;
  presetBrushButton: HTMLButtonElement;
  presetEraserButton: HTMLButtonElement;
  // New UI elements (added in updated HTML)
  fillToolButton: HTMLButtonElement | null;
  selectToolButton: HTMLButtonElement | null;
  pipetteToolButton: HTMLButtonElement | null;
  stylusOnlyToggle: HTMLInputElement | null;
  pressureSizeToggle: HTMLInputElement | null;
  pressureDitherToggle: HTMLInputElement | null;
  palettePresetSelect: HTMLSelectElement | null;
  paletteImportButton: HTMLButtonElement | null;
  paletteExportButton: HTMLButtonElement | null;
  paletteUpdateButton: HTMLButtonElement | null;
}

/** Callbacks from the pixel editor back to the main app. */
export interface PixelEditorCallbacks {
  onBake: (imageData: ImageData) => BakedAsset;
  onPersist: () => void;
  onStatusMessage: (text: string, color: string) => void;
  /** Called when a palette slot's hex is replaced (for script text swap). */
  onColorChange?: (oldHex: string, newHex: string) => void;
  /** Called whenever the palette changes (for refreshing external displays). */
  onPaletteChange?: () => void;
}

// ── Orchestrator ──────────────────────────────────────────────

export class PixelEditor {
  private readonly refs: PixelEditorRefs;
  private readonly callbacks: PixelEditorCallbacks;

  // Sub-systems
  private layers: LayerStack | null = null;
  private inputHandler: InputHandler | null = null;
  private readonly history = new HistoryManager();
  private palette: PaletteState;
  private camera: CameraState = { x: 0, y: 0, zoom: 8 };

  // State
  private imageData: ImageData | null = null;
  private baked: BakedAsset | null = null;
  private activeTool: Tool;
  private brush: BrushSettings;
  private config: EditorConfig;
  private selection: SelectionRect | null = null;
  private selectedCollisionIndex: number | null = null;
  private selectedPathIndex: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** Engine state buffer reference for hot-reload live pixel sync. */
  private engineBuffer: Uint8ClampedArray | null = null;
  /** Active MSC script for the State Inspector tooltip. */
  private script: MscDocument | null = null;

  constructor(refs: PixelEditorRefs, callbacks: PixelEditorCallbacks) {
    this.refs = refs;
    this.callbacks = callbacks;

    this.activeTool = getToolByType(0 as ToolType);
    this.brush = {
      size: 1,
      pressureMode: "size",
      color: refs.pixelColor.value,
    };
    this.config = { stylusOnly: false, pressureMode: "size" };
    this.palette = createPaletteState([
      "#000000", "#ffffff", "#ff00ff", "#ff0000",
      "#00ff00", "#0000ff", "#ffff00", "#00ffff",
    ]);

    this.wireUiEvents();
  }

  // ── Public API ────────────────────────────────────────────

  /** Set the document image data (called when a ROM is loaded). */
  setImageData(imageData: ImageData): void {
    this.imageData = imageData;
    this.history.clear();
    this.updateHistoryButtons();

    const stage = this.refs.pixelStage;
    const viewW = stage.clientWidth || 256;
    const viewH = stage.clientHeight || 256;

    this.camera = createCamera(imageData.width, imageData.height, viewW, viewH);

    // Initialize layers on first use, or reinitialize if needed
    if (this.layers) {
      disposeLayers(this.layers);
      this.inputHandler?.dispose();
      this.layers = null;
      this.inputHandler = null;
    }

    this.layers = initLayers(
      stage,
      this.refs.pixelEditor,
      this.refs.pixelGridOverlay,
      imageData
    );
    setMergeCamera(this.camera);

    // Attach input handler to the draft layer (topmost interactive canvas)
    this.inputHandler = attachInputHandler(
      this.layers.draftCanvas,
      this.camera,
      this.config,
      {
        onToolDown: (info) => this.handleToolDown(info),
        onToolMove: (info) => this.handleToolMove(info),
        onToolUp: (info) => this.handleToolUp(info),
        onCameraChange: () => this.handleCameraChange(),
        onAltClick: (info) => this.handleAltClick(info),
      }
    );

    // Observe container resizes
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = new ResizeObserver(() => {
      if (this.layers) {
        resizeLayers(this.layers);
        this.renderAll();
      }
    });
    this.resizeObserver.observe(stage);

    this.syncZoomSlider();
    this.renderAll();
  }

  /** Update the baked asset (collision/path data for debug overlay). */
  setBaked(baked: BakedAsset | null): void {
    this.baked = baked;
    this.renderGridOverlay();
  }

  /**
   * Attach a live engine state buffer for hot-reload.
   * When a brush stroke ends, changed pixels are written directly to this
   * buffer so the running EngineLoop sees the update immediately.
   */
  setEngineBuffer(buffer: Uint8ClampedArray | null): void {
    this.engineBuffer = buffer;
  }

  /**
   * Set the active MSC script so the State Inspector tooltip can display
   * schema variable names and values while hovering over pixels.
   */
  setScript(script: MscDocument | null): void {
    this.script = script;
  }

  /** Re-render everything. */
  render(): void {
    this.renderAll();
  }

  /** Return a read-only snapshot of current palette colors. */
  getPaletteColors(): ReadonlyArray<import("./types.js").PaletteColor> {
    return this.palette.colors;
  }

  /** Undo the last edit. */
  undo(): void {
    if (!this.imageData) return;
    const snapshot = this.history.undo(this.imageData);
    if (!snapshot) return;
    this.applySnapshot(snapshot);
  }

  /** Redo the last undone edit. */
  redo(): void {
    if (!this.imageData) return;
    const snapshot = this.history.redo(this.imageData);
    if (!snapshot) return;
    this.applySnapshot(snapshot);
  }

  /** Clean up all event listeners and DOM elements. */
  dispose(): void {
    this.inputHandler?.dispose();
    this.resizeObserver?.disconnect();
    if (this.layers) {
      disposeLayers(this.layers);
    }
    this.layers = null;
    this.inputHandler = null;
    this.resizeObserver = null;
  }

  // ── Tool event handlers ──────────────────────────────────

  private handleToolDown(info: PointerInfo): void {
    if (!this.imageData || !this.layers) return;

    // Push undo snapshot before destructive operations
    const isFill = this.activeTool.type === (2 as ToolType);
    this.history.pushSnapshot(this.imageData);

    this.brush.color = getActiveColor(this.palette);

    const ctx = this.buildToolContext();
    this.activeTool.onDown(info, ctx);

    // Fill tool modifies imageData directly — bake immediately
    if (isFill) {
      this.baked = this.callbacks.onBake(this.imageData);
      this.renderAll();
      this.callbacks.onPersist();
    }

    // Update coords display
    this.refs.pixelCoords.textContent = `${Math.floor(info.docX)}, ${Math.floor(info.docY)}`;
  }

  private handleToolMove(info: PointerInfo): void {
    if (!this.imageData || !this.layers) return;

    const ctx = this.buildToolContext();
    this.activeTool.onMove(info, ctx);

    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);

    // State Inspector: show schema variable or raw RGBA in the coords label
    const bufWidth = this.imageData.width;
    const buf = this.engineBuffer ?? this.imageData.data as unknown as Uint8ClampedArray;
    const schema = this.script?.schema;
    const inspected = inspectPixelAt(docX, docY, bufWidth, buf, schema);
    this.refs.pixelCoords.textContent = `${docX}, ${docY}  ${inspected}`;
  }

  private handleToolUp(info: PointerInfo): void {
    if (!this.imageData || !this.layers) return;

    const ctx = this.buildToolContext();
    this.activeTool.onUp(info, ctx);

    // Merge draft layer into document imageData
    const isPipette = this.activeTool.type === (4 as ToolType);
    const isSelect = this.activeTool.type === (3 as ToolType);

    if (!isPipette && !isSelect) {
      const changed = mergeDraftToDocument(this.layers, this.imageData);
      if (changed) {
        // Hot reload: write changed pixels directly to the engine state buffer
        if (this.engineBuffer && this.engineBuffer.length >= this.imageData.data.length) {
          this.engineBuffer.set(this.imageData.data);
        }
        this.baked = this.callbacks.onBake(this.imageData);
        this.callbacks.onPersist();
      }
    }

    this.updateHistoryButtons();
    this.renderAll();
  }

  private handleCameraChange(): void {
    setMergeCamera(this.camera);
    this.syncZoomSlider();
    this.renderAll();
  }

  private handleAltClick(info: PointerInfo): void {
    if (!this.baked) return;
    const options = this.buildOverlayOptions();
    const result = selectDebugLayer(
      Math.floor(info.docX),
      Math.floor(info.docY),
      this.baked,
      options
    );

    if (result) {
      if (result.type === "collision") {
        this.selectedCollisionIndex = result.index;
        this.selectedPathIndex = null;
        this.callbacks.onStatusMessage(`Selected collision C${result.index}`, "#6a9955");
      } else {
        this.selectedCollisionIndex = null;
        this.selectedPathIndex = result.index;
        this.callbacks.onStatusMessage(`Selected path P${result.index}`, "#6a9955");
      }
    } else {
      this.selectedCollisionIndex = null;
      this.selectedPathIndex = null;
      this.callbacks.onStatusMessage("Selection cleared.", "#8f8f8f");
    }

    this.renderGridOverlay();
  }

  // ── Rendering ─────────────────────────────────────────────

  private renderAll(): void {
    if (!this.layers || !this.imageData) return;
    renderBackground(this.layers, this.camera);
    renderDocument(this.layers, this.camera, this.imageData);
    this.renderGridOverlay();
  }

  private renderGridOverlay(): void {
    if (!this.layers || !this.imageData) return;
    const options = this.buildOverlayOptions();
    renderOverlay(
      this.layers.gridCtx,
      this.camera,
      this.imageData.width,
      this.imageData.height,
      this.baked,
      options
    );
  }

  // ── Tool context builder ──────────────────────────────────

  private buildToolContext(): ToolContext {
    const layers = this.layers!;
    return {
      imageData: this.imageData!,
      draftCtx: layers.draftCtx,
      camera: this.camera,
      brush: this.brush,
      eraseBitmap: layers.eraseBitmap,
      eraseBitmapW: layers.eraseBitmapW,
      eraseBitmapH: layers.eraseBitmapH,
      onColorPicked: (hex) => this.handleColorPicked(hex),
      onSelectionChange: (rect) => { this.selection = rect; },
    };
  }

  private buildOverlayOptions(): OverlayOptions {
    const { refs } = this;
    return {
      inlineGrid: refs.gridInlineToggle.checked,
      customGrid: refs.gridCustomToggle.checked,
      gridSize: sanitizeDimension(Number(refs.gridSize.value), 8),
      gridMajor: sanitizeDimension(Number(refs.gridMajor.value), 4),
      showCollision: refs.debugCollisionToggle.checked,
      showPaths: refs.debugPathToggle.checked,
      showPoints: refs.debugPointsToggle.checked,
      showIds: refs.debugIdsToggle.checked,
      selectedCollisionIndex: this.selectedCollisionIndex,
      selectedPathIndex: this.selectedPathIndex,
    };
  }

  // ── Snapshot helpers ──────────────────────────────────────

  private applySnapshot(snapshot: Uint8ClampedArray): void {
    if (!this.imageData) return;
    if (snapshot.length !== this.imageData.data.length) return;
    this.imageData.data.set(snapshot);
    this.baked = this.callbacks.onBake(this.imageData);
    this.updateHistoryButtons();
    this.renderAll();
    this.callbacks.onPersist();
  }

  private updateHistoryButtons(): void {
    this.refs.undoButton.disabled = !this.history.canUndo;
    this.refs.redoButton.disabled = !this.history.canRedo;
  }

  // ── Color handling ────────────────────────────────────────

  private handleColorPicked(hex: string): void {
    this.refs.pixelColor.value = hex;
    addColor(this.palette, hex);
    this.brush.color = hex;
    // Set active index to the picked color
    const idx = this.palette.colors.findIndex((c) => c.hex === hex.toLowerCase());
    if (idx >= 0) this.palette.activeIndex = idx;
    this.renderPalette();
  }

  // ── Palette rendering ─────────────────────────────────────

  private renderPalette(): void {
    renderSwatches(
      this.palette,
      this.refs.paletteSwatches as HTMLElement,
      (index) => {
        this.palette.activeIndex = index;
        const color = getActiveColor(this.palette);
        this.refs.pixelColor.value = color;
        this.brush.color = color;
        this.renderPalette();
      },
      (index, e) => {
        // Right-click on swatch: remove color
        e.preventDefault();
        this.palette.colors.splice(index, 1);
        if (this.palette.activeIndex >= this.palette.colors.length) {
          this.palette.activeIndex = Math.max(0, this.palette.colors.length - 1);
        }
        this.renderPalette();
      },
      (index) => {
        // Double-click: rename the color slot
        const current = this.palette.colors[index]?.name ?? "";
        const newName = window.prompt("Name this color slot:", current);
        if (newName !== null) {
          setColorName(this.palette, index, newName);
          this.renderPalette();
        }
      }
    );
    this.callbacks.onPaletteChange?.();
  }

  // ── Tool switching ────────────────────────────────────────

  private setTool(type: ToolType): void {
    this.activeTool = getToolByType(type);
    if (this.layers) {
      clearDraft(this.layers);
    }
    this.updateToolButtonStates();
  }

  private updateToolButtonStates(): void {
    const { refs } = this;
    const type = this.activeTool.type;

    // Legacy buttons: pencil/brush/eraser map to draw=0 or erase=1
    refs.presetPencilButton.classList.toggle("is-active", type === (0 as ToolType) && this.brush.size === 1);
    refs.presetBrushButton.classList.toggle("is-active", type === (0 as ToolType) && this.brush.size > 1);
    refs.presetEraserButton.classList.toggle("is-active", type === (1 as ToolType));
    refs.eraserToggleButton.classList.toggle("is-active", type === (1 as ToolType));

    // New tool buttons (optional)
    refs.fillToolButton?.classList.toggle("is-active", type === (2 as ToolType));
    refs.selectToolButton?.classList.toggle("is-active", type === (3 as ToolType));
    refs.pipetteToolButton?.classList.toggle("is-active", type === (4 as ToolType));
  }

  // ── Zoom slider sync ──────────────────────────────────────

  private syncZoomSlider(): void {
    this.refs.pixelZoom.value = String(this.camera.zoom);
    this.refs.zoomLevel.textContent = `${this.camera.zoom}\u00d7`;
  }

  // ── UI event wiring ───────────────────────────────────────

  private wireUiEvents(): void {
    const { refs } = this;

    // Palette add
    refs.paletteAddButton.addEventListener("click", () => {
      addColor(this.palette, refs.pixelColor.value);
      this.brush.color = refs.pixelColor.value;
      this.renderPalette();
    });

    // Legacy tool buttons
    refs.presetPencilButton.addEventListener("click", () => {
      this.brush.size = 1;
      refs.brushSize.value = "1";
      refs.brushSizeLabel.textContent = "1";
      this.setTool(0 as ToolType);
    });
    refs.presetBrushButton.addEventListener("click", () => {
      this.brush.size = 3;
      refs.brushSize.value = "3";
      refs.brushSizeLabel.textContent = "3";
      this.setTool(0 as ToolType);
    });
    refs.presetEraserButton.addEventListener("click", () => {
      this.brush.size = 3;
      refs.brushSize.value = "3";
      refs.brushSizeLabel.textContent = "3";
      this.setTool(1 as ToolType);
    });
    refs.eraserToggleButton.addEventListener("click", () => {
      if (this.activeTool.type === (1 as ToolType)) {
        this.setTool(0 as ToolType);
      } else {
        this.setTool(1 as ToolType);
      }
    });

    // New tool buttons (null-safe)
    refs.fillToolButton?.addEventListener("click", () => {
      this.setTool(2 as ToolType);
    });
    refs.selectToolButton?.addEventListener("click", () => {
      this.setTool(3 as ToolType);
    });
    refs.pipetteToolButton?.addEventListener("click", () => {
      this.setTool(4 as ToolType);
    });

    // Undo / Redo / Clear
    refs.undoButton.addEventListener("click", () => this.undo());
    refs.redoButton.addEventListener("click", () => this.redo());
    refs.clearButton.addEventListener("click", () => {
      if (!this.imageData) return;
      this.history.pushSnapshot(this.imageData);
      this.imageData.data.fill(0);
      this.baked = this.callbacks.onBake(this.imageData);
      this.updateHistoryButtons();
      this.renderAll();
      this.callbacks.onPersist();
    });

    // Zoom slider
    refs.pixelZoom.addEventListener("input", () => {
      const newZoom = sanitizeDimension(Number(refs.pixelZoom.value), 8);
      setZoom(this.camera, newZoom);
      setMergeCamera(this.camera);
      this.syncZoomSlider();
      this.renderAll();
    });

    // Brush size slider
    refs.brushSize.addEventListener("input", () => {
      this.brush.size = sanitizeDimension(Number(refs.brushSize.value), 1);
      refs.brushSizeLabel.textContent = `${this.brush.size}`;
    });

    // Grid / debug overlay toggles — re-render overlay on change
    const overlayInputs = [
      refs.gridInlineToggle,
      refs.gridCustomToggle,
      refs.debugCollisionToggle,
      refs.debugPathToggle,
      refs.debugPointsToggle,
      refs.debugIdsToggle,
    ];
    for (const input of overlayInputs) {
      input.addEventListener("change", () => this.renderGridOverlay());
    }
    refs.gridSize.addEventListener("input", () => this.renderGridOverlay());
    refs.gridMajor.addEventListener("input", () => this.renderGridOverlay());

    // Stylus-only toggle (optional)
    refs.stylusOnlyToggle?.addEventListener("change", () => {
      this.config.stylusOnly = refs.stylusOnlyToggle!.checked;
    });

    // Pressure mode toggles (optional)
    refs.pressureSizeToggle?.addEventListener("change", () => {
      if (refs.pressureSizeToggle!.checked) {
        this.config.pressureMode = "size";
        this.brush.pressureMode = "size";
      }
    });
    refs.pressureDitherToggle?.addEventListener("change", () => {
      if (refs.pressureDitherToggle!.checked) {
        this.config.pressureMode = "dither";
        this.brush.pressureMode = "dither";
      }
    });

    // Palette preset dropdown (optional)
    if (refs.palettePresetSelect) {
      // Populate preset options
      const names = getPresetNames();
      for (const name of names) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        refs.palettePresetSelect.appendChild(opt);
      }
      refs.palettePresetSelect.addEventListener("change", () => {
        const name = refs.palettePresetSelect!.value;
        if (!name) return;
        const colors = loadPreset(name);
        if (colors) {
          this.palette.colors = colors;
          this.palette.activeIndex = 0;
          this.palette.activePreset = name;
          this.brush.color = getActiveColor(this.palette);
          refs.pixelColor.value = this.brush.color;
          this.renderPalette();
        }
      });
    }

    // Palette import/export (optional)
    refs.paletteImportButton?.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".hex,.pal,.txt";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        const ext = file.name.split(".").pop()?.toLowerCase();
        const colors = ext === "pal" ? importPal(text) : importHex(text);
        if (colors.length > 0) {
          this.palette.colors = colors;
          this.palette.activeIndex = 0;
          this.brush.color = getActiveColor(this.palette);
          refs.pixelColor.value = this.brush.color;
          this.renderPalette();
          this.callbacks.onStatusMessage(`Imported ${colors.length} colors.`, "#6a9955");
        }
      });
      input.click();
    });

    refs.paletteExportButton?.addEventListener("click", () => {
      const text = exportHex(this.palette);
      const blob = new Blob([text], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "palette.hex";
      link.click();
      URL.revokeObjectURL(link.href);
      this.callbacks.onStatusMessage("Palette exported.", "#6a9955");
    });

    // Palette Update: apply color picker value to the active palette slot,
    // perform indexed color swap on image, and notify script editor
    refs.paletteUpdateButton?.addEventListener("click", () => {
      if (!this.imageData) return;
      const newHex = refs.pixelColor.value;
      const oldHex = updateColorHex(this.palette, this.palette.activeIndex, newHex);
      if (oldHex !== null) {
        this.history.pushSnapshot(this.imageData);
        applyIndexedColorChange(this.imageData, oldHex, newHex);
        this.baked = this.callbacks.onBake(this.imageData);
        this.callbacks.onColorChange?.(oldHex, newHex);
        this.callbacks.onPersist();
        this.renderAll();
        this.renderPalette();
        this.callbacks.onStatusMessage(
          `Updated slot: ${oldHex} → ${newHex}`,
          "#6a9955"
        );
      }
    });

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;

      // Ctrl+Z / Ctrl+Y — undo/redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        this.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        this.redo();
        return;
      }

      // Tool shortcuts
      switch (e.key.toLowerCase()) {
        case "b": this.setTool(0 as ToolType); break;
        case "e": this.setTool(1 as ToolType); break;
        case "g": this.setTool(2 as ToolType); break;
        case "m": this.setTool(3 as ToolType); break;
        case "i": this.setTool(4 as ToolType); break;
      }
    });

    // Color picker change
    refs.pixelColor.addEventListener("input", () => {
      this.brush.color = refs.pixelColor.value;
    });

    // Initial palette render
    this.renderPalette();
    this.updateToolButtonStates();
    this.updateHistoryButtons();
  }
}

// ── Helpers ───────────────────────────────────────────────────

function sanitizeDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(512, Math.max(1, Math.floor(value)));
}
