/**
 * Pixel Editor — Orchestrator
 *
 * Central controller that wires together all pixel editor subsystems:
 * - **Camera** — pan/zoom viewport with smooth interpolation
 * - **Layers** — background, document, draft, and grid overlay canvases
 * - **Tools** — draw, erase, fill, select, and pipette strategies
 * - **Input** — mouse, touch, and pressure-sensitive stylus handling
 * - **Palette** — indexed color management with preset library
 * - **History** — undo/redo stack with snapshot compression
 * - **Grid Overlay** — pixel grid, collision polygons, and path visualization
 *
 * ## Architecture Notes
 *
 * The editor uses a multi-canvas layered approach:
 * 1. Background canvas — renders the transparency checkerboard
 * 2. Document canvas — displays the current ROM pixel data
 * 3. Draft canvas — temporary drawing strokes before commit
 * 4. Grid overlay canvas — debug visualization layer
 *
 * When a stroke completes, the draft layer is merged into the document
 * ImageData. If an engine is running, changed pixels are hot-reloaded
 * directly into the engine's state buffer for instant feedback.
 *
 * ## Key Shortcuts
 *
 * | Key    | Action                |
 * |--------|-----------------------|
 * | B      | Pencil / Draw tool    |
 * | E      | Eraser tool           |
 * | G      | Flood fill tool       |
 * | M      | Selection tool        |
 * | I      | Pipette / eyedropper  |
 * | Ctrl+Z | Undo                  |
 * | Ctrl+Y | Redo                  |
 * | Alt+Click | Pick debug layer   |
 *
 * External callers interact exclusively through the PixelEditor class.
 */

import type { BakedAsset } from "../engine/baker.js";
import type { MscDocument, MscEntity } from "../parser/msc.js";
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
import { getToolByType, type Tool, type ToolContext, copySelection, clearSelection, pasteClipboard, type ClipboardBuffer } from "./tools.js";
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
  layerEcsToggle: HTMLInputElement;
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
  paletteImportButton: HTMLButtonElement | null;
  paletteExportButton: HTMLButtonElement | null;
  paletteUpdateButton: HTMLButtonElement | null;
  entityBrushButton: HTMLButtonElement | null;
  resizePixelButton: HTMLButtonElement | null;
  // Menu bar elements
  pxMenuImportImg: HTMLButtonElement | null;
  pxMenuUndo: HTMLButtonElement | null;
  pxMenuRedo: HTMLButtonElement | null;
  pxMenuClear: HTMLButtonElement | null;
  pxMenuCopy: HTMLButtonElement | null;
  pxMenuCut: HTMLButtonElement | null;
  pxMenuPaste: HTMLButtonElement | null;
  pxMenuSelectAll: HTMLButtonElement | null;
  pxMenuDeselect: HTMLButtonElement | null;
  pxActiveColorHex: HTMLElement | null;
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
  /** Called when the entity brush places an entity. */
  onEntityPlace?: (entityType: string, docX: number, docY: number) => void;
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
  private clipboard: ClipboardBuffer | null = null;
  private entityDefs: Record<string, MscEntity> = {};
  private activeEntityType: string | null = null;
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
    // Update entity definitions from script
    this.entityDefs = script?.entities ?? {};
    if (this.activeEntityType && !this.entityDefs[this.activeEntityType]) {
      this.activeEntityType = Object.keys(this.entityDefs)[0] ?? null;
    }
  }

  /** Re-render everything. */
  render(): void {
    this.renderAll();
  }

  /** Return a read-only snapshot of current palette colors. */
  getPaletteColors(): ReadonlyArray<import("./types.js").PaletteColor> {
    return this.palette.colors;
  }

  /** Load a palette preset by name. */
  loadPalettePreset(name: string): void {
    const colors = loadPreset(name);
    if (colors) {
      this.palette.colors = colors;
      this.palette.activeIndex = 0;
      this.palette.activePreset = name;
      this.brush.color = getActiveColor(this.palette);
      this.refs.pixelColor.value = this.brush.color;
      this.renderPalette();
    }
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

  /** Resize the document canvas to new dimensions, copying existing pixels. */
  resizeCanvas(newW: number, newH: number): void {
    if (!this.imageData || newW <= 0 || newH <= 0) return;
    const old = this.imageData;
    const resized = new ImageData(newW, newH);
    const copyW = Math.min(old.width, newW);
    const copyH = Math.min(old.height, newH);
    for (let y = 0; y < copyH; y++) {
      const srcOff = y * old.width * 4;
      const dstOff = y * newW * 4;
      resized.data.set(old.data.subarray(srcOff, srcOff + copyW * 4), dstOff);
    }
    this.setImageData(resized);
    this.baked = this.callbacks.onBake(this.imageData!);
    this.callbacks.onPersist();
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
    const isEntityBrush = this.activeTool.type === (5 as ToolType);

    let changed = false;

    if (!isPipette && !isSelect && !isEntityBrush) {
      changed = mergeDraftToDocument(this.layers, this.imageData);
    } else if (isEntityBrush) {
      // The entity brush mutates the stateBuffer directly during onDown/onUp.
      // We must flag it as changed so it persists to the file system.
      changed = true;
      // We also need to force the layers to re-put the image data
      // so the newly altered memory pixels show up on the document canvas.
      this.layers.docCtx.putImageData(this.imageData, 0, 0);
    }

    if (changed) {
      if (this.engineBuffer && this.engineBuffer.length >= this.imageData.data.length) {
        this.engineBuffer.set(this.imageData.data);
      }
      this.baked = this.callbacks.onBake(this.imageData);
      this.callbacks.onPersist();
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
    this.renderSelectionOverlay();
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
      options,
      this.engineBuffer ?? this.imageData.data as Uint8ClampedArray
    );
  }

  /** Redraw the selection rectangle on the draft canvas at current camera coordinates. */
  private renderSelectionOverlay(): void {
    if (!this.layers || !this.selection) return;
    const { draftCtx, width, height } = this.layers;
    const { camera, selection } = this;

    draftCtx.clearRect(0, 0, width, height);

    const sx = (selection.x - camera.x) * camera.zoom;
    const sy = (selection.y - camera.y) * camera.zoom;
    const sw = selection.w * camera.zoom;
    const sh = selection.h * camera.zoom;

    draftCtx.strokeStyle = "rgba(85,187,153,0.8)";
    draftCtx.lineWidth = 1;
    draftCtx.setLineDash([4, 4]);
    draftCtx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
    draftCtx.setLineDash([]);

    draftCtx.fillStyle = "rgba(85,187,153,0.1)";
    draftCtx.fillRect(sx, sy, sw, sh);
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
      entityDefs: this.entityDefs,
      activeEntityType: this.activeEntityType,
      activeEntityTypeId: this.resolveEntityTypeId(),
      stateBuffer: this.engineBuffer ?? this.imageData?.data ?? null,
      onEntityPlace: (entityType, docX, docY) => {
        this.callbacks.onEntityPlace?.(entityType, docX, docY);
      },
    };
  }

  /**
   * Resolve the active entity type name to a 1-based numeric type ID.
   * Entity type IDs correspond to `Object.keys(entityDefs)` order (1-based).
   */
  private resolveEntityTypeId(): number {
    if (!this.activeEntityType) return 0;
    const idx = Object.keys(this.entityDefs).indexOf(this.activeEntityType);
    return idx === -1 ? 0 : idx + 1;
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
      showEcs: refs.layerEcsToggle.checked,
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
    if (this.refs.pxActiveColorHex) this.refs.pxActiveColorHex.textContent = hex;
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
        if (this.refs.pxActiveColorHex) this.refs.pxActiveColorHex.textContent = color;
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
    if (type !== (3 as ToolType)) {
      this.selection = null;
    }
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
    refs.entityBrushButton?.classList.toggle("is-active", type === (5 as ToolType));
  }

  // ── Zoom slider sync ──────────────────────────────────────

  private syncZoomSlider(): void {
    this.refs.pixelZoom.value = String(this.camera.zoom);
    this.refs.zoomLevel.textContent = `${this.camera.zoom}\u00d7`;
  }

  // ── Menu bar management ───────────────────────────────────

  private wireMenuBar(): void {
    // Position and open a dropdown below its trigger
    const openDropdown = (trigger: HTMLElement, dropdown: Element) => {
      const rect = trigger.getBoundingClientRect();
      const dd = dropdown as HTMLElement;
      dd.style.top = `${rect.bottom + 2}px`;
      // Clamp to viewport right edge
      const left = Math.min(rect.left, window.innerWidth - 190);
      dd.style.left = `${Math.max(0, left)}px`;
      dd.classList.add("is-open");
      trigger.classList.add("is-open");
    };

    // Close all dropdowns
    const closeAll = () => {
      document.querySelectorAll(".px-menu-dropdown.is-open").forEach((d) =>
        d.classList.remove("is-open")
      );
      document.querySelectorAll(".px-menu-trigger.is-open").forEach((t) =>
        t.classList.remove("is-open")
      );
    };

    // Toggle a specific menu
    document.querySelectorAll(".px-menu-trigger").forEach((trigger) => {
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const dropdown = (trigger as HTMLElement).nextElementSibling;
        const isOpen = dropdown?.classList.contains("is-open");
        closeAll();
        if (!isOpen && dropdown) {
          openDropdown(trigger as HTMLElement, dropdown);
        }
      });
    });

    // Hovering over another trigger while one menu is open should switch
    document.querySelectorAll(".px-menu-trigger").forEach((trigger) => {
      trigger.addEventListener("mouseenter", () => {
        const anyOpen = document.querySelector(".px-menu-dropdown.is-open");
        if (anyOpen) {
          closeAll();
          const dropdown = (trigger as HTMLElement).nextElementSibling;
          if (dropdown) {
            openDropdown(trigger as HTMLElement, dropdown);
          }
        }
      });
    });

    // Close menus on outside click
    document.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest(".px-menu-anchor")) {
        closeAll();
      }
    });

    // Close menus when a menu item is clicked
    document.querySelectorAll(".px-menu-item").forEach((item) => {
      item.addEventListener("click", () => closeAll());
    });
  }

  // ── UI event wiring ───────────────────────────────────────

  private wireUiEvents(): void {
    const { refs } = this;

    // Wire up the menu bar
    this.wireMenuBar();

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
    refs.entityBrushButton?.addEventListener("click", () => {
      // Default to first entity type if none selected
      if (!this.activeEntityType && Object.keys(this.entityDefs).length > 0) {
        this.activeEntityType = Object.keys(this.entityDefs)[0];
      }
      this.setTool(5 as ToolType);
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
      refs.layerEcsToggle,
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

    /* Palette preset selection moved to modal */

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
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;

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

      // Ctrl+C — copy selection
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        if (this.selection && this.imageData) {
          e.preventDefault();
          this.clipboard = copySelection(this.imageData, this.selection);
        }
        return;
      }

      // Ctrl+X — cut selection
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        if (this.selection && this.imageData) {
          e.preventDefault();
          this.clipboard = copySelection(this.imageData, this.selection);
          this.history.pushSnapshot(this.imageData);
          clearSelection(this.imageData, this.selection);
          this.baked = this.callbacks.onBake(this.imageData);
          this.callbacks.onPersist();
          this.renderAll();
          this.updateHistoryButtons();
        }
        return;
      }

      // Ctrl+V — paste at selection origin (or top-left)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        if (this.clipboard && this.imageData) {
          e.preventDefault();
          this.history.pushSnapshot(this.imageData);
          const destX = this.selection?.x ?? 0;
          const destY = this.selection?.y ?? 0;
          pasteClipboard(this.imageData, this.clipboard, destX, destY);
          this.baked = this.callbacks.onBake(this.imageData);
          this.callbacks.onPersist();
          this.renderAll();
          this.updateHistoryButtons();
        }
        return;
      }

      // Ctrl+A — select all
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (this.imageData) {
          e.preventDefault();
          this.selectAll();
        }
        return;
      }

      // Escape — deselect
      if (e.key === "Escape") {
        if (this.selection) {
          this.deselect();
          return;
        }
      }

      // Tool shortcuts
      switch (e.key.toLowerCase()) {
        case "b": this.setTool(0 as ToolType); break;
        case "e": this.setTool(1 as ToolType); break;
        case "g": this.setTool(2 as ToolType); break;
        case "m": this.setTool(3 as ToolType); break;
        case "i": this.setTool(4 as ToolType); break;
        case "n": this.setTool(5 as ToolType); break;
      }
    });

    // Color picker change
    refs.pixelColor.addEventListener("input", () => {
      this.brush.color = refs.pixelColor.value;
      refs.pxActiveColorHex?.textContent !== undefined &&
        (refs.pxActiveColorHex!.textContent = refs.pixelColor.value);
    });

    // Menu bar: Edit menu items
    refs.pxMenuUndo?.addEventListener("click", () => this.undo());
    refs.pxMenuRedo?.addEventListener("click", () => this.redo());
    refs.pxMenuClear?.addEventListener("click", () => {
      if (!this.imageData) return;
      this.history.pushSnapshot(this.imageData);
      this.imageData.data.fill(0);
      this.baked = this.callbacks.onBake(this.imageData);
      this.updateHistoryButtons();
      this.renderAll();
      this.callbacks.onPersist();
    });

    // Menu bar: Selection menu items
    refs.pxMenuCopy?.addEventListener("click", () => {
      if (this.selection && this.imageData) {
        this.clipboard = copySelection(this.imageData, this.selection);
        this.callbacks.onStatusMessage("Selection copied.", "#6a9955");
      }
    });
    refs.pxMenuCut?.addEventListener("click", () => {
      if (this.selection && this.imageData) {
        this.clipboard = copySelection(this.imageData, this.selection);
        this.history.pushSnapshot(this.imageData);
        clearSelection(this.imageData, this.selection);
        this.baked = this.callbacks.onBake(this.imageData);
        this.callbacks.onPersist();
        this.renderAll();
        this.updateHistoryButtons();
        this.callbacks.onStatusMessage("Selection cut.", "#6a9955");
      }
    });
    refs.pxMenuPaste?.addEventListener("click", () => {
      if (this.clipboard && this.imageData) {
        this.history.pushSnapshot(this.imageData);
        const destX = this.selection?.x ?? 0;
        const destY = this.selection?.y ?? 0;
        pasteClipboard(this.imageData, this.clipboard, destX, destY);
        this.baked = this.callbacks.onBake(this.imageData);
        this.callbacks.onPersist();
        this.renderAll();
        this.updateHistoryButtons();
      }
    });
    refs.pxMenuSelectAll?.addEventListener("click", () => this.selectAll());
    refs.pxMenuDeselect?.addEventListener("click", () => this.deselect());

    // Initial palette render
    this.renderPalette();
    this.updateToolButtonStates();
    this.updateHistoryButtons();
  }

  // ── Selection helpers ─────────────────────────────────────

  private selectAll(): void {
    if (!this.imageData) return;
    this.selection = { x: 0, y: 0, w: this.imageData.width, h: this.imageData.height };
    this.setTool(3 as ToolType);
    this.renderAll();
    this.callbacks.onStatusMessage("Selected all.", "#6a9955");
  }

  private deselect(): void {
    this.selection = null;
    if (this.layers) clearDraft(this.layers);
    this.renderAll();
  }
}

// ── Helpers ───────────────────────────────────────────────────

function sanitizeDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(512, Math.max(1, Math.floor(value)));
}
