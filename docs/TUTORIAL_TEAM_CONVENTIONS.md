# Mozaic Tutorial: Team Conventions

Use this guide to keep multi-contributor projects consistent and easy to maintain.

## 1) Naming conventions

### Files and folders
- Use lowercase names with underscores for scripts and assets.
- Prefer descriptive names: `player_controller.msc` over `pc.msc`.
- Group by responsibility: `scripts/`, `assets/`, `docs/`.

### Entities and actions
- Entity names: `PascalCase` (example: `Entity.Player`).
- Action names: `Action.VerbNoun` (example: `Action.MoveLeft`).
- Variable names: `$PascalOrCamel` but stay consistent per project.

## 2) Folder layout policy

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

## 3) Schema allocation policy

Reserve byte ranges by purpose and document them in one place.

Suggested plan:
- `64..127`: player/core loop vars
- `128..191`: enemy/system vars
- `192..255`: UI/meta vars

Rules:
- Never overlap addresses between modules.
- Add new variables by updating the team’s schema map first.
- Keep Int16/Int24 aligned and clearly noted.

## 4) Import and module boundaries

- Keep `main.msc` as composition root only.
- Place reusable logic in focused modules.
- Avoid cyclic imports by enforcing one-way dependencies.

Example composition:

```msc
Import: "movement/player"
Import: "combat/damage"
Import: "ui/hud"
```

## 5) Asset-color conventions

Because event triggers can depend on color regions, define shared color semantics:
- `#FFFF00` = level collision surface
- `#00FFFF` = hazard
- `#FF00FF` = pickups

Store this palette contract in team docs and avoid ad-hoc color reuse.

## 6) Commit and review checklist

Before merge:
- File names follow project conventions.
- Schema addresses are non-overlapping.
- Imports resolve cleanly.
- Affected tutorials/docs were updated if workflow changed.
- In-editor docs entries in `public/docs/search-index.json` reflect new conventions.

## 7) Onboarding mini-routine

For each new teammate:
1. Complete `docs/TUTORIAL.md`.
2. Complete `docs/TUTORIAL_MULTIFILE.md`.
3. Read this conventions guide.
4. Ship one small feature using the shared schema/import policies.
