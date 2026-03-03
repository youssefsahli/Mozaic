/**
 * Example ROM helpers.
 *
 * Example .msc scripts live in public/examples/ and are fetched at
 * runtime so they can be maintained as standalone files.
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

/** Variants that have a matching file in public/examples/. */
export const EXAMPLE_VARIANTS: readonly RomVariant[] = [
  "platformer",
  "top-down",
  "particles",
];

/** Descriptor for one example entry in the manifest. */
export interface ExampleEntry {
  id: string;
  title: string;
  hint: string;
  file: string;
  description: string;
}

/** Base URL for examples (relative to site root). */
const EXAMPLES_BASE = "examples";

/**
 * Fetch the examples manifest (`public/examples/index.json`).
 * Returns an empty array on network/parse failure.
 */
export async function fetchExampleIndex(): Promise<ExampleEntry[]> {
  try {
    const res = await fetch(`${EXAMPLES_BASE}/index.json`);
    if (!res.ok) return [];
    return (await res.json()) as ExampleEntry[];
  } catch {
    return [];
  }
}

/**
 * Fetch the .msc script for a given example variant.
 *
 * The fetched text has a `Source:` line prepended that references the
 * supplied `mzkName`, so the script is ready to use in a project.
 *
 * Returns `null` if the fetch fails.
 */
export async function fetchExampleScript(
  variant: RomVariant,
  mzkName: string,
): Promise<string | null> {
  const filename = `${variant}.msc`;
  try {
    const res = await fetch(`${EXAMPLES_BASE}/${filename}`);
    if (!res.ok) return null;
    const body = await res.text();
    return `Source: "${mzkName}"\n\n${body}`;
  } catch {
    return null;
  }
}

/**
 * Return a minimal default .msc script for non-example variants.
 */
export function defaultScript(mzkName: string): string {
  return `Source: "${mzkName}"\n\nSchema:\n  - $Score: { addr: 64, type: Int16 }\n`;
}

/** Return true if the variant has an example file to fetch. */
export function isExampleVariant(variant: RomVariant): boolean {
  return (EXAMPLE_VARIANTS as readonly string[]).includes(variant);
}

