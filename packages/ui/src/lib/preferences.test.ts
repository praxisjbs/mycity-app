import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { configurePreferences, currentDensity, setDensity, setTheme, themeChoice, useDensity, useTheme } from "./preferences";

describe("theme", () => {
  it("sets the attribute and remembers the choice", () => {
    setTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("mc-theme")).toBe("dark");
    setTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("mc-theme")).toBeNull();
    expect(themeChoice()).toBe("system");
  });

  it("keeps the merged hook shape: theme and toggle", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("dark");
    expect(result.current.choice).toBe("dark");
  });

  it("uses the app's own key when configured", () => {
    configurePreferences({ themeKey: "mc-public-theme" });
    setTheme("light");
    expect(localStorage.getItem("mc-public-theme")).toBe("light");
    configurePreferences({ themeKey: "mc-theme" });
  });
});

describe("density", () => {
  it("is compact by default and remembers comfortable", () => {
    expect(currentDensity()).toBe("compact");
    setDensity("comfortable");
    expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
    expect(localStorage.getItem("mc-density")).toBe("comfortable");
    const { result } = renderHook(() => useDensity());
    act(() => result.current.toggle());
    expect(result.current.density).toBe("compact");
    expect(localStorage.getItem("mc-density")).toBeNull();
  });
});
