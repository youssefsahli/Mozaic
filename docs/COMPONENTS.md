# Mozaic Component Reference

Components are the building blocks you attach to entities in your `.msc` scripts.
Each component adds a specific behavior — physics, input handling, AI, visual effects, and more.

Attach a component by adding its name under an `Entity` block:

```yaml
Entity.Hero:
  Visual: "hero.png"
  Kinematic: {}
  Gravity: { force: 1 }
  PlayerController: { speed: 2 }
```

---

## Physics & Kinematics

### Gravity

Applies a constant downward force to the entity every frame.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `force` | number | `1` | Downward acceleration per frame |

```yaml
Gravity: { force: 1 }
```

---

### Kinematic

Adds velocity to position every frame. This is the core movement component — without it, velocity changes have no visible effect.

| Prop | — | — | — |
|------|---|---|---|

No props. Attach with `Kinematic: {}`.

**Exposed context variables:**

| Variable | Description |
|----------|-------------|
| `$vx` | Current X velocity |
| `$vy` | Current Y velocity |
| `$px` | Current X position |
| `$py` | Current Y position |

```yaml
Kinematic: {}
```

---

### Collider

Halts the entity's velocity when its position overlaps a baked collision polygon.

```yaml
Collider: {}
```

---

### Friction

Gradually reduces velocity toward zero each frame.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `factor` | number | `0.9` | Multiplier applied to velocity each frame (0 = instant stop, 1 = no friction) |

```yaml
Friction: { factor: 0.9 }
```

---

## Controllers

### PlayerController

Maps directional input actions to entity velocity.
Listens for `Action.Left`, `Action.Right`, `Action.Up`, `Action.Down`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `speed` | number | `1` | Movement speed |

```yaml
PlayerController: { speed: 2 }
```

---

### TopDownController

Four-directional top-down controller using `Action.MoveLeft`, `Action.MoveRight`, `Action.MoveUp`, `Action.MoveDown`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `speed` | number | `1` | Movement speed |

```yaml
TopDownController: { speed: 2 }
```

---

### PlatformController

Side-scrolling controller with jump mechanics. Listens for `Action.MoveLeft`, `Action.MoveRight`, and `Action.Jump`. Only allows jumping when the entity is touching a collision surface.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `speed` | number | `1` | Horizontal movement speed |
| `jumpForce` | number | `5` | Upward velocity applied on jump |

**Exposed context variables:**

| Variable | Description |
|----------|-------------|
| `$isGrounded` | `1` if on a surface, `0` if airborne |
| `$vy` | Current Y velocity |

```yaml
PlatformController: { speed: 2, jumpForce: 6 }
```

---

## Gameplay

### Health

Deactivates the entity when its health byte reaches zero.

**Exposed context variables:**

| Variable | Description |
|----------|-------------|
| `$hp` | Current health |
| `$maxHp` | Maximum health (from `maxHp` prop, default `100`) |

```yaml
Health: { maxHp: 100 }
```

---

### Lifetime

Countdown timer that destroys the entity after a set number of frames.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `frames` | number | `60` | Number of frames before the entity is removed (max 255) |

```yaml
Lifetime: { frames: 120 }
```

---

### Navigator

Moves the entity along a baked Bezier path extracted from the ROM image.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `speed` | number | `1` | Points advanced per frame |
| `pathIndex` | number | `0` | Index of the baked path to follow |

```yaml
Navigator: { speed: 1, pathIndex: 0 }
```

---

## Combat

### Hitbox

Checks for overlapping entities in the pool and applies damage and knockback.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | number | `16` | Hitbox width |
| `height` | number | `16` | Hitbox height |
| `damage` | number | `1` | Health points removed on hit |
| `knockback` | number | `4` | Velocity impulse applied away from attacker |

```yaml
Hitbox: { width: 16, height: 16, damage: 1, knockback: 4 }
```

---

## AI & Logic

### Wanderer

Randomly picks a direction at regular intervals, creating aimless movement.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `speed` | number | `1` | Movement speed |
| `interval` | number | `60` | Frames between direction changes (max 255) |

```yaml
Wanderer: { speed: 1, interval: 60 }
```

---

### Chaser

Moves toward the first active entity matching a target type ID.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `speed` | number | `1` | Chase speed |
| `targetType` | number | `1` | Entity type ID to pursue |

```yaml
Chaser: { speed: 1, targetType: 1 }
```

---

### Spawner

Emits new entities at regular intervals from the spawner's position.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `entity` | number | `0` | Type ID assigned to spawned entities |
| `interval` | number | `60` | Frames between spawns (max 255) |
| `speedX` | number | `0` | Initial X velocity of spawned entities |
| `speedY` | number | `0` | Initial Y velocity of spawned entities |

```yaml
Spawner: { entity: 2, interval: 90, speedX: 0, speedY: -1 }
```

---

## Interaction

### Interactable

Sets a triggered flag when a target entity is within radius and an input action is active.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `radius` | number | `16` | Interaction radius |
| `action` | string | `"Action.Interact"` | Input action that activates the trigger |
| `targetType` | number | `1` | Entity type ID that can interact |

**Exposed context variables:**

| Variable | Description |
|----------|-------------|
| `$triggered` | `1` if triggered this frame, `0` otherwise |

```yaml
Interactable: { radius: 24, action: "Action.Interact" }
```

---

### AreaTrigger

Fires when a target entity enters a rectangular area around this entity.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | number | `16` | Trigger area width |
| `height` | number | `16` | Trigger area height |
| `targetType` | number | `1` | Entity type ID to detect |

**Exposed context variables:**

| Variable | Description |
|----------|-------------|
| `$triggered` | `1` if an entity is inside the area, `0` otherwise |

```yaml
AreaTrigger: { width: 32, height: 32 }
```

---

## Drawing & Effects

### Camera

Follows the entity position and updates global camera state. Supports smooth following and zoom transitions.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `zoom` | number | `1.0` | Camera zoom level |
| `shake` | number | `0.0` | Screen shake intensity |
| `tint` | string | `"#FFFFFF"` | Hex color multiplier for the scene |
| `followSpeed` | number | `1.0` | Lerp speed for camera follow (0 = frozen, 1 = instant) |
| `zoomSpeed` | number | `1.0` | Lerp speed for zoom transitions |

```yaml
Camera: { zoom: 2, followSpeed: 0.1, tint: "#FFEEDD" }
```

---

### ScreenShake

Applies random camera offsets to create a shake effect.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `intensity` | number | `2` | Maximum shake offset in pixels |

```yaml
ScreenShake: { intensity: 4 }
```

---

### SpriteAnimator

Cycles the entity's sprite ID to create frame-by-frame animation.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `frames` | number | `10` | Ticks between frame advances |
| `count` | number | `2` | Total number of animation frames to cycle through |

```yaml
SpriteAnimator: { frames: 8, count: 4 }
```

---

### ParticleEmitter

Spawns child entities with random velocities for particle effects.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `rate` | number | `1` | Particles spawned per frame |
| `lifetime` | number | `30` | Lifetime of each particle (frames, max 255) |
| `typeId` | number | `0` | Type ID assigned to spawned particles |

```yaml
ParticleEmitter: { rate: 2, lifetime: 20 }
```

---

## Experimental

These components are functional but may change in future versions.

### SineWave

Applies sine-wave oscillation to velocity on a chosen axis.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `frequency` | number | `0.1` | Oscillation frequency |
| `amplitude` | number | `1` | Oscillation amplitude |
| `axis` | string | `"y"` | Axis to oscillate (`"x"` or `"y"`) |

```yaml
SineWave: { frequency: 0.05, amplitude: 2, axis: "y" }
```

---

### Patrol

Moves back and forth along an axis. Reverses direction when velocity is blocked.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `speed` | number | `1` | Movement speed |
| `axis` | string | `"x"` | Axis to patrol (`"x"` or `"y"`) |

```yaml
Patrol: { speed: 1, axis: "x" }
```

---

### Blink

Toggles entity visibility on and off at a regular interval.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `interval` | number | `30` | Frames between visibility toggles |

```yaml
Blink: { interval: 20 }
```

---

## Roguelike

These components enable turn-based, tile-snapped gameplay suitable for roguelikes and dungeon crawlers.

### TurnBased

Processes entity actions only when input fires, then freezes until the next turn. Combine with GridMovement for classic roguelike controls.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `budget` | number | `1` | Max actions per turn before the entity pauses |

**Exposed context variables:**

| Variable | Description |
|----------|-------------|
| `$turnReady` | `1` if the entity can still act this turn, `0` when budget is exhausted |

```yaml
TurnBased: { budget: 1 }
```

---

### GridMovement

Snaps entity movement to a tile grid. Each input step moves exactly one tile in the pressed direction.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `gridSize` | number | `16` | Pixels per tile |

```yaml
GridMovement: { gridSize: 16 }
```

---

### FieldOfView

Marks the entity as visible or hidden based on Manhattan distance to a viewer entity type. Useful for fog-of-war effects.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `range` | number | `5` | Visibility range in tiles |
| `viewerType` | number | `1` | Entity type ID of the viewer |

**Exposed context variables:**

| Variable | Description |
|----------|-------------|
| `$visible` | `1` if within range of the viewer, `0` otherwise |

```yaml
FieldOfView: { range: 6, viewerType: 1 }
```

---

### Inventory

Gives an entity up to 4 item slots. When the Interact action fires, nearby entities are picked up into the first empty slot.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `slots` | number | `4` | Number of item slots (max 4) |

**Exposed context variables:**

| Variable | Description |
|----------|-------------|
| `$slot0` | Item type ID in slot 0 (0 = empty) |
| `$slot1` | Item type ID in slot 1 |
| `$slot2` | Item type ID in slot 2 |
| `$slot3` | Item type ID in slot 3 |

```yaml
Inventory: { slots: 4 }
```

---

## Persistence

### SaveState

Serialises the globals memory block to localStorage when the specified action fires.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `slot` | string | `"default"` | Save-slot name |
| `trigger` | string | `"Action.Save"` | Input action that triggers the save |
| `addr` | number | `64` | Start byte to save |
| `len` | number | `448` | Number of bytes to save (full globals block) |

```yaml
SaveState: { slot: "slot1", trigger: "Action.Save" }
```

### LoadState

Reads a previously saved globals block from localStorage. Can load automatically on the first tick or when a specific action fires.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `slot` | string | `"default"` | Save-slot name |
| `trigger` | string | `"Action.Load"` | Input action that triggers a manual load |
| `autoLoad` | number | `0` | If `1`, also load on the very first tick |
| `addr` | number | `64` | Start byte to restore |

```yaml
LoadState: { slot: "slot1", trigger: "Action.Load", autoLoad: 1 }
```

---

## Quick Reference Table

| Component | Category | Key Props | Context Variables |
|-----------|----------|-----------|-------------------|
| **Gravity** | Physics | `force` | — |
| **Kinematic** | Physics | — | `$vx`, `$vy`, `$px`, `$py` |
| **Collider** | Physics | — | — |
| **Friction** | Physics | `factor` | — |
| **PlayerController** | Controller | `speed` | — |
| **TopDownController** | Controller | `speed` | — |
| **PlatformController** | Controller | `speed`, `jumpForce` | `$isGrounded`, `$vy` |
| **Health** | Gameplay | `maxHp` | `$hp`, `$maxHp` |
| **Lifetime** | Gameplay | `frames` | — |
| **Navigator** | Gameplay | `speed`, `pathIndex` | — |
| **Hitbox** | Combat | `width`, `height`, `damage`, `knockback` | — |
| **Wanderer** | AI | `speed`, `interval` | — |
| **Chaser** | AI | `speed`, `targetType` | — |
| **Spawner** | AI | `entity`, `interval`, `speedX`, `speedY` | — |
| **Interactable** | Interaction | `radius`, `action`, `targetType` | `$triggered` |
| **AreaTrigger** | Interaction | `width`, `height`, `targetType` | `$triggered` |
| **Camera** | Effects | `zoom`, `shake`, `tint`, `followSpeed`, `zoomSpeed` | — |
| **ScreenShake** | Effects | `intensity` | — |
| **SpriteAnimator** | Effects | `frames`, `count` | — |
| **ParticleEmitter** | Effects | `rate`, `lifetime`, `typeId` | — |
| **SineWave** | Experimental | `frequency`, `amplitude`, `axis` | — |
| **Patrol** | Experimental | `speed`, `axis` | — |
| **Blink** | Experimental | `interval` | — |
| **TurnBased** | Roguelike | `budget` | `$turnReady` |
| **GridMovement** | Roguelike | `gridSize` | — |
| **FieldOfView** | Roguelike | `range`, `viewerType` | `$visible` |
| **Inventory** | Roguelike | `slots` | `$slot0`..`$slot3` |
| **SaveState** | Persistence | `slot`, `trigger`, `addr`, `len` | — |
| **LoadState** | Persistence | `slot`, `trigger`, `autoLoad`, `addr` | — |
