# Mozaic Entity State Reference

State management in Mozaic allows entities to change their appearance and behavior dynamically based on conditions. States are defined within an entity block in your `.msc` file.

## 1. Defining States

States are defined under the `States:` key in an entity definition. Each state has a unique name (e.g., `walking`, `jumping`) and a set of properties that override the entity's defaults when active.

```yaml
Entity.Player:
  Visual: "hero_idle"      # Default visual
  Kinematic: {}            # Default components
  
  States:
    # State Name
    moving:
      # Condition to activate this state
      condition: "$vx != 0"
      
      # Overrides (Applied when state is active)
      Visual: "hero_run"
      Gravity: { force: 2 }
```

## 2. How States Work

*   **Evaluation Order:** States are evaluated from top to bottom every frame.
*   **First Match Wins:** The engine uses the **first** state whose `condition` evaluates to `true`.
*   **Fallback:** If no state conditions are met, the entity uses its base definition (default `Visual` and components).

## 3. Writing Conditions

Conditions are string expressions that return a boolean.

**Operators:**
*   Comparison: `==`, `!=`, `>`, `<`, `>=`, `<=`
*   Logic: `||` (OR), `&&` (AND). Example: `$vx != 0 || $vy != 0`

**Variables:**
You can reference two types of variables in conditions:

1.  **Local Component Variables** (prefixed with `$`)
    *   Exposed by specific components attached to the entity.
    *   *Example:* `$vx` (Velocity X), `$vy` (Velocity Y) are exposed by the `Kinematic` component.
    
    | Component | Variable | Description |
    | :--- | :--- | :--- |
    | **Kinematic** | `$vx`, `$vy` | Current velocity on X/Y axis |
    | **Kinematic** | `$px`, `$py` | Current position on X/Y axis |

2.  **Global Schema Variables** (prefixed with `State.` or `$`)
    *   Defined in your `Schema:` block.
    *   Shared across the entire game.
    *   *Example:* `State.$isGamePaused`, `$playerHealth`

## 4. Overriding Properties

When a state is active, it can override:
*   **Visual:** Changes the sprite/animation.
    ```yaml
    Visual: "hero_jump"
    ```
*   **Components:** Updates or adds component properties.
    ```yaml
    # Disable gravity while in this state
    Gravity: { force: 0 }
    
    # Change movement speed
    TopDownController: { speed: 5 }
    ```

## 5. Complete Example

Here is a robust example of a player entity with multiple states (Idle, Moving, Jumping).

```yaml
Schema:
  $isGamePaused: Int8

Entity.Hero:
  Visual: "hero_idle"
  Kinematic: {}
  PlatformerController: { speed: 2, jumpForce: 6 }
  Gravity: { force: 1 }

  States:
    # 1. High Priority: Paused (Global var check)
    paused:
      condition: "$isGamePaused == 1"
      Visual: "hero_idle"
      PlatformerController: { speed: 0, jumpForce: 0 }
      Gravity: { force: 0 }

    # 2. Jumping (Local var check via Kinematic)
    jumping:
      condition: "$vy < 0"
      Visual: "hero_jump"

    # 3. Falling
    falling:
      condition: "$vy > 0"
      Visual: "hero_fall"

    # 4. Moving (Horizontal velocity check)
    running:
      condition: "$vx != 0"
      Visual: "hero_run"
```

## 6. Pro-Tips

*   **Order Matters:** Put your most important states (like `dead` or `stunned`) at the top of the list.
*   **Debug Variables:** If a state isn't triggering, check if the component exposing the variable (like `Kinematic`) is actually attached to the entity.
*   **Performance:** State conditions are evaluated every frame for every active entity, so keep expressions simple.
