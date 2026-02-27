# Mozaic Entity State Reference

Entities can change appearance and behavior dynamically based on conditions. States are defined within an entity block in your `.msc` file.

## 1. Defining States

Add a `States:` key inside any entity definition. Each state has a name, a `condition`, and optional property overrides.

```yaml
Entity.Player:
  Visual: "hero_idle"
  Kinematic: {}
  Gravity: { force: 1 }

  States:
    moving:
      condition: "$vx != 0"
      Visual: "hero_run"
```

## 2. How States Work

- **Evaluation order:** states are checked top to bottom every frame.
- **First match wins:** the engine activates the first state whose condition is true.
- **Fallback:** if no condition matches, the entity uses its base definition.

## 3. Writing Conditions

Conditions are expressions that evaluate to true or false.

**Comparison operators:** `==`, `!=`, `>`, `<`, `>=`, `<=`

**Logical operators:** `||` (OR), `&&` (AND)

```yaml
condition: "$vx != 0 || $vy != 0"
```

### Variables

#### Local context variables (prefixed with `$`)

These are exposed by specific components attached to the entity:

| Component | Variable | Description |
|-----------|----------|-------------|
| **Kinematic** | `$vx` | Current X velocity |
| **Kinematic** | `$vy` | Current Y velocity |
| **Kinematic** | `$px` | Current X position |
| **Kinematic** | `$py` | Current Y position |
| **Health** | `$hp` | Current health |
| **Health** | `$maxHp` | Maximum health |
| **PlatformController** | `$isGrounded` | `1` if on a surface, `0` if airborne |
| **PlatformController** | `$vy` | Current Y velocity |
| **Interactable** | `$triggered` | `1` if triggered this frame |
| **AreaTrigger** | `$triggered` | `1` if an entity is inside the area |

#### Global schema variables (prefixed with `State.` or `$`)

Defined in your `Schema:` block and shared across the entire game:

```yaml
Schema:
  - $isGamePaused: { addr: 64, type: Int8 }
```

Use as: `State.$isGamePaused` or `$isGamePaused`

## 4. Overriding Properties

When a state is active, it can override:

**Visual** — change the sprite:

```yaml
Visual: "hero_jump"
```

**Components** — update or add component properties:

```yaml
Gravity: { force: 0 }
TopDownController: { speed: 5 }
```

## 5. Complete Example

```yaml
Schema:
  - $isGamePaused: { addr: 64, type: Int8 }

Entity.Hero:
  Visual: "hero_idle"
  Kinematic: {}
  PlatformController: { speed: 2, jumpForce: 6 }
  Gravity: { force: 1 }

  States:
    paused:
      condition: "$isGamePaused == 1"
      Visual: "hero_idle"
      PlatformController: { speed: 0, jumpForce: 0 }
      Gravity: { force: 0 }

    jumping:
      condition: "$vy < 0"
      Visual: "hero_jump"

    falling:
      condition: "$vy > 0"
      Visual: "hero_fall"

    running:
      condition: "$vx != 0"
      Visual: "hero_run"
```

## 6. Tips

- **Order matters** — put critical states (`dead`, `stunned`) at the top.
- **Debug variables** — if a state isn't triggering, check that the component exposing the variable (like `Kinematic`) is attached to the entity.
- **Keep conditions simple** — they run every frame for every active entity.
- See [docs/COMPONENTS.md](COMPONENTS.md) for the full list of components and their exposed variables.
