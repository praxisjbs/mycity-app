import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Result } from "./Result";

describe("Result", () => {
  it("announces the outcome without the person going looking for it", () => {
    render(<Result tone="ok" label="Clocked In" title="07:52, On Site" text="Lekki Office" />);
    const box = screen.getByRole("status");
    expect(box).toHaveTextContent("Clocked In");
    expect(box).toHaveTextContent("07:52, On Site");
    expect(screen.getByText("Lekki Office")).toBeInTheDocument();
  });

  it("carries each tone's own glyph and tint", () => {
    const { rerender, container } = render(<Result tone="err" title="Could Not Clock In" />);
    expect(container.firstElementChild!.className).toContain("bg-destructive-soft");
    rerender(<Result tone="warn" title="Late Arrival" />);
    expect(container.firstElementChild!.className).toContain("bg-warning-soft");
  });

  it("takes a glyph of its own", () => {
    const { container } = render(<Result tone="info" title="Signed" icon="doc" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("has no accessibility violations in every tone", async () => {
    const { container } = render(
      <div>
        <Result tone="ok" label="Clocked In" title="07:52, On Site" />
        <Result tone="warn" title="Late Arrival" text="22 minutes past your shift start" />
        <Result tone="err" title="Could Not Clock In" />
        <Result tone="info" title="Signed" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
