import { describe, expect, it } from "vitest";
import { askHref, contextOf, fromLabel } from "./context";

/* The screen Praxis AI was opened from (docs/guides/praxis-ai.md decision 12): read from an address, carried as `from`. */

describe("the screen context", () => {
  it("reads the module, the tab, the record open, the search and the filters; never the address's own keys", () => {
    expect(contextOf("/people?tab=leave&status=waiting&id=00000000-0000-4000-8000-0000000000e1&q=ayo&page=2&sort=-starts_on&action=new")).toEqual({
      module: "people",
      tab: "leave",
      id: "00000000-0000-4000-8000-0000000000e1",
      q: "ayo",
      filters: { status: "waiting" },
    });
    expect(contextOf("/home")).toEqual({ module: "home", tab: "overview" });
    expect(contextOf("/people?tab=leave&id=not-a-record")).toEqual({ module: "people", tab: "leave" });
  });

  it("is nothing off a screen", () => {
    expect(contextOf(null)).toBeNull();
    expect(contextOf("/nowhere?tab=x")).toBeNull();
    expect(contextOf("/people?tab=no-such-tab")).toBeNull();
    expect(contextOf("not an address")).toBeNull();
  });

  it("the full screen's address carries the screen as from, never Praxis AI itself", () => {
    expect(askHref("/people?tab=leave&status=waiting")).toBe("/praxis-ai?tab=ask&from=%2Fpeople%3Ftab%3Dleave%26status%3Dwaiting");
    expect(askHref("/praxis-ai?tab=history")).toBe("/praxis-ai?tab=ask");
    expect(askHref(null)).toBe("/praxis-ai?tab=ask");
    expect(askHref("/nowhere")).toBe("/praxis-ai?tab=ask");
  });

  it("names the screen Back returns to", () => {
    expect(fromLabel("/people?tab=leave&status=waiting")).toBe("People · Leave");
    expect(fromLabel("/home")).toBe("Home · Overview");
    expect(fromLabel(null)).toBeNull();
    expect(fromLabel("/nowhere")).toBeNull();
  });
});
