import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { configurePreferences, currentDensity, currentTextSize, setDensity, setTextSize, setTheme, TEXT_SIZES, themeChoice, useDensity, useTextSize, useTheme } from "./preferences";

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

describe("text size", () => {
  it("is Default with nothing stored, and remembers the others on this device", () => {
    expect(currentTextSize()).toBe("default");
    setTextSize("large");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
    expect(localStorage.getItem("mc-text-size")).toBe("large");
    const { result } = renderHook(() => useTextSize());
    expect(result.current.size).toBe("large");
    act(() => result.current.setTextSize("default"));
    expect(result.current.size).toBe("default");
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
    expect(localStorage.getItem("mc-text-size")).toBeNull();
    expect(TEXT_SIZES.map(([, name]) => name)).toEqual(["Small", "Default", "Large", "Largest"]);
  });
});
