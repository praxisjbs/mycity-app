import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { ClockInIllustration, ILLUSTRATION_NAMES, Illustration } from "./Illustration";

describe("Illustration", () => {
  it("draws every named drawing, decorative by default", () => {
    const { container } = render(
      <div>
        {ILLUSTRATION_NAMES.map((n) => (
          <Illustration key={n} name={n} />
        ))}
      </div>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(9);
    for (const svg of svgs) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg.querySelector("ellipse")).not.toBeNull();
    }
  });

  it("is an image with a name when labelled", () => {
    render(<Illustration name="Locked" label="Locked page" />);
    const img = screen.getByRole("img", { name: "Locked page" });
    expect(img).toHaveAttribute("data-illustration", "Locked");
  });

  it("writes no colour of its own: lines in currentColor, shapes in token classes", () => {
    const { container } = render(<ClockInIllustration size="l" />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/\b(fill|stroke)="(?!none)/);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("w-32");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Illustration name="Empty" />
        <Illustration name="Success" label="Done" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
