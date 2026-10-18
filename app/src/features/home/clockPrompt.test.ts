// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The clock-in prompt opens once per person and Lagos day (docs/guides/home.md §6): the server
 * keeps saying it is due for the rest of that first session, the screen opens it only once.
 * Each test loads the module afresh, as a new page would.
 */
const fresh = async () => {
  vi.resetModules();
  return (await import("./clockPrompt")).claimClockPrompt;
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("claimClockPrompt", () => {
  it("answers true once for a person and day, then false", async () => {
    const claim = await fresh();
    expect(claim("u1", "2026-10-19")).toBe(true);
    expect(claim("u1", "2026-10-19")).toBe(false);
  });

  it("remembers across a reload of the page, on this device", async () => {
    expect((await fresh())("u1", "2026-10-19")).toBe(true);
    expect((await fresh())("u1", "2026-10-19")).toBe(false);
  });

  it("is due again the next day, and for someone else signing in on the same device", async () => {
    const claim = await fresh();
    expect(claim("u1", "2026-10-19")).toBe(true);
    expect(claim("u1", "2026-10-20")).toBe(true);
    expect(claim("u2", "2026-10-20")).toBe(true);
  });

  it("still opens it only once while the page lives when the browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const claim = await fresh();
    expect(claim("u1", "2026-10-19")).toBe(true);
    expect(claim("u1", "2026-10-19")).toBe(false);
  });
});
