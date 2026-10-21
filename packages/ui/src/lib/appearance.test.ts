import { afterEach, describe, expect, it } from "vitest";
import appearanceSchemas from "@mycity/contract/schemas/appearance.js";
import { appearanceCss, applyAppearance, APPEARANCE_STYLE_ID, tokenDeclarations, type AppliedAppearance } from "./appearance";
import { FONT_IDS, fontStack } from "./fonts";
import { currentDensity, setDensity, setTheme, themeChoice } from "./preferences";

/** The contract's own lists, typed for this test (the schema file is CommonJS). */
const contract = appearanceSchemas as unknown as {
  FONTS: ReadonlyArray<{ id: string }>;
  DARK_PRESETS: ReadonlyArray<{ key: string; seeds: Record<string, string> }>;
  deriveDark: (seeds: Record<string, string>) => { tokens: Record<string, string> };
};

const geist = { heading: "geist", body: "geist" };
const plain: AppliedAppearance = { dark: null, fonts: geist, theme_default: "system", density_default: "compact" };
const charcoal = contract.deriveDark(contract.DARK_PRESETS.find((p) => p.key === "charcoal")!.seeds).tokens;

afterEach(() => {
  document.getElementById(APPEARANCE_STYLE_ID)?.remove();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
});

describe("the saved appearance", () => {
  it("offers the contract's faces, each with the system's sans behind it", () => {
    expect(FONT_IDS).toEqual(contract.FONTS.map((f) => f.id));
    expect(fontStack("inter")).toBe('"Inter Variable", ui-sans-serif, system-ui, -apple-system, sans-serif');
    expect(fontStack("comic")).toBe(fontStack("geist"));
  });

  it("writes only the faces for MyCity's own palette, and the dark tokens over both dark blocks for another", () => {
    expect(appearanceCss(plain)).not.toContain("data-theme");
    const css = appearanceCss({ ...plain, dark: charcoal, fonts: { heading: "plus_jakarta_sans", body: "inter" } });
    expect(css).toContain('--face-heading: "Plus Jakarta Sans Variable"');
    expect(css).toContain(`--card: ${charcoal.card};`);
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain('@media (prefers-color-scheme: dark) { :root:root:not([data-theme="light"])');
  });

  it("lets nothing but a token name and a colour through", () => {
    expect(tokenDeclarations({ card: "red; } body { display: none", "x;y": "rgba(1, 2, 3, .5)", glass: "rgba(1, 34, 29, .82)" })).toBe("--glass: rgba(1, 34, 29, .82);");
  });

  it("applies one style element, keeps it for the next first paint, and starts a person on the organisation's defaults", () => {
    applyAppearance({ ...plain, dark: charcoal, theme_default: "dark", density_default: "comfortable" });
    applyAppearance({ ...plain, dark: charcoal, theme_default: "dark", density_default: "comfortable" });
    expect(document.querySelectorAll(`#${APPEARANCE_STYLE_ID}`)).toHaveLength(1);
    expect(localStorage.getItem("mc-appearance-css")).toBe(document.getElementById(APPEARANCE_STYLE_ID)!.textContent);
    expect(JSON.parse(localStorage.getItem("mc-appearance-defaults")!)).toEqual({ theme: "dark", density: "comfortable" });
    expect(themeChoice()).toBe("dark");
    expect(currentDensity()).toBe("comfortable");
    // Nothing is stored as the person's own choice.
    expect(localStorage.getItem("mc-theme")).toBeNull();
  });

  it("never overrides a theme or density the person chose on this device", () => {
    setTheme("light");
    setDensity("compact");
    localStorage.setItem("mc-density", "compact");
    applyAppearance({ ...plain, theme_default: "dark", density_default: "comfortable" });
    expect(themeChoice()).toBe("light");
    expect(currentDensity()).toBe("compact");
  });
});
