# Mozaic Usage Examples

Ready-to-run example ROMs are available directly from the editor.
Click **New ROM** in the header and choose one of the **Example** entries
to create a project pre-loaded with art and a working `.msc` script.

Each example is **self-contained**: it includes a `Sprites:` block with
`$Grid`, entity definitions with components, an `Instances:` block for
entity placement, and a companion `.mzk` image.

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

Sprites:
  $Grid: 16
  hero_idle: [0, 0]
  hero_run: [1, 0, 3]
  coin: [0, 1]
  platform: [4, 0]

Entity.Hero:
  Visual: "hero_idle"
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
  Visual: "coin"
  SineWave: { frequency: 0.05, amplitude: 2, axis: y }
  Lifetime: { frames: 600 }

Instances:
  - { entity: "Hero", x: 8, y: 40 }
  - { entity: "Coin", x: 32, y: 20 }
  - { entity: "Coin", x: 48, y: 20 }

Events:
  Collision(Hero:#Feet, Level:#00B400):
    - State.$Score = State.$Score + 1
```

### What to Try

1. Click **Run** and use **A / D / Space** (or arrow keys) to move.
2. Open the **Debug** tab and enable **Collision** overlays.
3. Change `jumpForce` to `8` and restart — notice the higher jump.
4. Edit the pixel art to add more platforms and coins.

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

Sprites:
  $Grid: 16
  player_idle: [0, 0]
  player_walk: [1, 0, 2]
  npc_idle: [0, 1]
  chest: [3, 0]

Entity.Player:
  Visual: "player_idle"
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
  Visual: "npc_idle"
  Kinematic: {}
  Wanderer: { speed: 1, interval: 90 }
  Friction: { factor: 0.9 }

Entity.Chest:
  Visual: "chest"
  AreaTrigger: { width: 16, height: 16, targetType: 1 }

Instances:
  - { entity: "Player", x: 10, y: 10 }
  - { entity: "NPC", x: 40, y: 40 }
  - { entity: "Chest", x: 48, y: 12 }

Events:
  Collision(Player:#Body, Chest:#FFC800):
    - State.$Keys = State.$Keys + 1
```

### What to Try

1. Move with **W / A / S / D** (or arrow keys) and watch the NPC wander.
2. Walk into the chest to increment `$Keys`.
3. Lower `Friction.factor` to `0.5` for an ice-rink feel.
4. Paint more wall tiles in the pixel editor.

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

Sprites:
  $Grid: 16
  emitter: [0, 0]
  spark: [1, 0, 2]
  spinner: [0, 1, 4]

Entity.Emitter:
  Visual: "emitter"
  Kinematic: {}
  ParticleEmitter: { rate: 2, lifetime: 40, typeId: 0 }
  SineWave: { frequency: 0.03, amplitude: 3, axis: x }

Entity.Spark:
  Visual: "spark"
  Kinematic: {}
  Gravity: { force: 0.5 }
  Lifetime: { frames: 40 }
  Blink: { interval: 6 }

Entity.Spinner:
  Visual: "spinner"
  Kinematic: {}
  SpriteAnimator: { frames: 8, count: 4 }
  Patrol: { speed: 1, axis: x }

Instances:
  - { entity: "Emitter", x: 32, y: 10 }
  - { entity: "Spinner", x: 10, y: 48 }
  - { entity: "Spinner", x: 50, y: 48 }

Events:
  Collision(Spark:#Body, Level:#FF0000):
    - State.$FX = State.$FX + 1
```

### What to Try

1. Click **Run** and watch sparks fall from the oscillating emitter.
2. Increase `ParticleEmitter.rate` to `5` for a denser stream.
3. Change `Blink.interval` to `2` for a rapid strobe effect.
4. Edit the sprite frames in the pixel editor.

---

## Key MSC Features Used

| Feature | Syntax | Purpose |
|---------|--------|---------|
| **Sprites** | `Sprites:` block | Declares named sprite regions |
| **$Grid** | `$Grid: 16` (inside Sprites) | Sets the grid cell size for `[col, row]` sprites |
| **Grid sprites** | `hero_idle: [0, 0]` | Defines a sprite at grid cell (col, row) |
| **Animation strips** | `hero_run: [1, 0, 3]` | Multi-frame animation: col, row, frame count |
| **Instances** | `Instances:` block | Places entity instances at (x, y) on startup |
| **Input mapping** | `Key_A -> Action.Left` | Maps keyboard keys to engine actions |
| **Events** | `Collision(A:#Color, B:#Color):` | Triggers actions on color-region overlap |

---

## Creating Your Own Examples

Any ROM variant is a starting point. The workflow is always:

1. **New ROM** → pick a template (or start with **Empty ROM**).
2. **Pixel** tab → paint your scene and entities.
3. **Script** tab → declare `Sprites:` with `$Grid`, entities, `Instances:`, and events.
4. **Run** → iterate until it plays the way you want.
5. **Save** → export as `.png` / `.mzk` to share.

See [TUTORIAL.md](TUTORIAL.md) for a hands-on first-ROM walkthrough and
[COMPONENTS.md](COMPONENTS.md) for the full component reference.
