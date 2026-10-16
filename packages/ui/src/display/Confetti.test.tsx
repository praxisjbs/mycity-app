import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Confetti } from "./Confetti";

describe("Confetti", () => {
  it("drops its pieces, each with its own place, pace and head start", () => {
    const { container } = render(<Confetti />);
    const pieces = container.querySelectorAll<HTMLElement>("i");
    expect(pieces).toHaveLength(16);
    const first = pieces[0]!;
    expect(first.style.getPropertyValue("--piece-left")).toBe("3%");
    expect(first.style.getPropertyValue("--piece-ink")).toBe("var(--chart-1)");
    expect(first.style.getPropertyValue("--piece-time")).toBeTruthy();
    expect(first.style.getPropertyValue("--piece-delay")).toBeTruthy();
  });

  it("scatters the pieces from their own index, so nothing is random", () => {
    const one = render(<Confetti />);
    const two = render(<Confetti />);
    const places = (r: ReturnType<typeof render>) => [...r.container.querySelectorAll<HTMLElement>("i")].map((i) => i.style.getPropertyValue("--piece-left"));
    expect(places(one)).toEqual(places(two));
    expect(new Set(places(one)).size).toBeGreaterThan(10);
  });

  it("drops stars when asked", () => {
    const { container } = render(<Confetti shape="stars" />);
    expect(container.firstElementChild!.className).toContain("stars");
  });

  it("is decorative and hidden from screen readers", () => {
    const { container } = render(<Confetti />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div className="relative">
        <Confetti />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
