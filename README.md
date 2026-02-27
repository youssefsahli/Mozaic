# Mozaic

Browser-based engine for building **SpriteROMs** — games where logic, assets, and memory state are unified into image files and declarative scripts.

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

Or open the app without `src` and click **Open ROM** to load from your filesystem.

## How It Works

Mozaic follows a **bake → tick → render** model:

1. **Bake** (once on load) — extract collision polygons, Bezier paths, and audio grids from ROM pixels.
2. **Tick** (60 FPS) — sample input, run physics and script logic, produce the next state buffer.
3. **Render** — push the state to WebGL.

Game logic is defined in `.msc` scripts — a declarative YAML-like DSL for entities, input, events, and components.

## Components

Components are behaviors you attach to entities. Mozaic ships with **23 built-in components** across seven categories:

| Category | Components |
|----------|------------|
| **Physics** | Gravity, Kinematic, Collider, Friction |
| **Controllers** | PlayerController, TopDownController, PlatformController |
| **Gameplay** | Health, Lifetime, Navigator |
| **Combat** | Hitbox |
| **AI & Logic** | Wanderer, Chaser, Spawner |
| **Interaction** | Interactable, AreaTrigger |
| **Effects** | Camera, ScreenShake, SpriteAnimator, ParticleEmitter |
| **Experimental** | SineWave, Patrol, Blink |

**Full reference with props, context variables, and examples:** [docs/COMPONENTS.md](docs/COMPONENTS.md)

## File Formats

| Format | Extension | Purpose |
|--------|-----------|---------|
| **Mozaic Kinetic Asset** | `.mzk` | Combined image + metadata (primary ROM format) |
| **Mozaic Script** | `.msc` | Game logic, input mapping, and linker directives |
| **Image** | `.png` / `.jpg` | Standard raster images with Mozaic-signature detection |
| **Text Script** | `.txt` / `.yaml` | Plain-text sidecar scripts (alt. to `.msc`) |

`.mzk` files load with embedded `.msc`; standalone images pair with `.msc`/`.txt` sidecars by name matching.

## In-App Tools

| Tool | Description |
|------|-------------|
| **New ROM** | Create a blank 64×64 ROM |
| **Restart** | Reboot the engine with current ROM pixels + script |
| **Script Editor** | MSC editing with syntax highlighting |
| **Pixel Editor** | Paint directly on the ROM — pencil, brush, eraser, fill, pipette, palette swatches, undo/redo |
| **Debug Overlay** | Toggle collision polygons, paths, and IDs; Alt+Click to pick a debug layer |
| **Save ROM** | Export ROM as `.png` |
| **Docs Pane** | Searchable in-app documentation |

Pixel editor supports scroll-wheel zoom, Space+drag panning, pinch-to-zoom on touch, stylus-only mode, and pressure/tilt sensitivity.

Edited ROM and script text persist in browser storage and restore on refresh.

## Configuration

Edit [public/mozaic.config.json](public/mozaic.config.json) or use **Edit Config** in-app.

Key settings: `game.newRomWidth/Height/Color`, `game.autoCreateOnStart`, `game.autoLoadSrc`, `editor.defaultScript`, `editor.showScriptEditor`, `editor.showPixelEditor`.

## Project Structure

```
src/
  index.ts              Engine entry point
  engine/
    components.ts       ECS component registry & 23 built-in components
    memory.ts           State buffer layout + Int8/16/24 access
    loader.ts           Dual-layer loader (.mzk/.png + .msc/.txt)
    baker.ts            Bake-on-load phase (collision, paths, audio)
    loop.ts             Pure execution loop (60 FPS)
    evaluator.ts        MSC AST evaluation and state transitions
    physics.ts          AABB broad phase + polygon collision
    pathfinding.ts      Pixel-path tracing + Catmull-Rom splines
    audio.ts            Pixel piano-roll sequencer
    input.ts            Keyboard + gamepad input mapping
    pool.ts             Zero-allocation object pools
    renderer.ts         WebGL renderer with layer support
  editor/
    pixel-editor.ts     Editor orchestrator
    camera.ts           Virtual camera (pan, zoom, pinch)
    input-handler.ts    Pointer/touch/wheel routing
    layers.ts           Multi-canvas layer stack
    tools.ts            Tool strategies (draw, erase, fill, select, pipette)
    palette.ts          Color management with presets
    history.ts          Undo/redo with snapshot compression
    grid-overlay.ts     Grid, collision, and path overlays
    file-system.ts      Virtual file tree with project I/O
    types.ts            Shared editor types
  parser/
    lexer.ts            MSC tokenizer
    ast.ts              MSC AST builder
    msc.ts              Parser façade (parseMsc)
  __tests__/            Unit tests (Vitest)
```

## Documentation

| Document | Description |
|----------|-------------|
| [docs/COMPONENTS.md](docs/COMPONENTS.md) | Complete component reference — props, context variables, examples |
| [docs/ENTITY_STATES.md](docs/ENTITY_STATES.md) | Entity state conditions and overrides |
| [docs/MOZAIC_ARCHITECTURE.md](docs/MOZAIC_ARCHITECTURE.md) | Technical architecture and memory layout |
| [docs/TUTORIAL.md](docs/TUTORIAL.md) | Build your first playable ROM |
| [docs/TUTORIAL_MULTIFILE.md](docs/TUTORIAL_MULTIFILE.md) | Multi-file project workflow |
| [docs/TUTORIAL_TEAM_CONVENTIONS.md](docs/TUTORIAL_TEAM_CONVENTIONS.md) | Team naming and schema conventions |
| [docs/API_SPEC.md](docs/API_SPEC.md) | Autogenerated API specification |

In-editor searchable docs: [public/docs/search-index.json](public/docs/search-index.json)