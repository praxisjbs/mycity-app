import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { ThemePreview } from "./ThemePreview";

describe("ThemePreview", () => {
  it("is one picture named by its label, its sample hidden from assistive technology", () => {
    render(<ThemePreview label="Preview, Charcoal" />);
    const img = screen.getByRole("img", { name: "Preview, Charcoal" });
    expect(img).toHaveAttribute("data-theme", "dark");
    expect(img.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(img.firstElementChild).toHaveAttribute("data-copy", "content");
  });

  it("draws with the palette and faces it is given, in its own box only", () => {
    render(
      <ThemePreview
        label="Preview, Custom"
        tokens={{ background: "rgb(20, 21, 23)", card: "rgb(30, 32, 35)", "bad name;": "red" }}
        faces={{ heading: "ui-serif, serif", body: "system-ui, sans-serif" }}
      />,
    );
    const img = screen.getByRole("img", { name: "Preview, Custom" });
    expect(img.style.getPropertyValue("--background")).toBe("rgb(20, 21, 23)");
    expect(img.style.getPropertyValue("--card")).toBe("rgb(30, 32, 35)");
    expect(img.style.getPropertyValue("--face-heading")).toBe("ui-serif, serif");
    expect(img.getAttribute("style")).not.toContain("bad name");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ThemePreview label="Preview, Deep Green" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
