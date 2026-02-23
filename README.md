# Mozaic

Browser-based engine for building **SpriteROMs** — games where logic, assets, and memory state are unified into image files and declarative scripts.

## Architecture

Mozaic is a **Pure Functional Reactive** engine with a *State-as-Pixels* model and a load-time baking phase.

### Bake-on-Load Phase (Initialization)
When an asset is loaded the engine performs expensive analysis once:
- **Marching Squares** — traces alpha channels to cache collision polygons.
- **Bezier / Catmull-Rom tracing** — converts pixel paths to spline arrays.
- **Audio pre-load** — scans 16×16 / 32×32 sequencer grids.

### Pure Execution Loop (Per Frame)
```
NextState = LogicCore(CurrentState, InputTextMap, Ruleset)
```
1. **Sample** — read hardware input mapped via the `.msc` file.
2. **Process** — apply cached physics and `.msc` logic to the State Buffer.
3. **Write** — generate the new State Buffer.
4. **Render** — push visuals to WebGL.

## File Formats

| Format | Extension | Purpose |
|--------|-----------|---------|
| **Mozaic Kinetic Asset** | `.mzk` | Combined image + metadata (primary ROM format) |
| **Mozaic Script** | `.msc` | Game logic, input mapping, and linker directives |
| **Image** | `.png` / `.jpg` | Standard raster images with Mozaic-signature detection |
| **Text Script** | `.txt` / `.yaml` | Plain-text sidecar scripts (alt. to `.msc`) |

**Loading precedence:** `.mzk` files load with embedded `.msc`; standalone `.png`/`.jpg` files pair with `.msc`/`.txt` sidecars by name matching.

## Getting Started

```bash
npm install
npm run dev        # start Vite dev server
npm run build      # TypeScript compile + Vite build
npm test           # run Vitest tests
```

Load a SpriteROM by passing the `src` query parameter:

```
http://localhost:5173/?src=level_1.mzk
```

Or open one directly from your filesystem by starting the app without `src`
and clicking **Open ROM**.

In-app tools:
- **New ROM**: creates a fresh blank `64x64` ROM and starts the engine with it.
- **Restart**: reboots the engine using current ROM pixels + current script editor text.
- **MSC Editor**: edit script text with syntax highlighting, then press **Restart**.
- **Pixel Editor**: paint pixels directly on the loaded ROM, then press **Restart**.
- **Pixel Editor Polish**: zoom slider, brush size, eraser mode, palette swatches (with add), right-click eyedropper, inline grid, and custom grid with major lines.
- **Pixel Editor Navigation**:
  - Smooth pinch-to-zoom with fractional zoom levels and exponential smoothing
  - Scroll-wheel zoom at cursor position
  - Middle-mouse or Space+drag panning
  - Stylus-only mode (touch navigates, pen draws)
  - Pressure and tilt sensitivity
- **Editing Workflow**: Undo, Redo, Clear actions, plus live cursor coordinates in the editor footer.
- **Tool Presets**: one-click `Pencil 1px`, `Brush 3px`, and `Eraser` presets.
- **Bake Debug Overlay**: toggle collision polygons and baked path lines directly in the pixel editor preview.
- **Debug Layers**: optional control points and indexed IDs for both collision and path overlays.
- **Layer Picking**: hold `Alt` and click near an overlay line to select/highlight that collision or path ID.
- **Save ROM**: exports the current edited ROM buffer as a `.png` file.
- **Docs Pane**: toggleable in-app documentation panel with live search over architecture/editor topics.

The latest edited ROM and script text are stored in browser memory and restored automatically after refresh when no `?src` is provided.

## Runtime Configuration

Edit [public/mozaic.config.json](public/mozaic.config.json) to change editor/game defaults without code changes.

- Use **Edit Config** in the app to load config JSON into the built-in text editor with syntax highlighting.
- Press **Reload Config** to apply the edited JSON instantly.
- `game.newRomWidth`, `game.newRomHeight`, `game.newRomColor` control **New ROM** defaults.
- `game.autoCreateOnStart` creates a ROM automatically on load.
- `game.autoLoadSrc` can auto-load an asset path (same as `?src=...`).
- `editor.defaultPixelColor`, `editor.defaultScript` set editor defaults.
- `editor.showScriptEditor`, `editor.showPixelEditor` toggle tool panel sections.

## Project Structure

```
src/
  index.ts              Engine entry point
  engine/
    memory.ts           State Buffer memory layout + Int8/16/24 access
    loader.ts           Dual-Layer Loader (.mzk/.png + .msc/.txt)
    baker.ts            Bake-on-Load phase
    loop.ts             Pure Execution Loop
    physics.ts          Physics & Collision (Marching Squares + color triggers)
    pathfinding.ts      Kinetic Pathfinding (Catmull-Rom / Bezier)
    audio.ts            Audio Sequencer (pixel piano roll)
    input.ts            Input Mapping (keyboard + gamepad)
    pool.ts             Zero-allocation object pools (RingBuffer, ObjectPool, EntityFreeList)
    renderer.ts         WebGL Renderer
  editor/
    pixel-editor.ts     Orchestrator wiring camera, layers, tools, input, palette, history
    camera.ts           Virtual camera (pan, zoom, pivot-anchored pinch-zoom)
    input-handler.ts    Pointer/touch/wheel routing with pinch-to-zoom & palm rejection
    layers.ts           Multi-canvas layer stack (background, document, draft, grid)
    tools.ts            Tool strategies (draw, erase, fill, select, pipette, entity brush)
    palette.ts          Indexed color management with preset library
    history.ts          Undo/redo stack with snapshot compression
    grid-overlay.ts     Pixel grid, collision polygon, and path overlays
    file-system.ts      Virtual file tree with project I/O
    types.ts            Shared TypeScript type definitions
  parser/
    lexer.ts            MSC lexer (tokenization)
    ast.ts              MSC AST generator from token stream
    msc.ts              Parser façade (parseMsc)
  __tests__/            Unit tests (Vitest)
```

Architecture blueprint: [docs/MOZAIC_ARCHITECTURE.md](docs/MOZAIC_ARCHITECTURE.md)
Autogenerated API spec: [docs/API_SPEC.md](docs/API_SPEC.md)
Start here (in-app): Tutorial Hub in [public/docs/search-index.json](public/docs/search-index.json)
Hands-on tutorial: [docs/TUTORIAL.md](docs/TUTORIAL.md)
Multi-file tutorial: [docs/TUTORIAL_MULTIFILE.md](docs/TUTORIAL_MULTIFILE.md)
Team conventions tutorial: [docs/TUTORIAL_TEAM_CONVENTIONS.md](docs/TUTORIAL_TEAM_CONVENTIONS.md)

Contributor docs sync:
- Cross-link map between architecture and in-editor docs: [docs/MOZAIC_ARCHITECTURE.md](docs/MOZAIC_ARCHITECTURE.md)
- In-editor searchable docs source: [public/docs/search-index.json](public/docs/search-index.json)