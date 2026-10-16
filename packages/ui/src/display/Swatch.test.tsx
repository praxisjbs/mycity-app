import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Swatch } from "./Swatch";

describe("Swatch", () => {
  it("shows the token it is given, as a variable the class reads", () => {
    const { container } = render(<Swatch token="--primary" />);
    const square = container.firstElementChild as HTMLElement;
    expect(square.style.getPropertyValue("--swatch")).toBe("var(--primary)");
    expect(square.className).toContain("bg-(--swatch)");
  });

  it("comes smaller for a denser list", () => {
    const { container } = render(<Swatch token="--chart-1" size="sm" />);
    expect(container.firstElementChild!.className).toContain("size-6");
  });

  it("is decorative: the name and the value are words beside it", () => {
    const { container } = render(<Swatch token="--primary" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <p>
        <Swatch token="--primary" /> Primary Yellow
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
