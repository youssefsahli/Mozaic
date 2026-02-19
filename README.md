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

| Extension | Purpose |
|-----------|---------|
| `.mzk`    | Mozaic Kinetic Asset (image) |
| `.msc`    | Mozaic Script (logic / linker) |
| `.png` / `.jpg` | Standard images (Mozaic-signature detection) |
| `.txt` / `.yaml` | Plain-text sidecar scripts |

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

## Project Structure

```
src/
  index.ts              Engine entry point
  engine/
    loader.ts           Dual-Layer Loader (.mzk/.png + .msc/.txt)
    baker.ts            Bake-on-Load phase
    loop.ts             Pure Execution Loop
    physics.ts          Physics & Collision (Marching Squares + color triggers)
    pathfinding.ts      Kinetic Pathfinding (Catmull-Rom / Bezier)
    audio.ts            Audio Sequencer (pixel piano roll)
    input.ts            Input Mapping (keyboard + gamepad)
    renderer.ts         WebGL Renderer
  parser/
    msc.ts              MSC (.msc) language parser
  __tests__/            Unit tests (Vitest)
```