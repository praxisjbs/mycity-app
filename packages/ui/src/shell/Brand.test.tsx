import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Brand } from "./Brand";

describe("Brand", () => {
  it("is an image named MyCity App when the pin stands alone", () => {
    render(<Brand />);
    expect(screen.getByRole("img", { name: "MyCity App" })).toBeInTheDocument();
  });

  it("reads the name, not the drawing, when the name is shown", () => {
    const { container } = render(<Brand name="MyCityApp" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("MyCityApp")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("takes the yellow on a dark surface, City Green otherwise", () => {
    const { container, rerender } = render(<Brand tone="on-dark" />);
    expect(container.querySelector("svg")).toHaveClass("fill-primary");
    rerender(<Brand />);
    expect(container.querySelector("svg")).toHaveClass("fill-secondary");
  });

  it("draws the public site's tile, with the name and its line beside it", () => {
    const { container } = render(<Brand name="MyCityApp" sub="Careers" tile="deep" />);
    expect(container.querySelector(".ps-mark svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("MyCityApp").tagName).toBe("B");
    expect(screen.getByText("Careers")).toBeInTheDocument();
    const { container: alone } = render(<Brand tile="secondary" />);
    expect(alone.querySelector(".ps-mark-secondary svg")).toHaveAttribute("aria-label", "MyCity App");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Brand />
        <Brand name="MyCityApp" size="l" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
