/**
 * Example ROM script templates.
 *
 * Each function returns a ready-to-use .msc script string that
 * demonstrates a particular gameplay pattern.
 */

/** All supported ROM variant keys. */
export type RomVariant =
  | "empty"
  | "amiga"
  | "checkerboard"
  | "platformer"
  | "top-down"
  | "particles";

/** Human-readable labels for each ROM variant. */
export const ROM_VARIANT_LABELS: Record<RomVariant, string> = {
  empty: "Empty ROM",
  amiga: "Amiga Demo",
  checkerboard: "Checkerboard",
  platformer: "Platformer Example",
  "top-down": "Top-Down Example",
  particles: "Particles Example",
};

/**
 * Return the example .msc script content for the given variant.
 * Non-example variants return the generic starter script.
 */
export function exampleScriptForVariant(
  variant: RomVariant,
  mzkName: string,
): string {
  switch (variant) {
    case "platformer":
      return `Source: "${mzkName}"

# ── Platformer Example ──────────────────────────
# A small side-scrolling scene with gravity, a
# player-controlled hero, and a score counter.

Schema:
  - $Score: { addr: 64, type: Int16 }

Entity.Hero:
  Visual: "hero.png"
  Kinematic: {}
  Gravity: { force: 1 }
  PlatformController: { speed: 2, jumpForce: 5 }
  Collider: {}
  Health: { maxHp: 3 }
  Input:
    - Key_Space -> Action.Jump
    - Key_A     -> Action.Left
    - Key_D     -> Action.Right

Entity.Coin:
  Visual: "coin.png"
  SineWave: { frequency: 0.05, amplitude: 2, axis: y }
  Lifetime: { frames: 600 }

Events:
  Collision(Hero:#Feet, Level:#00FF00):
    - State.$Score = State.$Score + 1
`;

    case "top-down":
      return `Source: "${mzkName}"

# ── Top-Down Example ────────────────────────────
# A four-directional scene with a wandering NPC,
# an area trigger, and friction-based movement.

Schema:
  - $Keys: { addr: 64, type: Int16 }

Entity.Player:
  Visual: "player.png"
  Kinematic: {}
  TopDownController: { speed: 2 }
  Friction: { factor: 0.85 }
  Collider: {}
  Input:
    - Key_W -> Action.MoveUp
    - Key_S -> Action.MoveDown
    - Key_A -> Action.MoveLeft
    - Key_D -> Action.MoveRight

Entity.NPC:
  Visual: "npc.png"
  Kinematic: {}
  Wanderer: { speed: 1, interval: 90 }
  Friction: { factor: 0.9 }

Entity.Chest:
  Visual: "chest.png"
  AreaTrigger: { width: 16, height: 16, targetType: 1 }

Events:
  Collision(Player:#Body, Chest:#FFFF00):
    - State.$Keys = State.$Keys + 1
`;

    case "particles":
      return `Source: "${mzkName}"

# ── Particles Example ───────────────────────────
# Demonstrates visual effects: particle emitter,
# screen shake, sprite animation, and blink.

Schema:
  - $FX: { addr: 64, type: Int16 }

Entity.Emitter:
  Visual: "emitter.png"
  Kinematic: {}
  ParticleEmitter: { rate: 2, lifetime: 40, typeId: 0 }
  SineWave: { frequency: 0.03, amplitude: 3, axis: x }

Entity.Spark:
  Visual: "spark.png"
  Kinematic: {}
  Gravity: { force: 0.5 }
  Lifetime: { frames: 40 }
  Blink: { interval: 6 }

Entity.Spinner:
  Visual: "spinner.png"
  Kinematic: {}
  SpriteAnimator: { frames: 8, count: 4 }
  Patrol: { speed: 1, axis: x }

Events:
  Collision(Spark:#Body, Level:#FF0000):
    - State.$FX = State.$FX + 1
`;

    default:
      return `Source: "${mzkName}"\n\nSchema:\n  - $Score: { addr: 64, type: Int16 }\n`;
  }
}
