# Mozaic Tutorial: Multi-File Workflow

This tutorial shows how to structure a small project with multiple script files and image assets using the file tree.

## 1) Create project files

In the file tree panel:

1. Create a folder named assets.
2. Create a folder named scripts.
3. Add at least one image file under assets (for example hero.png).
4. Add script files under scripts:
   - main.msc
   - movement.msc
   - combat.msc

Tip: keep files focused by domain (movement logic vs combat logic).

## 2) Author shared script modules

In scripts/movement.msc:

```msc
Schema:
  - $PlayerX: { addr: 64, type: Int16 }
  - $PlayerY: { addr: 66, type: Int16 }
```

In scripts/combat.msc:

```msc
Schema:
  - $Health: { addr: 68, type: Int8 }
```

Keep address ranges non-overlapping to avoid state collisions.

## 3) Compose from main.msc

In scripts/main.msc:

```msc
Import: "movement"
Import: "combat"

Entity.Hero:
  Visual: "hero.png"
  Input:
    - KeyA -> Action.MoveLeft
    - KeyD -> Action.MoveRight
```

Import resolution is path-relative to the current script file.

Examples:
- sibling: Import: "movement"
- nested: Import: "logic/movement"
- parent: Import: "../shared/base"

## 4) Open and switch files safely

- Click files in the tree to open them in the right editor mode.
- Script files open in Script tab.
- Image files open in Pixel tab.
- Current active file changes only through the open-file flow, so switching files preserves current edits.

## 5) Edit image assets independently

1. Open assets/hero.png from tree.
2. Paint and save your changes.
3. Open another image file and confirm changes are independent.

If two images look identical unexpectedly, verify you are opening different file nodes and not duplicate names in different folders.

## 6) Validate imports

After editing main.msc:

1. Click Run.
2. Check for parser/import errors in status output.
3. Fix missing import paths by matching folder and file names.

Recommended naming:
- one responsibility per module
- lower-case file names
- stable schema addresses documented in comments or design notes

## 7) Suggested structure

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

## 8) Next steps

- Pair this with [docs/TUTORIAL.md](docs/TUTORIAL.md) for first-project basics.
- Use [public/docs/search-index.json](public/docs/search-index.json) to add team-specific tutorial chapters to the in-editor Docs tab.
