import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchExampleScript,
  defaultScript,
  isExampleVariant,
  fetchExampleIndex,
  ROM_VARIANT_LABELS,
  EXAMPLE_VARIANTS,
  type RomVariant,
} from "../editor/example-roms.js";

// ── Mock global fetch ───────────────────────────────────────
const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

describe("example-roms", () => {
  // ── ROM_VARIANT_LABELS ────────────────────────────────────

  it("provides a label for every variant", () => {
    const expected: RomVariant[] = [
      "empty", "amiga", "checkerboard",
      "platformer", "top-down", "particles",
    ];
    for (const v of expected) {
      expect(ROM_VARIANT_LABELS[v]).toBeTruthy();
    }
  });

  // ── isExampleVariant ──────────────────────────────────────

  it("identifies example variants", () => {
    expect(isExampleVariant("platformer")).toBe(true);
    expect(isExampleVariant("top-down")).toBe(true);
    expect(isExampleVariant("particles")).toBe(true);
    expect(isExampleVariant("empty")).toBe(false);
    expect(isExampleVariant("amiga")).toBe(false);
  });

  // ── EXAMPLE_VARIANTS ─────────────────────────────────────

  it("lists three example variants", () => {
    expect(EXAMPLE_VARIANTS).toHaveLength(3);
    expect(EXAMPLE_VARIANTS).toContain("platformer");
    expect(EXAMPLE_VARIANTS).toContain("top-down");
    expect(EXAMPLE_VARIANTS).toContain("particles");
  });

  // ── defaultScript ─────────────────────────────────────────

  it("returns a script with Source line and Schema", () => {
    const s = defaultScript("sprite.mzk");
    expect(s).toContain('Source: "sprite.mzk"');
    expect(s).toContain("$Score");
  });

  // ── fetchExampleScript ────────────────────────────────────

  it("fetches and prepends Source line", async () => {
    const body = "# example\nSchema:\n  - $X: { addr: 64, type: Int16 }\n";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => body,
    });
    const result = await fetchExampleScript("platformer", "level.mzk");
    expect(mockFetch).toHaveBeenCalledWith("examples/platformer.msc");
    expect(result).toBe(`Source: "level.mzk"\n\n${body}`);
  });

  it("returns null on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const result = await fetchExampleScript("platformer", "level.mzk");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    const result = await fetchExampleScript("top-down", "map.mzk");
    expect(result).toBeNull();
  });

  // ── fetchExampleIndex ─────────────────────────────────────

  it("fetches the example manifest", async () => {
    const manifest = [{ id: "platformer", title: "Platformer", hint: "Side-scroll", file: "platformer.msc", description: "desc" }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => manifest,
    });
    const result = await fetchExampleIndex();
    expect(mockFetch).toHaveBeenCalledWith("examples/index.json");
    expect(result).toEqual(manifest);
  });

  it("returns empty array on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const result = await fetchExampleIndex();
    expect(result).toEqual([]);
  });
});
