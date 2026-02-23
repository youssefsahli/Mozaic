# Mozaic Tutorial: Build Your First Playable ROM

This tutorial walks you through creating a tiny playable scene using the in-app editors.

## 1) Start the app

Run:

```bash
npm install
npm run dev
```

Open the shown local URL (typically http://localhost:5173).

## 2) Create a new ROM

1. Click **New** in the header.
2. Pick **Blank** (or keep the default preset).
3. Open the **Pixel** tab.

You now have a fresh image-backed ROM.

## 3) Paint a simple level

In **Pixel** tab:

1. Draw a small character shape with one color.
2. Draw a ground/platform region with another color.
3. Keep color choices distinct so event rules can target them.

Tips:
- Use **B** for Pencil and **G** for Fill.
- Use **I** or right-click to color-pick.
- Use mouse wheel to zoom (zooms at cursor position).
- On touch devices, pinch with two fingers to zoom smoothly and pan simultaneously.
- Hold **Space** and drag to pan the canvas, or use middle-mouse drag.
- When `stylusOnly` mode is enabled, touch input only navigates while the pen draws.

## 4) Add script logic

Open the **Script** tab and paste this starter MSC:

```msc
Source: "level.mzk"

Schema:
  - $Score: { addr: 64, type: Int16 }

Entity.Hero:
  Visual: "hero.png"
  Input:
    - Key_Space -> Action.Jump

Events:
  Collision(Hero:#Feet, Level:#FFFF00):
    - State.$Score = 1
```

What this does:
- Declares one score variable in the global state region.
- Defines a hero input action.
- Increments score when the selected collision colors touch.

## 5) Run and inspect

1. Click **Run** in the header.
2. Open **Debug** tab.
3. Enable **Collision** and **IDs** overlays.
4. Use **Alt+Click** near overlay lines to inspect layer IDs.

If behavior is not triggering:
- Recheck the color hex names in your event trigger.
- Ensure the painted regions actually touch/overlap as expected.

## 6) Save your ROM

Click **Save** to export your current ROM as PNG.

You can later reload it with **ROM** and continue editing.

## 7) Continue learning

- See architecture details in [docs/MOZAIC_ARCHITECTURE.md](docs/MOZAIC_ARCHITECTURE.md)
- Browse in-app docs in the **Docs** tab (search for "Components" and "Architecture")
- Use [public/docs/search-index.json](public/docs/search-index.json) to add your own internal chapters
