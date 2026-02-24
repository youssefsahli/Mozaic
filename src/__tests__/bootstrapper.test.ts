import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  logToConsole,
  clearConsole,
  hideConsole,
  stopProject,
} from "../editor/bootstrapper.js";

/**
 * Unit tests for the Bootstrapper console helpers and stopProject.
 *
 * The full bootProject() flow depends on DOM canvas, WebGL, and
 * requestAnimationFrame which are not available in jsdom, so we
 * test the utility layer that *is* environment-agnostic.
 */

function makeConsoleEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "compiler-console";
  return el;
}

describe("logToConsole", () => {
  it("appends an info line", () => {
    const el = makeConsoleEl();
    logToConsole(el, "hello", "info");
    const line = el.querySelector(".cc-line") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toBe("hello");
    expect(line.classList.contains("cc-info")).toBe(true);
  });

  it("appends a success line", () => {
    const el = makeConsoleEl();
    logToConsole(el, "ok", "success");
    const line = el.querySelector(".cc-success") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toBe("ok");
  });

  it("appends an error line", () => {
    const el = makeConsoleEl();
    logToConsole(el, "fail", "error");
    const line = el.querySelector(".cc-error") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toBe("fail");
  });

  it("appends multiple lines in order", () => {
    const el = makeConsoleEl();
    logToConsole(el, "first", "info");
    logToConsole(el, "second", "success");
    logToConsole(el, "third", "error");
    const lines = el.querySelectorAll(".cc-line");
    expect(lines.length).toBe(3);
    expect(lines[0].textContent).toBe("first");
    expect(lines[1].textContent).toBe("second");
    expect(lines[2].textContent).toBe("third");
  });

  it("applies info type when explicitly passed", () => {
    const el = makeConsoleEl();
    logToConsole(el, "default", "info");
    const line = el.querySelector(".cc-info") as HTMLElement;
    expect(line).not.toBeNull();
  });
});

describe("clearConsole", () => {
  it("removes all children and shows the element", () => {
    const el = makeConsoleEl();
    logToConsole(el, "old message", "info");
    expect(el.children.length).toBe(1);

    clearConsole(el);
    expect(el.children.length).toBe(0);
    expect(el.classList.contains("is-visible")).toBe(true);
  });
});

describe("hideConsole", () => {
  it("removes the is-visible class", () => {
    const el = makeConsoleEl();
    el.classList.add("is-visible");
    hideConsole(el);
    expect(el.classList.contains("is-visible")).toBe(false);
  });
});

describe("stopProject", () => {
  it("calls stop on loop and dispose on inputManager", () => {
    const loop = { stop: vi.fn() } as any;
    const inputManager = { dispose: vi.fn() } as any;
    stopProject(loop, inputManager, null, null);
    expect(loop.stop).toHaveBeenCalled();
    expect(inputManager.dispose).toHaveBeenCalled();
  });

  it("handles null loop and inputManager gracefully", () => {
    expect(() => stopProject(null, null, null, null)).not.toThrow();
  });

  it("hides the console element", () => {
    const el = makeConsoleEl();
    el.classList.add("is-visible");
    stopProject(null, null, el, null);
    expect(el.classList.contains("is-visible")).toBe(false);
  });

  it("clears the hide timer", () => {
    vi.useFakeTimers();
    const timerId = window.setTimeout(() => {}, 5000);
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    stopProject(null, null, null, timerId);
    expect(clearSpy).toHaveBeenCalledWith(timerId);
    clearSpy.mockRestore();
    vi.useRealTimers();
  });
});
