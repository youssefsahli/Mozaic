# Mozaic Usage Examples

Ready-to-run example ROMs are available directly from the editor.
Click **New ROM** in the header and choose one of the **Example** entries
to create a project pre-loaded with art and a working `.msc` script.

Example scripts live in [`public/examples/`](../public/examples/) and are
fetched at runtime, so you can add or edit them without touching the
source code.

| File | Description |
|------|-------------|
| [`platformer.msc`](../public/examples/platformer.msc) | Side-scrolling scene with gravity, jump, and collision scoring |
| [`top-down.msc`](../public/examples/top-down.msc) | Four-directional RPG movement with a wandering NPC |
| [`particles.msc`](../public/examples/particles.msc) | Visual effects showcase with emitters and animation |
| [`index.json`](../public/examples/index.json) | Manifest consumed by the editor to populate the menu |

---

## Platformer Example

A side-scrolling scene demonstrating gravity, collision, and
player-controlled movement.

**Components used:**
`Kinematic`, `Gravity`, `PlatformController`, `Collider`, `Health`,
`SineWave`, `Lifetime`

```yaml
Source: "level.mzk"

Schema:
  - $Score: { addr: 64, type: Int16 }

Entity.Hero:
  Visual: "hero.png"
  Kinematic: {}
  Gravity: { force: 1 }
  PlatformController: { speed: 2, jumpForce: 5 }
  Collider: {}
  Health: { maxHp: 3 }
  Input:
    - Key_Space -> Action.Jump
    - Key_A     -> Action.Left
    - Key_D     -> Action.Right
    - Key_ArrowLeft  -> Action.Left
    - Key_ArrowRight -> Action.Right
    - Key_ArrowUp    -> Action.Jump

Entity.Coin:
  Visual: "coin.png"
  SineWave: { frequency: 0.05, amplitude: 2, axis: y }
  Lifetime: { frames: 600 }

Events:
  Collision(Hero:#Feet, Level:#00FF00):
    - State.$Score = State.$Score + 1
```

### What to Try

1. Click **Run** and use **A / D / Space** (or arrow keys) to move.
2. Open the **Debug** tab and enable **Collision** overlays.
3. Change `jumpForce` to `8` and restart — notice the higher jump.

---

## Top-Down Example

A four-directional RPG-style scene with an NPC, area trigger, and
friction-based movement.

**Components used:**
`Kinematic`, `TopDownController`, `Friction`, `Collider`,
`Wanderer`, `AreaTrigger`

```yaml
Source: "map.mzk"

Schema:
  - $Keys: { addr: 64, type: Int16 }

Entity.Player:
  Visual: "player.png"
  Kinematic: {}
  TopDownController: { speed: 2 }
  Friction: { factor: 0.85 }
  Collider: {}
  Input:
    - Key_W -> Action.MoveUp
    - Key_S -> Action.MoveDown
    - Key_A -> Action.MoveLeft
    - Key_D -> Action.MoveRight
    - Key_ArrowUp    -> Action.MoveUp
    - Key_ArrowDown  -> Action.MoveDown
    - Key_ArrowLeft  -> Action.MoveLeft
    - Key_ArrowRight -> Action.MoveRight

Entity.NPC:
  Visual: "npc.png"
  Kinematic: {}
  Wanderer: { speed: 1, interval: 90 }
  Friction: { factor: 0.9 }

Entity.Chest:
  Visual: "chest.png"
  AreaTrigger: { width: 16, height: 16, targetType: 1 }

Events:
  Collision(Player:#Body, Chest:#FFFF00):
    - State.$Keys = State.$Keys + 1
```

### What to Try

1. Move with **W / A / S / D** (or arrow keys) and watch the NPC wander.
2. Walk into the chest to increment `$Keys`.
3. Lower `Friction.factor` to `0.5` for an ice-rink feel.

---

## Particles Example

A visual effects showcase with emitters, animated sprites, and blinking.

**Components used:**
`Kinematic`, `ParticleEmitter`, `SineWave`, `Gravity`, `Lifetime`,
`Blink`, `SpriteAnimator`, `Patrol`

```yaml
Source: "fx.mzk"

Schema:
  - $FX: { addr: 64, type: Int16 }

Entity.Emitter:
  Visual: "emitter.png"
  Kinematic: {}
  ParticleEmitter: { rate: 2, lifetime: 40, typeId: 0 }
  SineWave: { frequency: 0.03, amplitude: 3, axis: x }

Entity.Spark:
  Visual: "spark.png"
  Kinematic: {}
  Gravity: { force: 0.5 }
  Lifetime: { frames: 40 }
  Blink: { interval: 6 }

Entity.Spinner:
  Visual: "spinner.png"
  Kinematic: {}
  SpriteAnimator: { frames: 8, count: 4 }
  Patrol: { speed: 1, axis: x }

Events:
  Collision(Spark:#Body, Level:#FF0000):
    - State.$FX = State.$FX + 1
```

### What to Try

1. Click **Run** and watch sparks fall from the oscillating emitter.
2. Increase `ParticleEmitter.rate` to `5` for a denser stream.
3. Change `Blink.interval` to `2` for a rapid strobe effect.

---

## Creating Your Own Examples

Any ROM variant is a starting point. The workflow is always:

1. **New ROM** → pick a template (or start with **Empty ROM**).
2. **Pixel** tab → paint your scene and entities.
3. **Script** tab → declare schema, entities, components, and events.
4. **Run** → iterate until it plays the way you want.
5. **Save** → export as `.png` / `.mzk` to share.

### Adding a New Example to the Editor

1. Create a `.msc` file in `public/examples/` (e.g. `puzzle.msc`).
   The file should **not** contain a `Source:` line — it is prepended
   automatically when loaded.
2. Add an entry to `public/examples/index.json`:
   ```json
   {
     "id": "puzzle",
     "title": "Puzzle Example",
     "hint": "Logic",
     "file": "puzzle.msc",
     "description": "A simple block-push puzzle."
   }
   ```
3. Register the variant in `src/editor/example-roms.ts`:
   - Add `"puzzle"` to the `RomVariant` type.
   - Add a label in `ROM_VARIANT_LABELS`.
   - Add it to the `EXAMPLE_VARIANTS` array.
4. Add a button to `index.html` inside `#new-rom-menu`.
5. (Optional) Add a ROM image generator in `src/index.ts` and a case in
   the `createNewRom` switch.

See [TUTORIAL.md](TUTORIAL.md) for a hands-on first-ROM walkthrough and
[COMPONENTS.md](COMPONENTS.md) for the full component reference.
