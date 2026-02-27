# Mozaic Architecture

Technical architecture of the Mozaic engine and SpriteROM runtime.

## 1. Memory Layout (State Buffer)

All runtime state lives in a single `Uint8ClampedArray` backed by a 64×64 RGBA pixel grid (16,384 bytes).

| Region | Byte Range | Purpose |
|--------|-----------|---------|
| Header | `0 – 63` | Engine version, scene ID, RNG seed |
| Globals | `64 – 511` | Schema variables (`$Score`, `$Time`, flags) |
| Entity Pool | `512 – 12287` | Fixed-size slots for active entities |
| Audio/FX | `12288 – 16383` | Sequencer heads, camera shake offsets |

### Data Encoding
- **Int8** — single byte (`R` channel)
- **Int16** — two bytes (`R,G`), value = `(R << 8) | G`
- **Int24** — three bytes (`R,G,B`)

## 2. Pipelines

### Bake (Initialization)
Runs once on load or when editor assets change.

1. Fetch `.mzk` / `.msc` assets into memory buffers.
2. Parse `.msc` source into an AST via the parser.
3. Extract collision polygons (Marching Squares + RDP simplification).
4. Extract Bezier / Catmull-Rom path splines from color channels.
5. Scan audio sequencer grids.

### Runtime Tick (60 FPS)
Runs every frame via `requestAnimationFrame`.

1. **Sample** — poll keyboard/gamepad input, map to actions.
2. **Process** — run broad-phase (AABB) and narrow-phase (polygon) collision checks.
3. **Evaluate** — execute component ticks and script rules against the state buffer.
4. **Write** — produce the next immutable state buffer.
5. **Render** — push state to WebGL and advance audio sequencer.

### AST Contract
The runtime executes structured AST data only — no `.msc` text is parsed during gameplay.

## 3. Component System

Entities gain behavior through components registered in the `ComponentRegistry`. Each component is a stateless tick function that reads an entity's memory slot, performs logic, and writes back.

**23 built-in components** are organized into seven libraries:

| Library | Components |
|---------|------------|
| Physics & Kinematics | Gravity, Kinematic, Collider, Friction |
| Controllers | PlayerController, TopDownController, PlatformController |
| Gameplay | Health, Lifetime, Navigator |
| Combat | Hitbox |
| AI & Logic | Wanderer, Chaser, Spawner |
| Interaction | Interactable, AreaTrigger |
| Drawing & Effects | Camera, ScreenShake, SpriteAnimator, ParticleEmitter |
| Experimental | SineWave, Patrol, Blink |

Some components expose **context variables** (e.g. `$vx`, `$vy`, `$hp`, `$triggered`) that can be used in entity state conditions.

Full component reference: [COMPONENTS.md](COMPONENTS.md)

## 4. Module Reference

### Engine

| Module | Purpose |
|--------|---------|
| `engine/components.ts` | Component registry and 23 built-in component implementations |
| `engine/memory.ts` | State buffer layout constants and Int8/16/24 read-write helpers |
| `engine/loader.ts` | Dual-layer asset loader (image + sidecar script, signature detection) |
| `engine/baker.ts` | Bake phase: Marching Squares, RDP, Bezier paths, audio grid scan |
| `engine/evaluator.ts` | MSC AST evaluation, entity state machine, component dispatch |
| `engine/loop.ts` | Pure execution loop (`requestAnimationFrame`, pluggable `LogicFn`) |
| `engine/physics.ts` | AABB broad phase, point-in-polygon, color-trigger collision |
| `engine/pathfinding.ts` | Pixel-path tracing and Catmull-Rom spline generation |
| `engine/audio.ts` | Pixel piano-roll sequencer (16×16 / 32×32), WebAudio scheduling |
| `engine/input.ts` | Keyboard + gamepad polling and action-map sampling |
| `engine/pool.ts` | Zero-allocation `RingBuffer`, `ObjectPool`, `EntityFreeList` |
| `engine/renderer.ts` | WebGL renderer with sprite atlas and layer support |

### Editor

| Module | Purpose |
|--------|---------|
| `editor/pixel-editor.ts` | Orchestrator wiring camera, layers, tools, input, palette, history |
| `editor/camera.ts` | Virtual camera with pan/zoom and pivot-anchored pinch support |
| `editor/input-handler.ts` | Pointer/touch/wheel routing with pinch-to-zoom and palm rejection |
| `editor/layers.ts` | Multi-canvas layer stack (background, document, draft, grid) |
| `editor/tools.ts` | Tool strategies: draw, erase, fill, select, pipette, entity brush |
| `editor/palette.ts` | Indexed color management with preset library |
| `editor/history.ts` | Undo/redo stack with snapshot compression |
| `editor/grid-overlay.ts` | Pixel grid, collision polygon, and path overlays |
| `editor/file-system.ts` | Virtual file tree with project I/O |
| `editor/types.ts` | Shared TypeScript type definitions |

### Parser

| Module | Purpose |
|--------|---------|
| `parser/lexer.ts` | MSC tokenizer — line-by-line YAML-like token stream |
| `parser/ast.ts` | Token stream → `MscDocument` AST builder |
| `parser/msc.ts` | Public `parseMsc(source)` façade |

## 5. In-Editor Documentation

The **Docs** tab mirrors this guide through searchable entries in `public/docs/search-index.json`.

When adding or changing modules or components, update the corresponding entries in `search-index.json` so in-editor documentation stays aligned.
