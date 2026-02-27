# Mozaic Tutorial: Team Conventions

Guidelines for keeping multi-contributor projects consistent and maintainable.

## 1. Naming Conventions

### Files and Folders
- Use lowercase with underscores: `player_controller.msc`, not `PC.msc`.
- Group by responsibility: `scripts/`, `assets/`, `docs/`.

### Entities and Actions
- Entity names: `PascalCase` — `Entity.Player`, `Entity.EnemySlime`.
- Action names: `Action.VerbNoun` — `Action.MoveLeft`, `Action.Jump`, `Action.Interact`.
- Variable names: `$camelCase` or `$PascalCase` — stay consistent within the project.

## 2. Folder Layout

Recommended baseline:

```text
project/
  assets/
    characters/
    levels/
    fx/
  scripts/
    main.msc
    movement/
    combat/
    ui/
  docs/
```

Keep imports shallow when possible and avoid deep nesting unless required.

## 3. Schema Allocation

Reserve byte ranges by purpose and document them in one place:

| Range | Purpose |
|-------|---------|
| `64 – 127` | Player / core loop variables |
| `128 – 191` | Enemy / system variables |
| `192 – 255` | UI / meta variables |

Rules:
- Never overlap addresses between modules.
- Update the team schema map before adding new variables.
- Keep Int16/Int24 values aligned and clearly documented.

## 4. Import Boundaries

- Keep `main.msc` as the composition root.
- Place reusable logic in focused modules.
- Avoid cyclic imports — enforce one-way dependencies.

```yaml
Import: "movement/player"
Import: "combat/damage"
Import: "ui/hud"
```

## 5. Component Conventions

When using components across the team, agree on standard configurations:

```yaml
# Standard hero setup
Entity.Hero:
  Kinematic: {}
  Gravity: { force: 1 }
  PlatformController: { speed: 2, jumpForce: 6 }
  Health: { maxHp: 100 }
  Camera: { zoom: 2, followSpeed: 0.1 }
```

See [docs/COMPONENTS.md](COMPONENTS.md) for the full component reference.

## 6. Color Conventions

Because event triggers depend on color regions, define shared color semantics:

| Color | Meaning |
|-------|---------|
| `#FFFF00` | Level collision surface |
| `#00FFFF` | Hazard |
| `#FF00FF` | Pickup |

Document this palette contract in team docs and avoid ad-hoc color reuse.

## 7. Review Checklist

Before merging:
- [ ] File names follow project conventions.
- [ ] Schema addresses are non-overlapping.
- [ ] Imports resolve cleanly.
- [ ] Tutorials and docs updated if workflow changed.
- [ ] In-editor docs in `public/docs/search-index.json` reflect any new conventions.

## 8. Onboarding

For each new teammate:
1. Complete [docs/TUTORIAL.md](TUTORIAL.md).
2. Complete [docs/TUTORIAL_MULTIFILE.md](TUTORIAL_MULTIFILE.md).
3. Read this conventions guide.
4. Browse the [component reference](COMPONENTS.md).
5. Ship one small feature using the shared schema/import policies.
