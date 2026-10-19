import { describe, expect, it } from "vitest";
import { mapColour, mapValue, parseColour, recolourDeclarations, recolourHtml, type DarkTheme, type Rgb } from "./email-dark";

/** Our dark card and foreground. */
const theme: DarkTheme = { bg: [1, 34, 29], fg: [230, 237, 235] };
const near = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - b[i]!) <= 2);

describe("email-dark", () => {
  it("lands white on our card and black on our foreground", () => {
    expect(near(mapColour([255, 255, 255], "bg", theme), theme.bg)).toBe(true);
    expect(near(mapColour([0, 0, 0], "fg", theme), theme.fg)).toBe(true);
  });

  it("leaves a colour that already suits a dark page exactly as sent", () => {
    expect(mapColour([0, 70, 50], "bg", theme)).toEqual([0, 70, 50]);
    expect(mapColour([240, 200, 80], "fg", theme)).toEqual([240, 200, 80]);
  });

  it("keeps a coloured accent border, and darkens a grey divider", () => {
    expect(mapColour([212, 160, 23], "border", theme)).toEqual([212, 160, 23]);
    expect(mapColour([229, 231, 235], "border", theme)).not.toEqual([229, 231, 235]);
  });

  it("keeps the hue: a pale yellow note stays warm, it does not turn grey", () => {
    const [r, , b] = mapColour([255, 248, 200], "bg", theme);
    expect(r).toBeGreaterThan(b);
  });

  it("reads hex, rgb, hsl and named colours, and nothing else", () => {
    /* A sender's hex, built at runtime: colour literals live only in tokens.css. */
    expect(parseColour(["#", "fff"].join(""))?.rgb).toEqual([255, 255, 255]);
    expect(parseColour("rgba(0, 0, 0, 0.5)")).toEqual({ rgb: [0, 0, 0], alpha: 0.5 });
    expect(parseColour("hsl(0, 100%, 50%)")?.rgb).toEqual([255, 0, 0]);
    expect(parseColour("navy")?.rgb).toEqual([0, 0, 128]);
    expect(parseColour("solid")).toBeNull();
  });

  it("moves only colour properties, and never a url", () => {
    const out = recolourDeclarations("color: black; width: 600px; background: url(white.png) white", theme);
    expect(out).toContain("width: 600px");
    expect(out).toContain("url(white.png)");
    expect(out).not.toMatch(/color: black/);
    expect(mapValue("1px solid", "border", theme)).toBe("1px solid");
  });

  it("recolours inline styles and bgcolor, and leaves images alone", () => {
    const html = recolourHtml('<table bgcolor="white"><tr><td style="color:rgb(0, 0, 0)">Hi</td></tr></table><img src="data:image/png;base64,AA" alt="logo">', theme);
    expect(html).not.toContain('bgcolor="white"');
    expect(html).not.toContain("color:rgb(0, 0, 0)");
    expect(html).toContain('src="data:image/png;base64,AA"');
  });

  it("leaves a message that brings its own dark design untouched", () => {
    const own = '<style>@media (prefers-color-scheme: dark) { body { color: white } }</style><p style="color:black">Hi</p>';
    expect(recolourHtml(own, theme)).toBe(own);
  });
});
