# Mozaic Tutorial: Multi-File Workflow

How to organize a project with multiple script files and image assets using the file tree.

## 1. Create Project Files

In the file tree panel:

1. Create an `assets` folder for images.
2. Create a `scripts` folder for MSC files.
3. Add at least one image (e.g. `hero.png`) under `assets`.
4. Add script files under `scripts`: `main.msc`, `movement.msc`, `combat.msc`.

Keep files focused — one responsibility per module.

## 2. Write Feature Modules

**scripts/movement.msc:**

```yaml
Schema:
  - $PlayerX: { addr: 64, type: Int16 }
  - $PlayerY: { addr: 66, type: Int16 }
```

**scripts/combat.msc:**

```yaml
Schema:
  - $Health: { addr: 68, type: Int8 }
```

Keep address ranges non-overlapping to avoid state collisions.

## 3. Compose from main.msc

**scripts/main.msc:**

```yaml
Import: "movement"
Import: "combat"

Entity.Hero:
  Visual: "hero.png"
  Kinematic: {}
  PlayerController: { speed: 2 }
  Health: { maxHp: 100 }
  Input:
    - Key_A -> Action.Left
    - Key_D -> Action.Right
```

Import resolution is path-relative to the current script file:
- Sibling: `Import: "movement"`
- Nested: `Import: "logic/movement"`
- Parent: `Import: "../shared/base"`

## 4. Switch Files Safely

- Click files in the tree to open them in the right editor mode.
- Script files (`.msc`) open in the **Script** tab.
- Image files (`.png`) open in the **Pixel** tab.
- Switching files preserves unsaved edits in each tab.

## 5. Edit Image Assets

1. Open `assets/hero.png` from the tree.
2. Paint and save your changes.
3. Open another image — each file edits independently.

## 6. Validate Imports

After editing:

1. Click **Run**.
2. Check for parser or import errors in the status output.
3. Fix missing paths by verifying folder and file names match.

## 7. Suggested Structure

```text
project/
  assets/
    hero.png
    level_1.png
  scripts/
    main.msc
    movement.msc
    combat.msc
```

## 8. Next Steps

- First-project basics: [docs/TUTORIAL.md](TUTORIAL.md)
- Component reference: [docs/COMPONENTS.md](COMPONENTS.md)
- Team conventions: [docs/TUTORIAL_TEAM_CONVENTIONS.md](TUTORIAL_TEAM_CONVENTIONS.md)
