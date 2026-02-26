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
} from "./engine/loop.js";
import { buildEvaluatorLogic } from "./engine/evaluator.js";
import { createDefaultRegistry } from "./engine/components.js";
import { parseMsc, type MscDocument } from "./parser/msc.js";
import { parseWithImports } from "./engine/import-resolver.js";
import { PixelEditor, type PixelEditorRefs } from "./editor/pixel-editor.js";
import {
  MEMORY_BLOCKS,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
  readInt8,
  writeInt8,
  writeInt16,
} from "./engine/memory.js";
import { getPresetNames } from "./editor/palette.js";
import {
  type FileNode,
  type ProjectFiles,
  createDefaultProject,
  createNewProject,
  MIN_PROJECT_DIMENSION,
  createFolder,
  loadProject,
  saveProject,
  findNode,
  findParent,
  collectFiles,
  imageDataToDataUrl,
  dataUrlToImageData,
  createScriptFile,
  createImageFile,
  addChild,
  resolveImportPath,
  findNodeByPath,
  hasImageExtension,
} from "./editor/file-system.js";
import { FileTreeView } from "./editor/file-tree-view.js";
import {
  bootProject,
  stopProject,
  type BootContext,
} from "./editor/bootstrapper.js";
import { parseSpriteROM } from "./editor/importer.js";

type EditorMode = "script" | "config" | "image";
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

const MSC_KEYWORDS = [
  "Entity", "Source", "Import", "Schema", "Events", "Visual",
  "Entity.Player", "Entity.Enemy", "Entity.NPC", "Entity.Item",
  "Visual:", "Source:", "Import:", "Schema:", "Events:",
  "addr:", "type:", "Int8", "Int16", "Int24",
  "CollisionGroup:", "PathFollow:", "Audio:",
  "Inputs:", "Rules:", "Bake:",
];

interface UiRefs {
  appRoot: HTMLDivElement;
  canvas: HTMLCanvasElement;
  newRomButton: HTMLButtonElement;
  newRomMenu: HTMLDivElement;
  newRomPalette: HTMLSelectElement;
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
  fileTreePanel: HTMLDivElement;
  fileTreeHeader: HTMLDivElement;
  fileTreeContainer: HTMLDivElement;
  fileTreeToggle: HTMLSpanElement;
  saveFileButton: HTMLButtonElement;
  downloadFileButton: HTMLButtonElement;
  headerFileInfo: HTMLSpanElement;
  editorFileName: HTMLSpanElement;
  editorModifiedDot: HTMLSpanElement;
  editorFileIcon: HTMLSpanElement;
  pixelFileName: HTMLSpanElement;
  pixelFileSize: HTMLSpanElement;
  downloadPixelButton: HTMLButtonElement;
  statusFileInfo: HTMLSpanElement;
  statusCursorPos: HTMLSpanElement;
  lineNumbers: HTMLDivElement;
  editorUsedColors: HTMLDivElement;
  compilerConsole: HTMLDivElement;
  inputDebug: HTMLDivElement;
}

interface DocEntry {
  id: string;
  title: string;
  category: string;
  content: string;
}

type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; text: string };

interface TypedocReflection {
  name?: string;
  kind?: number;
  children?: TypedocReflection[];
}

const API_SPEC_DOC_ENTRY_ID = "api-spec-live";

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
  docsRenderVersion: number;
  activeTab: string;
  /** Project file tree for multi-file editing. */
  project: ProjectFiles;
  fileTreeView: FileTreeView | null;
  /** IDs of files currently open as editor tabs, in order. */
  openFileIds: string[];
  /** Timer for auto-hiding the compiler console. */
  bootHideTimer: number | null;
}

async function main(): Promise<void> {
  const ui = getUiRefs();
  const savedProject = loadProject();
  const project = savedProject ?? createDefaultProject();

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
    docsRenderVersion: 0,
    activeTab: "script",
    project,
    fileTreeView: null,
    openFileIds: [],
    bootHideTimer: null,
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
    onColorChange: (oldHex, newHex) => {
      swapColorInScript(runtime, oldHex, newHex);
      void applyPaletteColorToProjectImages(runtime, oldHex, newHex);
    },
    onPaletteChange: () => {
      renderPaletteChips(runtime);
      renderEditorUsedColors(runtime);
    },
    onEntityPlace: (entityType, docX, docY) => {
      if (!runtime.imageData) return;

      const script = parseMsc(runtime.scriptText);
      const entityTypes = Object.keys(script.entities);
      const typeId = entityTypes.indexOf(entityType);

      if (typeId === -1) {
        showStatus(runtime, `Unknown entity type: ${entityType}`, "var(--danger)");
        return;
      }

      const poolStart = MEMORY_BLOCKS.entityPool.startByte;
      const poolEnd = MEMORY_BLOCKS.entityPool.endByte;
      const buffer = runtime.imageData.data;

      let foundSlot = -1;
      // Search for a free slot (Active byte == 0)
      for (
        let ptr = poolStart;
        ptr + ENTITY_SLOT_SIZE <= poolEnd;
        ptr += ENTITY_SLOT_SIZE
      ) {
        const active = readInt8(buffer, ptr + ENTITY_ACTIVE);
        if (active === 0) {
          foundSlot = ptr;
          break;
        }
      }

      if (foundSlot === -1) {
        showStatus(runtime, "Entity pool full!", "var(--danger)");
        return;
      }

      // Initialize the slot
      buffer.fill(0, foundSlot, foundSlot + ENTITY_SLOT_SIZE);
      writeInt8(buffer, foundSlot + ENTITY_ACTIVE, 1);
      writeInt8(buffer, foundSlot + ENTITY_TYPE_ID, typeId);
      writeInt16(buffer, foundSlot + ENTITY_POS_X, Math.round(docX));
      writeInt16(buffer, foundSlot + ENTITY_POS_Y, Math.round(docY));

      // Persist & Update
      runtime.baked = bake(runtime.imageData);
      runtime.pixelEditor?.setBaked(runtime.baked);
      runtime.pixelEditor?.render();
      
      // Hot-reload engine buffer
      if (runtime.loop) {
        const state = runtime.loop.getState();
        if (state.buffer.length === buffer.length) {
          // Sync the entity pool change immediately
          state.buffer.set(buffer.subarray(foundSlot, foundSlot + ENTITY_SLOT_SIZE), foundSlot);
        }
      }

      schedulePersistRom(runtime);

      showStatus(
        runtime,
        `Placed ${entityType} #${typeId} at (${Math.floor(docX)}, ${Math.floor(docY)})`,
        "var(--success)"
      );
    },
  });

  wireUi(runtime);
  initFileTree(runtime);
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
      // Sync restored script into the active file node
      if (runtime.project.activeFileId) {
        const node = findNode(runtime.project.root, runtime.project.activeFileId);
        if (node && node.fileType === "script") {
          node.content = restoredScript;
          saveProject(runtime.project);
        }
      }
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
    newRomMenu: requiredElement<HTMLDivElement>("new-rom-menu"),
    newRomPalette: requiredElement<HTMLSelectElement>("new-rom-palette"),
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
    fileTreePanel: requiredElement<HTMLDivElement>("file-tree-panel"),
    fileTreeHeader: requiredElement<HTMLDivElement>("file-tree-header"),
    fileTreeContainer: requiredElement<HTMLDivElement>("file-tree-container"),
    fileTreeToggle: requiredElement<HTMLSpanElement>("file-tree-toggle"),
    saveFileButton: requiredElement<HTMLButtonElement>("save-file-button"),
    downloadFileButton: requiredElement<HTMLButtonElement>("download-file-button"),
    headerFileInfo: requiredElement<HTMLSpanElement>("header-file-info"),
    editorFileName: requiredElement<HTMLSpanElement>("editor-file-name"),
    editorModifiedDot: requiredElement<HTMLSpanElement>("editor-modified-dot"),
    editorFileIcon: requiredElement<HTMLSpanElement>("editor-file-icon"),
    pixelFileName: requiredElement<HTMLSpanElement>("pixel-file-name"),
    pixelFileSize: requiredElement<HTMLSpanElement>("pixel-file-size"),
    downloadPixelButton: requiredElement<HTMLButtonElement>("download-pixel-button"),
    statusFileInfo: requiredElement<HTMLSpanElement>("status-file-info"),
    statusCursorPos: requiredElement<HTMLSpanElement>("status-cursor-pos"),
    lineNumbers: requiredElement<HTMLDivElement>("line-numbers"),
    editorUsedColors: requiredElement<HTMLDivElement>("editor-used-colors"),
    compilerConsole: requiredElement<HTMLDivElement>("compiler-console"),
    inputDebug: requiredElement<HTMLDivElement>("input-debug"),
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
    layerEcsToggle: requiredElement<HTMLInputElement>("layer-ecs-toggle"),
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
    paletteUpdateButton: document.getElementById("palette-update-button") as HTMLButtonElement | null,
    entityBrushButton: document.getElementById("entity-brush-button") as HTMLButtonElement | null,
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
  updateEditorFileInfo(runtime);
}

// ── File tree ────────────────────────────────────────────────

/** Initialize the file tree view panel. */
function initFileTree(runtime: RuntimeState): void {
  const { ui } = runtime;

  // Wire collapse toggle (only on the title / toggle chevron, not the action buttons)
  ui.fileTreeToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    ui.fileTreePanel.classList.toggle("is-collapsed");
  });
  ui.fileTreePanel.querySelector("#file-tree-title")?.addEventListener("click", () => {
    ui.fileTreePanel.classList.toggle("is-collapsed");
  });

  // Wire the add-file dropdown menu
  wireFileTreeAddMenu(runtime);

  runtime.fileTreeView = new FileTreeView(
    ui.fileTreeContainer,
    runtime.project,
    {
      onFileSelect: (node) => openFileNode(runtime, node),
      onTreeChange: () => {
        saveProject(runtime.project);
      },
      onFileDelete: (deletedId) => {
        // Remove from open editor tabs
        const tabIdx = runtime.openFileIds.indexOf(deletedId);
        if (tabIdx !== -1) {
          runtime.openFileIds.splice(tabIdx, 1);
        }
        if (runtime.project.activeFileId === deletedId) {
          // Pick the first available script file, or null
          const scripts = collectFiles(runtime.project.root, "script");
          const images = collectFiles(runtime.project.root, "image");
          const all = [...scripts, ...images];
          const next = all.length > 0 ? all[0] : null;
          runtime.project.activeFileId = next?.id ?? null;
          if (next) {
            openFileNode(runtime, next);
          } else {
            runtime.scriptText = "";
            setEditorText(runtime, "");
            switchEditorMode(runtime, "script");
          }
          saveProject(runtime.project);
        }
        renderEditorTabs(runtime);
      },
    }
  );

  // If there is an active file, open it
  if (runtime.project.activeFileId) {
    const node = findNode(runtime.project.root, runtime.project.activeFileId);
    if (node) openFileNode(runtime, node, true);
  }
}

/** Wire the "+" dropdown menu in the file tree header. */
function wireFileTreeAddMenu(runtime: RuntimeState): void {
  const addBtn = document.getElementById("ftv-add-btn");
  const menu = document.getElementById("ftv-add-menu");
  if (!addBtn || !menu) return;

  // Toggle dropdown
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("is-open");
  });

  // Close on outside click
  document.addEventListener("click", () => {
    menu.classList.remove("is-open");
  });
  menu.addEventListener("click", (e) => e.stopPropagation());

  // Hidden file inputs for import
  const scriptFileInput = document.createElement("input");
  scriptFileInput.type = "file";
  scriptFileInput.accept = ".msc,.txt,.json,.md";
  scriptFileInput.multiple = true;
  scriptFileInput.style.display = "none";
  document.body.appendChild(scriptFileInput);

  const imageFileInput = document.createElement("input");
  imageFileInput.type = "file";
  imageFileInput.accept = ".png,.jpg,.jpeg,.webp,.mzk";
  imageFileInput.multiple = true;
  imageFileInput.style.display = "none";
  document.body.appendChild(imageFileInput);

  const romFileInput = document.createElement("input");
  romFileInput.type = "file";
  romFileInput.accept = ".mzk,.png";
  romFileInput.multiple = false;
  romFileInput.style.display = "none";
  document.body.appendChild(romFileInput);

  // Wire menu items
  menu.querySelectorAll<HTMLButtonElement>(".ftv-dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      menu.classList.remove("is-open");
      const action = item.dataset.action;
      switch (action) {
        case "new-script": {
          const node = createScriptFile("untitled.msc", "# New script\n");
          addChild(runtime.project.root, node);
          saveProject(runtime.project);
          runtime.fileTreeView?.render();
          void openFileNode(runtime, node);
          showStatus(runtime, "New script created.", "var(--success)");
          break;
        }
        case "new-mzk": {
          const pw = runtime.project.projectWidth;
          const ph = runtime.project.projectHeight;
          const nameInput = prompt("SpriteROM filename:", "new_asset.mzk");
          if (!nameInput) break;
          let mzkName = nameInput.trim();
          if (!mzkName.endsWith(".mzk")) mzkName += ".mzk";

          const wInput = prompt(`Width (min ${MIN_PROJECT_DIMENSION}):`, String(pw));
          if (!wInput) break;
          const hInput = prompt(`Height (min ${MIN_PROJECT_DIMENSION}):`, String(ph));
          if (!hInput) break;

          const mzkW = Math.max(parseInt(wInput, 10) || pw, MIN_PROJECT_DIMENSION);
          const mzkH = Math.max(parseInt(hInput, 10) || ph, MIN_PROJECT_DIMENSION);

          const canvas = document.createElement("canvas");
          canvas.width = mzkW;
          canvas.height = mzkH;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, mzkW, mzkH);
          const dataUrl = canvas.toDataURL("image/png");
          
          const node = createImageFile(mzkName, dataUrl, mzkW, mzkH);
          addChild(runtime.project.root, node);
          runtime.project.activeFileId = node.id;
          saveProject(runtime.project);
          
          // Switch to pixel editor for this image
          runtime.imageData = createBlankImageData(mzkW, mzkH, "#000000");
          runtime.baked = bake(runtime.imageData);
          runtime.pixelEditor?.setImageData(runtime.imageData);
          runtime.pixelEditor?.setBaked(runtime.baked);
          
          switchEditorMode(runtime, "image");
          switchTab(runtime, "pixel");
          runtime.fileTreeView?.render();
          showStatus(runtime, `New ${mzkW}×${mzkH} SpriteROM created.`, "var(--success)");
          break;
        }
        case "new-text": {
          const node = createScriptFile("untitled.txt", "");
          addChild(runtime.project.root, node);
          saveProject(runtime.project);
          runtime.fileTreeView?.render();
          void openFileNode(runtime, node);
          showStatus(runtime, "New text file created.", "var(--success)");
          break;
        }
        case "new-json": {
          const node = createScriptFile("untitled.json", "{\n  \n}\n");
          addChild(runtime.project.root, node);
          saveProject(runtime.project);
          runtime.fileTreeView?.render();
          void openFileNode(runtime, node);
          showStatus(runtime, "New JSON file created.", "var(--success)");
          break;
        }
        case "new-markdown": {
          const node = createScriptFile("untitled.md", "# Untitled\n");
          addChild(runtime.project.root, node);
          saveProject(runtime.project);
          runtime.fileTreeView?.render();
          void openFileNode(runtime, node);
          showStatus(runtime, "New markdown file created.", "var(--success)");
          break;
        }
        case "new-image": {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, 64, 64);
          const dataUrl = canvas.toDataURL("image/png");
          const node = createImageFile("new_sprite.png", dataUrl, 64, 64);
          addChild(runtime.project.root, node);
          runtime.project.activeFileId = node.id;
          saveProject(runtime.project);
          openFileNode(runtime, node);
          showStatus(runtime, "New 64×64 image created.", "var(--success)");
          break;
        }
        case "new-folder": {
          const folder = createFolder("new_folder");
          addChild(runtime.project.root, folder);
          saveProject(runtime.project);
          runtime.fileTreeView?.render();
          showStatus(runtime, "Folder created.", "var(--success)");
          break;
        }
        case "new-project": {
          if (!confirm("Create a new project? Unsaved changes will be lost.")) break;
          const wpInput = prompt(`Project width (min ${MIN_PROJECT_DIMENSION}):`, "256");
          if (!wpInput) break;
          const hpInput = prompt(`Project height (min ${MIN_PROJECT_DIMENSION}):`, "256");
          if (!hpInput) break;
          const npW = Math.max(parseInt(wpInput, 10) || 256, MIN_PROJECT_DIMENSION);
          const npH = Math.max(parseInt(hpInput, 10) || 256, MIN_PROJECT_DIMENSION);
          const newProj = createNewProject(npW, npH);
          runtime.project.root = newProj.root;
          runtime.project.activeFileId = newProj.activeFileId;
          runtime.project.entryPointId = newProj.entryPointId;
          runtime.project.projectWidth = newProj.projectWidth;
          runtime.project.projectHeight = newProj.projectHeight;
          saveProject(runtime.project);

          // Load the generated image
          if (newProj.activeFileId) {
            const mainImg = findNode(runtime.project.root, newProj.activeFileId);
            if (mainImg?.content) {
              dataUrlToImageData(mainImg.content).then((imgData) => {
                runtime.imageData = imgData;
                runtime.baked = bake(imgData);
                initPixelEditor(runtime);
                restart(runtime);
              });
            }
          }

          // Load the entry-point script text
          const epNode = newProj.entryPointId ? findNode(runtime.project.root, newProj.entryPointId) : null;
          if (epNode?.content) {
            runtime.scriptText = epNode.content;
          }

          runtime.openFileIds = [];
          runtime.fileTreeView?.setProject(runtime.project);
          switchEditorMode(runtime, "image");
          switchTab(runtime, "pixel");
          renderEditorTabs(runtime);
          showStatus(runtime, `New ${npW}×${npH} project created.`, "var(--success)");
          break;
        }
        case "import-script":
          scriptFileInput.click();
          break;
        case "import-image":
          imageFileInput.click();
          break;
        case "import-rom":
          romFileInput.click();
          break;
      }
    });
  });

  // Handle script file imports
  scriptFileInput.addEventListener("change", async () => {
    const files = scriptFileInput.files;
    if (!files || files.length === 0) return;
    let lastNode: FileNode | null = null;
    let imported = 0;
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["msc", "txt", "yaml", "yml", "json", "md"].includes(ext)) {
        showStatus(runtime, `Skipped unsupported file: ${file.name}`, "var(--warning)");
        continue;
      }
      const text = await file.text();
      const node = createScriptFile(file.name, text);
      addChild(runtime.project.root, node);
      lastNode = node;
      imported++;
    }
    if (lastNode) {
      saveProject(runtime.project);
      runtime.fileTreeView?.render();
      persistScript(lastNode.content ?? "");
      void openFileNode(runtime, lastNode);
      showStatus(runtime, `Imported ${imported} script(s).`, "var(--success)");
    }
    scriptFileInput.value = "";
  });

  // Handle image file imports
  imageFileInput.addEventListener("change", async () => {
    const files = imageFileInput.files;
    if (!files || files.length === 0) return;
    let lastNode: FileNode | null = null;
    let imported = 0;
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
        showStatus(runtime, `Skipped unsupported file: ${file.name}`, "var(--warning)");
        continue;
      }
      try {
        const imgData = await fileToImageData(file);
        const dataUrl = imageDataToDataUrl(imgData);
        const node = createImageFile(file.name, dataUrl, imgData.width, imgData.height);
        addChild(runtime.project.root, node);
        lastNode = node;
        imported++;
      } catch {
        showStatus(runtime, `Failed to load image: ${file.name}`, "var(--error)");
      }
    }
    if (lastNode) {
      runtime.project.activeFileId = lastNode.id;
      saveProject(runtime.project);
      openFileNode(runtime, lastNode);
      showStatus(runtime, `Imported ${imported} image(s).`, "var(--success)");
    }
    imageFileInput.value = "";
  });

  // Handle ROM file imports (loads via the existing loadRom path)
  romFileInput.addEventListener("change", async () => {
    const file = romFileInput.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      await loadRom(runtime, objectUrl);
      showStatus(runtime, `Imported ROM: ${file.name}`, "var(--success)");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    romFileInput.value = "";
  });
}

/** Convert a File (image) to ImageData. */
async function fileToImageData(file: File): Promise<ImageData> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<ImageData>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("No 2D context")); return; }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.onerror = () => reject(new Error(`Failed to decode image: ${file.name}`));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save the current editor content back to the active file node. */
function saveActiveFileContent(runtime: RuntimeState): void {
  if (!runtime.project.activeFileId) return;
  const node = findNode(runtime.project.root, runtime.project.activeFileId);
  if (!node || node.kind !== "file") return;

  if (node.fileType === "script") {
    // Sync from the textarea to capture the very latest edits
    if (runtime.editorMode === "script") {
      runtime.scriptText = runtime.ui.mscEditor.value;
    }
    node.content = runtime.scriptText;
  } else if (node.fileType === "image" && runtime.imageData) {
    node.content = imageDataToDataUrl(runtime.imageData);
    node.imageWidth = runtime.imageData.width;
    node.imageHeight = runtime.imageData.height;
  }
  saveProject(runtime.project);
}

/** Open a file node in the appropriate editor. */
async function openFileNode(
  runtime: RuntimeState,
  node: FileNode,
  skipSave = false
): Promise<void> {
  // Save current file before switching
  if (!skipSave) {
    saveActiveFileContent(runtime);
  }

  // Track this file as open in the editor tabs (script files only, not images)
  if (node.fileType === "script" && !hasImageExtension(node.name) && !runtime.openFileIds.includes(node.id)) {
    runtime.openFileIds.push(node.id);
  }

  runtime.project.activeFileId = node.id;
  saveProject(runtime.project);

  // Determine whether this file should open in the pixel editor.
  // Extension-based check covers .mzk/.png files that may have
  // been created with the wrong fileType in older versions.
  const isImageFile =
    node.fileType === "image" ||
    hasImageExtension(node.name);

  if (!isImageFile && node.fileType === "script") {
    runtime.scriptText = node.content ?? "";
    switchEditorMode(runtime, "script");
    switchTab(runtime, "script");
  } else if (isImageFile) {
    // Fix fileType if it was incorrectly set (backward compat)
    if (node.fileType !== "image") {
      node.fileType = "image";
      saveProject(runtime.project);
    }
    // Load image data from the stored dataURL
    if (node.content) {
      try {
        const imgData = await dataUrlToImageData(node.content);
        runtime.imageData = imgData;
        runtime.baked = bake(imgData);
        initPixelEditor(runtime);

        // Parse the companion .msc script so the Entity Brush can
        // resolve entity type IDs (resolveEntityTypeId needs this.script).
        if (runtime.pixelEditor) {
          const baseName = node.name.replace(/\.[^.]+$/, "");
          const parent = findParent(runtime.project.root, node.id);
          const siblings = parent ? parent.children : runtime.project.root.children;
          const companion = siblings.find(
            (s) => s.kind === "file" && s.fileType === "script" && s.name === `${baseName}.msc`
          );
          const scriptNode = companion
            ?? (runtime.project.entryPointId
              ? findNode(runtime.project.root, runtime.project.entryPointId)
              : null);
          if (scriptNode && scriptNode.fileType === "script" && scriptNode.content) {
            try {
              const parsed = parseMsc(scriptNode.content);
              runtime.pixelEditor.setScript(parsed);
            } catch { /* parse errors are non-fatal here */ }
          }
        }

        switchTab(runtime, "pixel");
      } catch {
        runtime.ui.mscStatus.textContent = `Failed to load image: ${node.name}`;
        runtime.ui.mscStatus.style.color = "#d16969";
      }
    }
  }

  runtime.fileTreeView?.render();
  renderEditorTabs(runtime);
  updateEditorFileInfo(runtime);
  updateLineNumbers(runtime);
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
  scriptInput.accept = ".msc,.txt,.yaml,.yml,.json,.md";
  scriptInput.style.display = "none";
  document.body.appendChild(scriptInput);

  // New ROM dropdown toggle
  ui.newRomButton.addEventListener("click", (e) => {
    e.stopPropagation();
    ui.newRomMenu.classList.toggle("is-open");
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", () => {
    ui.newRomMenu.classList.remove("is-open");
  });

  // Keep dropdown open while interacting with its controls
  ui.newRomMenu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Populate palette preset dropdown in new ROM menu
  {
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "Default";
    ui.newRomPalette.appendChild(defaultOpt);
    for (const name of getPresetNames()) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      ui.newRomPalette.appendChild(opt);
    }
  }

  // New ROM menu item handlers
  document.querySelectorAll<HTMLButtonElement>("#new-rom-menu [data-new-rom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const variant = btn.dataset.newRom;
      const paletteName = ui.newRomPalette.value;
      ui.newRomMenu.classList.remove("is-open");
      createNewRom(runtime, variant as "empty" | "amiga" | "checkerboard", paletteName || undefined);
    });
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
    void bootWithContext(runtime);
  });

  // Save file button
  ui.saveFileButton.addEventListener("click", () => {
    saveActiveFileContent(runtime);
    ui.editorModifiedDot.hidden = true;
    showStatus(runtime, "File saved.", "var(--success)");
  });

  // Download file buttons
  ui.downloadFileButton.addEventListener("click", () => {
    downloadCurrentFile(runtime);
  });
  ui.downloadPixelButton.addEventListener("click", () => {
    downloadCurrentImage(runtime);
  });

  // Ctrl+S shortcut
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveActiveFileContent(runtime);
      ui.editorModifiedDot.hidden = true;
      showStatus(runtime, "File saved.", "var(--success)");
    }
    // F5 — Play Project (entry point)
    if (e.key === "F5") {
      e.preventDefault();
      void bootWithContext(runtime);
    }
    // F6 — Play Current (legacy active file)
    if (e.key === "F6") {
      e.preventDefault();
      restart(runtime);
    }
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
    const text = await file.text();
    // Create a file node if it doesn't exist yet
    const newNode = createScriptFile(file.name, text);
    addChild(runtime.project.root, newNode);
    saveProject(runtime.project);
    persistScript(text);
    runtime.fileTreeView?.render();
    void openFileNode(runtime, newNode);
  });

  // ── Drag-and-drop cartridge import ───────────────────────────
  const dropTarget = ui.appRoot;
  for (const evt of ["dragover", "dragenter", "drop"] as const) {
    dropTarget.addEventListener(evt, (e) => e.preventDefault());
  }
  dropTarget.addEventListener("drop", (e) => {
    const file = (e as DragEvent).dataTransfer?.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["mzk", "png", "jpg", "jpeg", "webp"].includes(ext)) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const parsed = parseSpriteROM(img);
        const name = file.name.replace(/\.[^.]+$/, ".mzk");
        const node = createImageFile(
          name,
          parsed.visualDataUrl,
          parsed.width,
          parsed.height,
        );
        addChild(runtime.project.root, node);
        runtime.project.activeFileId = node.id;

        dataUrlToImageData(parsed.visualDataUrl).then((imgData) => {
          runtime.imageData = imgData;
          runtime.baked = bake(imgData);
          initPixelEditor(runtime);

          if (parsed.stateBuffer) {
            // Mozaic cartridge — restore ECS state buffer
            runtime.pixelEditor?.setEngineBuffer(parsed.stateBuffer);
            if (runtime.loop) {
              const state = runtime.loop.getState();
              if (parsed.stateBuffer.length <= state.buffer.length) {
                state.buffer.set(parsed.stateBuffer);
              }
            }
          }

          saveProject(runtime.project);
          runtime.fileTreeView?.render();
          switchTab(runtime, "pixel");
          const label = parsed.stateBuffer ? "Loaded cartridge" : "Imported image";
          showStatus(runtime, `${label}: ${file.name}`, "var(--success)");
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

  // Tab key inserts 2 spaces instead of changing focus
  ui.mscEditor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = ui.mscEditor.selectionStart;
      const end = ui.mscEditor.selectionEnd;
      const value = ui.mscEditor.value;
      ui.mscEditor.value = value.substring(0, start) + "  " + value.substring(end);
      ui.mscEditor.selectionStart = ui.mscEditor.selectionEnd = start + 2;
      ui.mscEditor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // Ctrl+Click to open/create the file referenced under the cursor
  ui.mscEditor.addEventListener("click", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const pos = ui.mscEditor.selectionStart;
    const text = ui.mscEditor.value;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    const lineEnd = text.indexOf("\n", pos);
    const line = text.substring(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const filename = extractImportFilename(line, pos - lineStart);
    if (!filename) return;
    openOrCreateFileByName(runtime, filename);
  });

  // Autocomplete
  const acDropdown = document.getElementById("msc-autocomplete")!;
  let acItems: string[] = [];
  let acIndex = -1;
  let acStart = 0;

  function getCaretCoordinates(element: HTMLTextAreaElement, position: number) {
    const div = document.createElement("div");
    const style = window.getComputedStyle(element);
    const properties = [
      "direction", "boxSizing", "width", "height", "overflowX", "overflowY",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize",
      "fontSizeAdjust", "lineHeight", "fontFamily", "textAlign", "textTransform",
      "textIndent", "textDecoration", "letterSpacing", "wordSpacing",
      "tabSize", "MozTabSize"
    ];
    properties.forEach(prop => {
      div.style[prop as any] = style[prop as any];
    });
    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre";
    div.style.left = "-9999px";
    div.style.top = "-9999px";
    div.textContent = element.value.substring(0, position);
    const span = document.createElement("span");
    span.textContent = ".";
    div.appendChild(span);
    document.body.appendChild(div);
    const spanLeft = span.offsetLeft;
    const spanTop = span.offsetTop;
    const lineHeight = parseFloat(style.lineHeight) || parseInt(style.fontSize);
    document.body.removeChild(div);
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left + element.clientLeft + spanLeft - element.scrollLeft,
      bottom: rect.top + element.clientTop + spanTop - element.scrollTop + lineHeight
    };
  }

  function showAutocomplete(items: string[], rect: { left: number; bottom: number }, wordStart: number): void {
    acDropdown.innerHTML = "";
    acItems = items;
    acIndex = -1;
    acStart = wordStart;
    for (let i = 0; i < items.length; i++) {
      const div = document.createElement("div");
      div.className = "autocomplete-item";
      div.textContent = items[i];
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applyAutocomplete(items[i], wordStart);
      });
      acDropdown.appendChild(div);
    }
    acDropdown.style.left = `${rect.left}px`;
    acDropdown.style.top = `${rect.bottom + 2}px`;
    acDropdown.classList.add("is-open");
  }

  function hideAutocomplete(): void {
    acDropdown.classList.remove("is-open");
    acItems = [];
    acIndex = -1;
  }

  function applyAutocomplete(text: string, wordStart: number): void {
    const editor = ui.mscEditor;
    const end = editor.selectionStart;
    const before = editor.value.substring(0, wordStart);
    const after = editor.value.substring(end);
    editor.value = before + text + after;
    const cursor = wordStart + text.length;
    editor.selectionStart = editor.selectionEnd = cursor;
    editor.focus();
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    hideAutocomplete();
  }

  function updateAutocompleteHighlight(): void {
    const items = acDropdown.querySelectorAll(".autocomplete-item");
    items.forEach((el, i) => el.classList.toggle("is-selected", i === acIndex));
    if (acIndex >= 0 && items[acIndex]) {
      items[acIndex].scrollIntoView({ block: "nearest" });
    }
  }

  ui.mscEditor.addEventListener("keydown", (e) => {
    if (acDropdown.classList.contains("is-open")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        acIndex = Math.min(acIndex + 1, acItems.length - 1);
        updateAutocompleteHighlight();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        acIndex = Math.max(acIndex - 1, 0);
        updateAutocompleteHighlight();
        return;
      }
      if (e.key === "Enter" && acIndex >= 0) {
        e.preventDefault();
        applyAutocomplete(acItems[acIndex], acStart);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideAutocomplete();
        return;
      }
    }
  });

  ui.mscEditor.addEventListener("input", () => {
    if (runtime.editorMode !== "script") {
      hideAutocomplete();
      return;
    }
    const pos = ui.mscEditor.selectionStart;
    const text = ui.mscEditor.value;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    const lineUpToCursor = text.substring(lineStart, pos);

    // Import filename autocomplete: suggest project script filenames
    const importMatch = lineUpToCursor.match(/^\s*Import\s*:\s*"?([^"\s]*)$/);
    if (importMatch) {
      const partial = importMatch[1].toLowerCase();
      const scriptFiles = collectFiles(runtime.project.root, "script");
      const filenames = scriptFiles.map((f) => f.name);
      const matches = filenames.filter((f) => {
        const lf = f.toLowerCase();
        return lf.startsWith(partial) && lf !== partial;
      });
      if (matches.length > 0) {
        const wordStart = pos - importMatch[1].length;
        const coords = getCaretCoordinates(ui.mscEditor, wordStart);
        showAutocomplete(matches, coords, wordStart);
      } else {
        hideAutocomplete();
      }
      return;
    }

    // Keyword autocomplete
    const wordInfo = getCurrentWord(ui.mscEditor);
    if (wordInfo.word.length >= 2) {
      const lower = wordInfo.word.toLowerCase();
      const matches = MSC_KEYWORDS.filter((k) =>
        k.toLowerCase().startsWith(lower) && k.toLowerCase() !== lower
      );
      if (matches.length > 0) {
        const coords = getCaretCoordinates(ui.mscEditor, wordInfo.start);
        showAutocomplete(matches, coords, wordInfo.start);
      } else {
        hideAutocomplete();
      }
    } else {
      hideAutocomplete();
    }
  });

  ui.mscEditor.addEventListener("blur", () => {
    setTimeout(() => hideAutocomplete(), 150);
  });

  let editorSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let editorValidateTimer: ReturnType<typeof setTimeout> | null = null;

  ui.mscEditor.addEventListener("input", () => {
    if (runtime.editorMode === "script") {
      runtime.scriptText = ui.mscEditor.value;
      persistScript(runtime.scriptText);
      // Debounce file-tree persistence to avoid heavy serialization on every keystroke
      if (editorSaveTimer !== null) clearTimeout(editorSaveTimer);
      editorSaveTimer = setTimeout(() => {
        saveActiveFileContent(runtime);
        editorSaveTimer = null;
      }, 300);
    } else if (runtime.editorMode === "config") {
      runtime.configText = ui.mscEditor.value;
    }
    refreshHighlight(runtime);
    // Debounce script parsing/validation to keep typing responsive
    if (editorValidateTimer !== null) clearTimeout(editorValidateTimer);
    editorValidateTimer = setTimeout(() => {
      validateEditor(runtime);
      editorValidateTimer = null;
    }, 300);
    updateLineNumbers(runtime);
    ui.editorModifiedDot.hidden = false;
  });
  ui.mscEditor.addEventListener("scroll", () => {
    ui.mscHighlight.scrollTop = ui.mscEditor.scrollTop;
    ui.mscHighlight.scrollLeft = ui.mscEditor.scrollLeft;
    ui.lineNumbers.scrollTop = ui.mscEditor.scrollTop;
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

  // Wire collapsible sidebar toggle
  const sidebarToggle = document.getElementById("toggle-sidebar-btn");
  const leftSidebar = document.getElementById("left-sidebar");
  if (sidebarToggle && leftSidebar) {
    sidebarToggle.addEventListener("click", () => {
      leftSidebar.classList.toggle("is-collapsed");
      sidebarToggle.classList.toggle("is-active");
      // Trigger canvas resize after transition
      setTimeout(() => resizeGameCanvas(ui), 200);
    });
  }

  // Wire collapsible right panel toggle
  const panelToggle = document.getElementById("toggle-panel-btn");
  const sidePanel = document.getElementById("side-panel");
  const splitHandle = document.getElementById("split-handle");
  if (panelToggle && sidePanel && splitHandle) {
    panelToggle.addEventListener("click", () => {
      const isCollapsed = sidePanel.classList.toggle("is-collapsed");
      panelToggle.classList.toggle("is-active");
      splitHandle.style.display = isCollapsed ? "none" : "";
      // Trigger canvas resize after transition
      setTimeout(() => resizeGameCanvas(ui), 200);
    });
  }

  // Wire split handle for resizable right panel
  const canvasArea = document.getElementById("canvas-area");
  if (splitHandle && sidePanel) {
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
      const totalW = window.innerWidth;
      const sidebarW = leftSidebar ? leftSidebar.offsetWidth : 0;
      const handleW = splitHandle.offsetWidth;
      const rightEdge = totalW;
      const x = e.clientX;
      const minPanel = 200;
      const maxPanel = totalW - sidebarW - 200 - handleW;
      const panelW = Math.max(minPanel, Math.min(maxPanel, rightEdge - x - handleW));
      sidePanel.style.width = `${panelW}px`;
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
    runtime.ui.docsContent.innerHTML = '<div class="docs-empty">No matching documentation entries.</div>';
    return;
  }

  const selected = runtime.docsEntries.find((entry) => entry.id === runtime.selectedDocId);
  if (!selected) {
    runtime.ui.docsContent.innerHTML = '<div class="docs-empty">No matching documentation entries.</div>';
    return;
  }

  const renderVersion = ++runtime.docsRenderVersion;
  if (selected.id === API_SPEC_DOC_ENTRY_ID) {
    void renderApiSpecDoc(runtime, selected, renderVersion);
    return;
  }

  renderDocEntry(runtime, selected, selected.content);
}

function renderDocEntry(runtime: RuntimeState, selected: DocEntry, content: string): void {

  const container = runtime.ui.docsContent;
  container.innerHTML = "";

  const article = document.createElement("article");
  article.className = "docs-article";

  const header = document.createElement("header");
  header.className = "docs-article-header";

  const title = document.createElement("h2");
  title.className = "docs-article-title";
  title.textContent = selected.title;

  const category = document.createElement("span");
  category.className = "docs-badge";
  category.textContent = selected.category;

  header.appendChild(title);
  header.appendChild(category);
  article.appendChild(header);

  const blocks = parseDocBlocks(content);
  const headings: Array<{ id: string; text: string }> = [];

  for (const block of blocks) {
    if (block.type === "heading") {
      const heading = document.createElement(block.level === 1 ? "h3" : "h4");
      heading.className = block.level === 1 ? "docs-section-title" : "docs-subsection-title";
      const headingId = createHeadingId(block.text, headings.length);
      heading.id = headingId;
      heading.textContent = block.text;
      article.appendChild(heading);
      headings.push({ id: headingId, text: block.text });
      continue;
    }

    if (block.type === "paragraph") {
      const paragraph = document.createElement("p");
      paragraph.className = "docs-paragraph";
      paragraph.textContent = block.text;
      article.appendChild(paragraph);
      continue;
    }

    if (block.type === "list") {
      const list = document.createElement("ul");
      list.className = "docs-list";
      for (const itemText of block.items) {
        const item = document.createElement("li");
        item.textContent = itemText;
        list.appendChild(item);
      }
      article.appendChild(list);
      continue;
    }

    const pre = document.createElement("pre");
    pre.className = "docs-code";
    pre.textContent = block.text;
    article.appendChild(pre);
  }

  if (headings.length > 0) {
    const outline = document.createElement("nav");
    outline.className = "docs-outline";

    const outlineTitle = document.createElement("div");
    outlineTitle.className = "docs-outline-title";
    outlineTitle.textContent = "Outline";
    outline.appendChild(outlineTitle);

    const outlineList = document.createElement("ul");
    outlineList.className = "docs-outline-list";
    for (const heading of headings) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.text;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const target = article.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      item.appendChild(link);
      outlineList.appendChild(item);
    }
    outline.appendChild(outlineList);

    container.appendChild(outline);
  }

  container.appendChild(article);
}

async function renderApiSpecDoc(
  runtime: RuntimeState,
  selected: DocEntry,
  renderVersion: number
): Promise<void> {
  const loading = `${selected.content}\n\n## Loading\n- Fetching generated API spec...`;
  renderDocEntry(runtime, selected, loading);

  try {
    const response = await fetch(`/docs/api-spec.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("API spec fetch failed");

    const project = (await response.json()) as TypedocReflection;

    if (
      renderVersion !== runtime.docsRenderVersion ||
      runtime.selectedDocId !== selected.id
    ) {
      return;
    }

    renderDocEntry(runtime, selected, buildApiSpecContent(selected.content, project));
  } catch {
    if (
      renderVersion !== runtime.docsRenderVersion ||
      runtime.selectedDocId !== selected.id
    ) {
      return;
    }

    const fallback = `${selected.content}\n\n## Error\n- Could not load docs/api-spec.json\n- Regenerate with: npm run docs:api`;
    renderDocEntry(runtime, selected, fallback);
  }
}

function buildApiSpecContent(intro: string, project: TypedocReflection): string {
  const stats = {
    modules: 0,
    functions: 0,
    classes: 0,
    interfaces: 0,
    typeAliases: 0,
    enums: 0,
    variables: 0,
  };

  const visit = (node: TypedocReflection): void => {
    switch (node.kind) {
      case 2:
        stats.modules += 1;
        break;
      case 64:
        stats.functions += 1;
        break;
      case 128:
        stats.classes += 1;
        break;
      case 256:
        stats.interfaces += 1;
        break;
      case 2097152:
        stats.typeAliases += 1;
        break;
      case 8:
        stats.enums += 1;
        break;
      case 32:
        stats.variables += 1;
        break;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(project);

  const modulePreview = (project.children ?? [])
    .filter((node) => node.kind === 2)
    .slice(0, 16)
    .map((moduleNode) => {
      const exports = (moduleNode.children ?? [])
        .filter((child) => child.kind !== 4096 && Boolean(child.name))
        .slice(0, 8)
        .map((child) => child.name as string);
      const summary = exports.length > 0 ? exports.join(", ") : "(no exported symbols)";
      return `- ${moduleNode.name ?? "(unnamed module)"}: ${summary}`;
    });

  return [
    intro,
    "",
    "## Async API Snapshot",
    "- Loaded asynchronously from docs/api-spec.json",
    `- Refreshed: ${new Date().toLocaleString()}`,
    "",
    "## Counts",
    `- Modules: ${stats.modules}`,
    `- Functions: ${stats.functions}`,
    `- Classes: ${stats.classes}`,
    `- Interfaces: ${stats.interfaces}`,
    `- Type aliases: ${stats.typeAliases}`,
    `- Enums: ${stats.enums}`,
    `- Variables: ${stats.variables}`,
    "",
    "## Module Export Preview",
    ...(modulePreview.length > 0 ? modulePreview : ["- No modules found in spec."]),
    "",
    "## Regenerate",
    "```bash",
    "npm run docs:api",
    "```",
  ].join("\n");
}

function createHeadingId(text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `doc-${slug || "section"}-${index}`;
}

function parseDocBlocks(content: string): DocBlock[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: DocBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: headingMatch[2].trim() });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const listLine = lines[index].trim();
        const listMatch = listLine.match(/^[-*]\s+(.+)$/);
        if (!listMatch) break;
        items.push(listMatch[1].trim());
        index += 1;
      }
      if (items.length > 0) {
        blocks.push({ type: "list", items });
      }
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const nextTrimmed = lines[index].trim();
      if (
        !nextTrimmed ||
        nextTrimmed.startsWith("```") ||
        /^#{1,3}\s+/.test(nextTrimmed) ||
        /^[-*]\s+/.test(nextTrimmed)
      ) {
        break;
      }
      paragraph.push(nextTrimmed);
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    }
  }

  return blocks;
}

function defaultDocs(): DocEntry[] {
  return [
    {
      id: "fallback-architecture",
      title: "Mozaic Architecture",
      category: "Architecture",
      content:
        "# Overview\n- State buffer core\n- Bake pipeline\n- Pure runtime tick\n\n## Deep Dive\nSee docs/MOZAIC_ARCHITECTURE.md for the full architecture reference.",
    },
    {
      id: "fallback-editor",
      title: "Pixel Editor",
      category: "Editor",
      content:
        "# Core Features\n- Brush and eraser tools\n- Palette and color swap\n- Zoom, overlays, undo/redo\n- Debug layer selection\n\n## Tip\nUse Alt+Click in overlay mode to pick the nearest debug layer.",
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

  // Add loaded files to project tree
  const imgDataUrl = imageDataToDataUrl(runtime.imageData);
  const baseName = source.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "rom";
  const imgNode = createImageFile(
    `${baseName}.png`,
    imgDataUrl,
    runtime.imageData.width,
    runtime.imageData.height
  );
  addChild(runtime.project.root, imgNode);

  if (runtime.scriptText) {
    const scriptNode = createScriptFile(`${baseName}.msc`, runtime.scriptText);
    addChild(runtime.project.root, scriptNode);
    runtime.project.activeFileId = scriptNode.id;
  } else {
    runtime.project.activeFileId = imgNode.id;
  }
  saveProject(runtime.project);
  runtime.fileTreeView?.render();

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
    logic: buildEvaluatorLogic(createDefaultRegistry()),
    renderer: runtime.renderer,
    inputManager,
  });

  runtime.inputManager = inputManager;
  runtime.loop = loop;
  loop.start();
  resizeGameCanvas(ui);
}

/**
 * Boot the project via the Bootstrapper.
 *
 * Wraps {@link bootProject} by building the {@link BootContext} from
 * the current RuntimeState and applying the result back.
 */
async function bootWithContext(runtime: RuntimeState): Promise<void> {
  const ctx: BootContext = {
    inputDebugEl: runtime.ui.inputDebug,
    consoleEl: runtime.ui.compilerConsole,
    canvas: runtime.ui.canvas,
    renderer: runtime.renderer,
    project: runtime.project,
    editorImageData: runtime.imageData,
    hideTimer: runtime.bootHideTimer,
  };

  const result = await bootProject(ctx, runtime.loop, runtime.inputManager);
  runtime.bootHideTimer = ctx.hideTimer;

  if (!result) return;

  runtime.loop = result.loop;
  runtime.inputManager = result.inputManager;
  runtime.imageData = result.imageData;
  runtime.baked = result.baked;
  resizeGameCanvas(runtime.ui);
}

/**
 * Play Project — boots the engine using the master entry point.
 *
 * 1. Looks up the project's entryPointId (.msc file).
 * 2. Parses it and reads its Source: "..." property to find the image.
 * 3. Boots the engine loop with that script + image.
 *
 * Falls back to the legacy restart() if no entry point is configured.
 */
async function playProject(runtime: RuntimeState): Promise<void> {
  const { project } = runtime;

  // If no entry point, fall back to legacy behaviour
  if (!project.entryPointId) {
    restart(runtime);
    return;
  }

  const epNode = findNode(project.root, project.entryPointId);
  if (!epNode || epNode.fileType !== "script") {
    showStatus(runtime, "Entry point not found — falling back to active file.", "var(--warning)");
    restart(runtime);
    return;
  }

  // Parse the master script
  const scriptText = epNode.content ?? "";
  const { document: script, errors } = parseWithImports(scriptText, epNode.id, project);
  if (errors.length > 0) {
    runtime.ui.mscStatus.textContent = errors.join("; ");
    runtime.ui.mscStatus.style.color = "#d16969";
  }

  // Resolve the Source image.
  // First try relative resolution (from the entry-point's directory),
  // then fall back to an absolute path match in the project tree.
  let imageData: ImageData | null = null;
  if (script.source) {
    const imgNode = resolveImportPath(project.root, epNode.id, script.source)
      ?? findNodeByPath(project.root, script.source);
    if (imgNode && imgNode.fileType === "image" && imgNode.content) {
      try {
        imageData = await dataUrlToImageData(imgNode.content);
      } catch {
        showStatus(runtime, `Failed to load source image: ${script.source}`, "var(--danger)");
      }
    } else {
      showStatus(runtime, `Source image "${script.source}" not found in project.`, "var(--warning)");
    }
  }

  // Fall back to current imageData if source could not be resolved
  if (!imageData) {
    if (!runtime.imageData) {
      showPlaceholder(runtime.ui.canvas, "No image available.", "Ensure the entry point references a valid source image.");
      return;
    }
    imageData = runtime.imageData;
  }

  // Boot the engine loop
  runtime.loop?.stop();
  runtime.inputManager?.dispose();

  const cloned = cloneImageData(imageData);
  runtime.ui.canvas.width = cloned.width;
  runtime.ui.canvas.height = cloned.height;

  const bakedAsset = bake(cloned);
  const inputManager = new InputManager(collectBindings(script));
  const loop = new EngineLoop(createInitialState(cloned), {
    baked: bakedAsset,
    script,
    logic: buildEvaluatorLogic(createDefaultRegistry()),
    renderer: runtime.renderer,
    inputManager,
  });

  runtime.imageData = imageData;
  runtime.baked = bakedAsset;
  runtime.inputManager = inputManager;
  runtime.loop = loop;
  loop.start();
  resizeGameCanvas(runtime.ui);
}

function createNewRom(
  runtime: RuntimeState,
  variant: "empty" | "amiga" | "checkerboard" = "empty",
  paletteName?: string
): void {
  const { newRomWidth, newRomHeight, newRomColor } = runtime.config.game;

  // Generate image based on variant
  switch (variant) {
    case "amiga":
      runtime.imageData = createAmigaStyleRom();
      break;
    case "checkerboard":
      runtime.imageData = createCheckerboardRom(newRomWidth, newRomHeight);
      break;
    default:
      runtime.imageData = createBlankImageData(newRomWidth, newRomHeight, newRomColor);
      break;
  }

  runtime.baked = bake(runtime.imageData);
  runtime.scriptText = runtime.config.editor.defaultScript;
  persistScript(runtime.scriptText);

  // Clear old project and create fresh one
  const freshProject = createDefaultProject();
  runtime.project.root = freshProject.root;
  runtime.project.activeFileId = freshProject.activeFileId;
  runtime.project.entryPointId = freshProject.entryPointId;
  runtime.project.projectWidth = freshProject.projectWidth;
  runtime.project.projectHeight = freshProject.projectHeight;

  // Add the new image file to project
  const dataUrl = imageDataToDataUrl(runtime.imageData);
  const imgNode = createImageFile(
    `sprite_${Date.now().toString(36)}.png`,
    dataUrl,
    runtime.imageData.width,
    runtime.imageData.height
  );
  addChild(runtime.project.root, imgNode);
  runtime.project.activeFileId = imgNode.id;
  saveProject(runtime.project);
  runtime.fileTreeView?.render();

  // Apply palette if specified
  if (paletteName && runtime.pixelEditor) {
    runtime.pixelEditor.loadPalettePreset(paletteName);
  }

  switchEditorMode(runtime, "script");
  initPixelEditor(runtime);
  schedulePersistRom(runtime);
  restart(runtime);
  const variantLabel = variant === "amiga" ? "Amiga Demo" : variant === "checkerboard" ? "Checkerboard" : "Empty ROM";
  runtime.ui.mscStatus.textContent = `New ${runtime.imageData.width}×${runtime.imageData.height} ROM created (${variantLabel}).`;
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
    saveActiveFileContent(runtime);
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
  updateLineNumbers(runtime);
}

function switchEditorMode(runtime: RuntimeState, mode: EditorMode): void {
  runtime.editorMode = mode;
  if (mode === "script") {
    runtime.ui.textEditorTitle.textContent = "Script";
    const text = runtime.scriptText;
    setEditorText(runtime, text);
  } else if (mode === "config") {
    runtime.ui.textEditorTitle.textContent = "Config";
    setEditorText(runtime, runtime.configText);
  } else if (mode === "image") {
    // Image files are edited in the pixel tab; switch there
    runtime.ui.textEditorTitle.textContent = "Pixel";
  }
  updateEditorFileInfo(runtime);
  updateLineNumbers(runtime);
}

function refreshHighlight(runtime: RuntimeState): void {
  runtime.ui.mscHighlight.innerHTML =
    runtime.editorMode === "script"
      ? highlightMsc(runtime.ui.mscEditor.value)
      : highlightJson(runtime.ui.mscEditor.value);
}

function highlightMsc(source: string): string {
  const comments: string[] = [];
  let html = source
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) {
        const index = comments.push(escapeHtml(line)) - 1;
        return `\u0000MSC_COMMENT_${index}\u0000`;
      }
      return escapeHtml(line);
    })
    .join("\n");

  html = html.replace(/(["'][^"'\n]*["'])/g, '<span class="msc-string">$1</span>');
  html = html.replace(
    /^(\s*)(Entity\.[\w.]+|Source|Import|Schema|Events|Visual)(\s*:)/gm,
    '$1<span class="msc-keyword">$2</span>$3'
  );
  html = html.replace(/\$\w+/g, '<span class="msc-symbol">$&</span>');
  html = html.replace(/\u0000MSC_COMMENT_(\d+)\u0000/g, (_, index: string) => {
    return `<span class="msc-comment">${comments[Number(index)]}</span>`;
  });
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

    // Use import resolution if we have a project context
    if (runtime.project.activeFileId) {
      try {
        const { errors } = parseWithImports(
          runtime.scriptText,
          runtime.project.activeFileId,
          runtime.project
        );
        if (errors.length > 0) {
          runtime.ui.mscStatus.textContent = errors.join("; ");
          runtime.ui.mscStatus.style.color = "#d16969";
        } else {
          runtime.ui.mscStatus.textContent = "Script parsed successfully.";
          runtime.ui.mscStatus.style.color = "#6a9955";
        }
      } catch (error) {
        runtime.ui.mscStatus.textContent = `Parse error: ${String(error)}`;
        runtime.ui.mscStatus.style.color = "#d16969";
      }
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

  // If we have a project with an active file, use import resolution
  if (runtime.project.activeFileId) {
    const { document, errors } = parseWithImports(
      runtime.scriptText,
      runtime.project.activeFileId,
      runtime.project
    );
    if (errors.length > 0) {
      runtime.ui.mscStatus.textContent = errors.join("; ");
      runtime.ui.mscStatus.style.color = "#d16969";
      // Still return the partial document — non-fatal
    }
    return document;
  }

  try {
    return parseMsc(runtime.scriptText);
  } catch {
    runtime.ui.mscStatus.textContent = "Fix script errors before restarting.";
    runtime.ui.mscStatus.style.color = "#d16969";
    return null;
  }
}

/**
 * Intelligent swap: replace all occurrences of oldHex in the script text
 * with newHex (case-insensitive, both with and without # prefix).
 */
function swapColorInScript(runtime: RuntimeState, oldHex: string, newHex: string): void {
  if (runtime.editorMode !== "script") return;
  const old = oldHex.replace("#", "").toLowerCase();
  const next = newHex.replace("#", "").toLowerCase();
  if (old === next) return;

  // Escape any regex metacharacters (defensive — hex strings shouldn't have any)
  const escapedOld = old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`#?${escapedOld}`, "gi");
  const swapped = runtime.scriptText.replace(pattern, (match) =>
    match.startsWith("#") ? `#${next}` : next
  );
  if (swapped === runtime.scriptText) return;

  runtime.scriptText = swapped;
  persistScript(runtime.scriptText);
  setEditorText(runtime, runtime.scriptText);
  runtime.ui.mscStatus.textContent = `Color swap: ${oldHex} → ${newHex} applied in script.`;
  runtime.ui.mscStatus.style.color = "#6a9955";
}

async function applyPaletteColorToProjectImages(
  runtime: RuntimeState,
  oldHex: string,
  newHex: string
): Promise<void> {
  const oldClean = oldHex.replace("#", "").toLowerCase();
  const newClean = newHex.replace("#", "").toLowerCase();
  if (oldClean === newClean) return;

  const imageNodes = collectFiles(runtime.project.root, "image");
  if (imageNodes.length === 0) return;

  const [oR, oG, oB] = hexToRgb(oldHex);
  const [nR, nG, nB] = hexToRgb(newHex);

  let updatedCount = 0;
  let decodeErrors = 0;

  for (const node of imageNodes) {
    if (!node.content) continue;

    if (node.id === runtime.project.activeFileId && runtime.imageData) {
      node.content = imageDataToDataUrl(runtime.imageData);
      node.imageWidth = runtime.imageData.width;
      node.imageHeight = runtime.imageData.height;
      updatedCount += 1;
      continue;
    }

    try {
      const imageData = await dataUrlToImageData(node.content);
      let changed = false;
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === oR && data[i + 1] === oG && data[i + 2] === oB) {
          data[i] = nR;
          data[i + 1] = nG;
          data[i + 2] = nB;
          changed = true;
        }
      }

      if (!changed) continue;

      node.content = imageDataToDataUrl(imageData);
      node.imageWidth = imageData.width;
      node.imageHeight = imageData.height;
      updatedCount += 1;
    } catch {
      decodeErrors += 1;
    }
  }

  if (updatedCount === 0 && decodeErrors === 0) return;

  saveProject(runtime.project);
  runtime.fileTreeView?.render();

  if (decodeErrors > 0) {
    showStatus(
      runtime,
      `Palette remap updated ${updatedCount} image file(s), ${decodeErrors} failed to decode.`,
      "var(--warning)"
    );
    return;
  }

  showStatus(runtime, `Palette remap updated ${updatedCount} image file(s).`, "var(--success)");
}

/**
 * Render named palette color chips in the script editor bar.
 * Only named colors are shown; clicking inserts the hex at cursor.
 */
function renderPaletteChips(runtime: RuntimeState): void {
  const container = document.getElementById("palette-color-chips");
  if (!container) return;
  container.innerHTML = "";

  const colors = runtime.pixelEditor?.getPaletteColors() ?? [];
  const named = colors.filter((c) => c.name);
  if (named.length === 0) return;

  const label = document.createElement("span");
  label.id = "palette-chips-label";
  label.textContent = "Colors:";
  container.appendChild(label);

  for (const color of named) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "palette-chip";
    chip.title = `Insert ${color.hex} (${color.name}) at cursor`;

    const swatch = document.createElement("span");
    swatch.className = "palette-chip-swatch";
    swatch.style.background = color.hex;
    chip.appendChild(swatch);
    chip.appendChild(document.createTextNode(color.name!));

    chip.addEventListener("click", () => {
      insertAtCursor(runtime.ui.mscEditor, color.hex);
      runtime.scriptText = runtime.ui.mscEditor.value;
      persistScript(runtime.scriptText);
      refreshHighlight(runtime);
      validateEditor(runtime);
    });

    container.appendChild(chip);
  }
}

/**
 * Render all palette colors as small swatches in the text editor bar.
 * Clicking a swatch inserts its hex value at the cursor position.
 */
function renderEditorUsedColors(runtime: RuntimeState): void {
  const container = runtime.ui.editorUsedColors;
  if (!container) return;
  container.innerHTML = "";

  const colors = runtime.pixelEditor?.getPaletteColors() ?? [];
  if (colors.length === 0) return;

  for (const color of colors) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "editor-color-swatch";
    swatch.style.background = color.hex;
    swatch.title = color.name ? `${color.name} (${color.hex})` : color.hex;

    swatch.addEventListener("click", () => {
      insertAtCursor(runtime.ui.mscEditor, color.hex);
      runtime.scriptText = runtime.ui.mscEditor.value;
      persistScript(runtime.scriptText);
      refreshHighlight(runtime);
      validateEditor(runtime);
    });

    container.appendChild(swatch);
  }
}

function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
}

function createCheckerboardRom(w = 64, h = 64): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  const cellSize = 8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isLight = ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2) === 0;
      const i = (y * w + x) * 4;
      const v = isLight ? 40 : 20;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
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
  return { imports: [], schema: {}, entities: {}, events: [], sprites: new Map(), spriteGrid: 0 };
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

/**
 * Insert text at the current cursor position in a textarea.
 * If text is selected, the selection is replaced.
 */
function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + text + after;
  const cursor = start + text.length;
  textarea.selectionStart = cursor;
  textarea.selectionEnd = cursor;
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Update file name displays in editor toolbars, header, and status bar. */
function updateEditorFileInfo(runtime: RuntimeState): void {
  const { ui, project } = runtime;
  const activeId = project.activeFileId;
  const node = activeId ? findNode(project.root, activeId) : null;

  if (node) {
    ui.editorFileName.textContent = node.name;
    ui.headerFileInfo.innerHTML = `<span class="header-file-dot"></span> ${escapeHtml(node.name)}`;
    ui.statusFileInfo.innerHTML = `<span style="color:#6a9955">${escapeHtml(node.name)}</span> \u2014 ${node.fileType ?? "file"}`;
    ui.editorModifiedDot.hidden = true;

    if (node.fileType === "script") {
      ui.editorFileIcon.innerHTML = `<svg viewBox="0 0 16 16"><path d="M4 2h6l3 3v9H4z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 2v3h3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
    } else {
      ui.editorFileIcon.innerHTML = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
      
      if (node.name.endsWith(".mzk")) {
        ui.headerFileInfo.innerHTML += ` <span style="font-size: 0.8em; background: var(--accent); color: #fff; padding: 1px 4px; border-radius: 3px;">MZK</span>`;
      }
    }

    if (node.fileType === "image") {
      ui.pixelFileName.textContent = node.name;
      const w = node.imageWidth ?? runtime.imageData?.width ?? 0;
      const h = node.imageHeight ?? runtime.imageData?.height ?? 0;
      ui.pixelFileSize.textContent = w && h ? `${w}\u00d7${h}` : "";
    }
  } else {
    ui.editorFileName.textContent = "No file open";
    ui.headerFileInfo.innerHTML = `<span class="header-file-dot" style="background:var(--text-dim)"></span> No file`;
    ui.statusFileInfo.textContent = "No file open";
    ui.pixelFileName.textContent = "No image";
    ui.pixelFileSize.textContent = "";
  }
}

/** Update line number gutter in the text editor. */
function updateLineNumbers(runtime: RuntimeState): void {
  const { ui } = runtime;
  const text = ui.mscEditor.value;
  const lineCount = text.split("\n").length;
  const nums: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    nums.push(String(i));
  }
  ui.lineNumbers.textContent = nums.join("\n");
}

/** Download the currently active script file. */
function downloadCurrentFile(runtime: RuntimeState): void {
  const node = runtime.project.activeFileId
    ? findNode(runtime.project.root, runtime.project.activeFileId)
    : null;
  if (!node || node.fileType !== "script") {
    showStatus(runtime, "No script file to download.", "var(--danger)");
    return;
  }
  const blob = new Blob([node.content ?? ""], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = node.name;
  link.click();
  URL.revokeObjectURL(link.href);
  showStatus(runtime, `Downloaded ${node.name}`, "var(--success)");
}

/** Download the current pixel editor image as PNG. */
function downloadCurrentImage(runtime: RuntimeState): void {
  if (!runtime.imageData) {
    showStatus(runtime, "No image to download.", "var(--danger)");
    return;
  }
  const node = runtime.project.activeFileId
    ? findNode(runtime.project.root, runtime.project.activeFileId)
    : null;
  const fileName = node?.name ?? `sprite_${Date.now()}.png`;

  const canvas = document.createElement("canvas");
  canvas.width = runtime.imageData.width;
  canvas.height = runtime.imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(runtime.imageData, 0, 0);

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  link.click();
  showStatus(runtime, `Downloaded ${link.download}`, "var(--success)");
}

/** Show a status message in the status bar and editor status. */
function showStatus(runtime: RuntimeState, text: string, color: string): void {
  runtime.ui.mscStatus.textContent = text;
  runtime.ui.mscStatus.style.color = color;
  runtime.ui.statusFileInfo.innerHTML = `<span style="color:${color}">${escapeHtml(text)}</span>`;
  // Auto-restore after 3 seconds
  setTimeout(() => updateEditorFileInfo(runtime), 3000);
}

const WORD_CHAR_RE = /[\w.$:]/;

function getCurrentWord(textarea: HTMLTextAreaElement): { word: string; start: number } {
  const pos = textarea.selectionStart;
  const text = textarea.value;
  let start = pos;
  while (start > 0 && WORD_CHAR_RE.test(text[start - 1])) {
    start--;
  }
  return { word: text.substring(start, pos), start };
}

// ── Editor file tabs ──────────────────────────────────────────

/** Render (or re-render) the file tabs bar above the script editor. */
function renderEditorTabs(runtime: RuntimeState): void {
  const container = document.getElementById("editor-tabs");
  if (!container) return;
  container.innerHTML = "";

  for (const fileId of runtime.openFileIds) {
    const node = findNode(runtime.project.root, fileId);
    if (!node) continue;

    const tab = document.createElement("div");
    tab.className = "editor-tab";
    tab.role = "tab";
    tab.setAttribute("aria-selected", fileId === runtime.project.activeFileId ? "true" : "false");
    if (fileId === runtime.project.activeFileId) {
      tab.classList.add("is-active");
    }

    const label = document.createElement("span");
    label.className = "editor-tab-label";
    label.textContent = node.name;
    tab.appendChild(label);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "editor-tab-close";
    closeBtn.title = "Close tab";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeFileTab(runtime, fileId);
    });
    tab.appendChild(closeBtn);

    tab.addEventListener("click", () => {
      const fileNode = findNode(runtime.project.root, fileId);
      if (fileNode) void openFileNode(runtime, fileNode);
    });

    container.appendChild(tab);
  }
}

/** Close a file tab and switch to the nearest remaining tab. */
function closeFileTab(runtime: RuntimeState, fileId: string): void {
  const idx = runtime.openFileIds.indexOf(fileId);
  if (idx === -1) return;
  runtime.openFileIds.splice(idx, 1);

  if (runtime.project.activeFileId === fileId) {
    const nextId =
      runtime.openFileIds[idx] ?? runtime.openFileIds[idx - 1] ?? null;
    if (nextId) {
      const nextNode = findNode(runtime.project.root, nextId);
      if (nextNode) {
        void openFileNode(runtime, nextNode);
        return;
      }
    }
    runtime.project.activeFileId = null;
    runtime.scriptText = "";
    setEditorText(runtime, "");
    updateEditorFileInfo(runtime);
    saveProject(runtime.project);
  }

  renderEditorTabs(runtime);
}

// ── Ctrl+Click helpers ────────────────────────────────────────

/**
 * Extract a potential import filename from the given line at the given column.
 * Supports:
 *   - Import: "filename"  (Import statement)
 *   - Import: filename    (unquoted import)
 *   - Any quoted string containing a dot (generic file reference)
 */
function extractImportFilename(line: string, cursorCol: number): string | null {
  // 1. Import statement (highest priority)
  const importLineMatch = line.match(
    /^\s*Import\s*:\s*(?:"([^"]+)"|(\S+))/
  );
  if (importLineMatch) {
    return importLineMatch[1] ?? importLineMatch[2] ?? null;
  }

  // 2. Quoted string around the cursor that looks like a filename
  const quoteRe = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(line)) !== null) {
    if (cursorCol >= m.index && cursorCol <= quoteRe.lastIndex) {
      if (m[1].includes(".")) return m[1];
    }
  }

  return null;
}

/**
 * Open an existing project file by name, or create it if it doesn't exist.
 * Used by the Ctrl+Click "go to file" action.
 */
function openOrCreateFileByName(runtime: RuntimeState, filename: string): void {
  // Resolve relative to the active file's directory
  if (runtime.project.activeFileId) {
    const target = resolveImportPath(
      runtime.project.root,
      runtime.project.activeFileId,
      filename
    );
    if (target && target.kind === "file") {
      void openFileNode(runtime, target);
      return;
    }
  }

  // Fallback: search all files by name
  const allFiles = collectFiles(runtime.project.root);
  const existing = allFiles.find((f) => f.name === filename);
  if (existing) {
    void openFileNode(runtime, existing);
    return;
  }

  // File not found — create it as a sibling to the current active file
  const parent = runtime.project.activeFileId
    ? (findParent(runtime.project.root, runtime.project.activeFileId) ??
       runtime.project.root)
    : runtime.project.root;

  const isImage = hasImageExtension(filename);
  let newNode: FileNode;
  if (isImage) {
    const canvas = document.createElement("canvas");
    canvas.width = runtime.project.projectWidth;
    canvas.height = runtime.project.projectHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    newNode = createImageFile(filename, canvas.toDataURL("image/png"), canvas.width, canvas.height);
  } else {
    newNode = createScriptFile(filename, "# New script\n");
  }
  addChild(parent, newNode);
  saveProject(runtime.project);
  runtime.fileTreeView?.render();
  void openFileNode(runtime, newNode);
  showStatus(runtime, `Created: ${filename}`, "var(--success)");
}

main().catch(console.error);
