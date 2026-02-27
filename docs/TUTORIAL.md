# Mozaic Tutorial: Build Your First Playable ROM

A step-by-step guide to creating a tiny playable scene using the in-app editors.

## 1. Start the App

```bash
npm install
npm run dev
```

Open the local URL shown in your terminal (typically `http://localhost:5173`).

## 2. Create a New ROM

1. Click **New** in the header.
2. Pick **Blank** (or keep the default preset).
3. Open the **Pixel** tab.

You now have an empty 64×64 image-backed ROM ready to paint.

## 3. Paint a Simple Level

In the **Pixel** tab, draw two distinct regions:

- A small character shape in one color (your hero).
- A ground/platform region in a different color.

Keep colors distinct — event rules target entities by color.

**Shortcuts:**
- **B** — Pencil
- **G** — Fill
- **I** / right-click — Pipette (pick a color)
- Mouse wheel — Zoom at cursor
- **Space** + drag — Pan the canvas
- Pinch with two fingers on touch devices to zoom and pan

## 4. Write Script Logic

Open the **Script** tab and paste:

```yaml
Source: "level.mzk"

Schema:
  - $Score: { addr: 64, type: Int16 }

Entity.Hero:
  Visual: "hero.png"
  Kinematic: {}
  PlayerController: { speed: 2 }
  Input:
    - Key_Space -> Action.Jump
    - Key_A -> Action.Left
    - Key_D -> Action.Right

Events:
  Collision(Hero:#Feet, Level:#FFFF00):
    - State.$Score = 1
```

What this does:
- Declares a `$Score` variable in the global state region.
- Creates a hero entity with movement (`Kinematic` + `PlayerController`).
- Maps keyboard input to actions.
- Sets score to 1 when the hero's feet touch the yellow platform.

See [docs/COMPONENTS.md](COMPONENTS.md) for the full list of components you can attach.

## 5. Run and Debug

1. Click **Run** in the header.
2. Open the **Debug** tab.
3. Enable **Collision** and **IDs** overlays.
4. Use **Alt+Click** near overlay lines to inspect layer IDs.

If behavior doesn't trigger:
- Check the hex color names in your event triggers match your painted regions.
- Make sure regions actually overlap.

## 6. Save Your ROM

Click **Save** to export the current ROM as a `.png` file. Reload it later with **Open ROM** to continue editing.

## 7. Next Steps

- **Entity States** — make entities change behavior dynamically: [docs/ENTITY_STATES.md](ENTITY_STATES.md)
- **Component Reference** — full list of components with props and examples: [docs/COMPONENTS.md](COMPONENTS.md)
- **Multi-File Projects** — organize larger projects: [docs/TUTORIAL_MULTIFILE.md](TUTORIAL_MULTIFILE.md)
- **Team Conventions** — naming and schema policies: [docs/TUTORIAL_TEAM_CONVENTIONS.md](TUTORIAL_TEAM_CONVENTIONS.md)
- **Architecture** — how the engine works under the hood: [docs/MOZAIC_ARCHITECTURE.md](MOZAIC_ARCHITECTURE.md)
