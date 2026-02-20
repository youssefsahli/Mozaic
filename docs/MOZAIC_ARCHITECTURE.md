# MOZAIC ENGINE: Technical Architecture & Implementation Plan
Version: 1.2.0 (Technical Deep-Dive)

This document is the implementation blueprint for the Mozaic Engine and SpriteROM compiler. It defines memory layout, bake/runtime pipelines, AST contract, and the development roadmap.

## 1. Internal Memory Structure (State Buffer)
Mozaic uses a functional state model: all runtime game state lives in a `Uint8ClampedArray` backed by RGBA pixel memory.

### A. 64x64 State Grid
A 64x64 RGBA grid contains `16,384` bytes (`64 * 64 * 4`).

| Block Name | Byte Range | Pixel Range | Purpose |
| --- | --- | --- | --- |
| Header Block | `0 - 63` | `[0,0]` to `[15,0]` | Engine version, current scene ID, RNG seed |
| Global Regs | `64 - 511` | `[16,0]` to `[63,1]` | Global variables (`$Score`, `$Time`, flags) |
| Entity Pool | `512 - 12287` | `[0,2]` to `[63,47]` | Fixed-size slots for active objects |
| Audio/FX State | `12288 - 16383` | `[0,48]` to `[63,63]` | Sequencer heads, camera shake vectors |

### B. Data Encoding
- Int8: stored in `R`
- Int16: stored in `R,G` as `value = (R << 8) | G`
- Int24: stored in `R,G,B`

## 2. Engine Pipelines

### Pipeline A: Bake (Initialization)
Triggered once on load or when editor assets change.
1. Asset fetch (`.mzk`, `.msc`) into memory buffers.
2. `.msc` parsing into AST JSON.
3. Collision extraction via Marching Squares + simplification (RDP), cached as polygons.
4. Path extraction via color channels to Catmull-Rom/Bezier path cache.

### Pipeline B: Runtime Tick (60 FPS)
Triggered by `requestAnimationFrame`.
1. Poll hardware input and map to actions.
2. Physics broad phase (AABB) then narrow phase (polygon intersections).
3. Dispatch events and evaluate AST actions.
4. Produce next immutable state buffer.
5. Render via WebGL and advance sequencer tick.

## 3. AST Contract
Runtime executes structured AST data only; it does not parse `.msc` text during gameplay.

```json
{
  "type": "EventDefinition",
  "trigger": "Collision",
  "participants": ["Hero:#Feet", "Level:#FFFF00"],
  "actions": [
    {
      "command": "State.Write",
      "target": "$Player_Grounded",
      "value": 1
    }
  ]
}
```

## 4. Implementation Roadmap

### Phase 1: Core Memory + Loader
- Build loader and memory read/write API (Int8/16/24, XY byte offsets).
- Milestone: exact values read from `.mzk` bytes.

### Phase 2: `.msc` Compiler
- Implement lexer + parser.
- Generate structured nested AST output.
- Milestone: valid AST generated for full script fixtures.

### Phase 3: Baking Engine
- Collision (Marching Squares + simplification).
- Path extraction and spline conversion.
- Audio grid scanning.
- Milestone: debug geometry overlays match source art.

### Phase 4: Pure Loop + Renderer
- Pure tick function and deterministic state updates.
- Integrate polygon collision solver.
- Render from state buffer-driven transforms.
- Zero-allocation object pools (`RingBuffer`, `ObjectPool`, `EntityFreeList`) to eliminate GC pressure.
- Milestone: playable movement and collisions from script/state only.

### Phase 5: Studio UI
- Three-pane workflow (script editor, pixel editor, preview).
- Hot-reload bake pipeline without dropping state.
- State inspector tooling.
- Milestone: live paint + code edit reflected instantly in preview.

## 5. Module Reference

| Module | Purpose |
| --- | --- |
| `engine/memory.ts` | State buffer layout constants + Int8/Int16/Int24 read-write helpers |
| `engine/loader.ts` | Dual-layer asset loader (image + sidecar script, Mozaic signature detection) |
| `engine/baker.ts` | Bake phase: Marching Squares, RDP simplification, Bezier paths, audio grid scan |
| `engine/loop.ts` | Pure execution loop (`requestAnimationFrame`-driven, pluggable `LogicFn`) |
| `engine/physics.ts` | AABB broad phase, ray-cast point-in-polygon, color-trigger collision detection |
| `engine/pathfinding.ts` | Pixel-path tracing + Catmull-Rom spline generation |
| `engine/audio.ts` | Pixel-piano-roll sequencer (16×16 / 32×32), WebAudio scheduling |
| `engine/input.ts` | Keyboard + gamepad polling, action-map sampling |
| `engine/pool.ts` | Zero-alloc `RingBuffer`, `ObjectPool`, and `EntityFreeList` |
| `engine/renderer.ts` | WebGL full-screen quad renderer (NEAREST-filtered texture) |
| `parser/lexer.ts` | MSC tokenizer — line-by-line YAML-like token stream |
| `parser/ast.ts` | Token-stream → `MscDocument` AST builder |
| `parser/msc.ts` | Public `parseMsc(source)` façade |
