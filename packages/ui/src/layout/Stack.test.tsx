import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Inline, Stack } from "./Stack";

describe("Stack", () => {
  it("stacks with the default gap and renders a list when asked", () => {
    const { container, rerender } = render(
      <Stack>
        <p>One</p>
        <p>Two</p>
      </Stack>,
    );
    expect(container.firstElementChild?.className).toContain("flex-col");
    expect(container.firstElementChild?.className).toContain("gap-3");
    rerender(
      <Stack as="ul" gap={1}>
        <li>One</li>
        <li>Two</li>
      </Stack>,
    );
    expect(screen.getByRole("list")).toHaveClass("gap-1");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("Inline", () => {
  it("wraps by default and can hold one line", () => {
    const { container, rerender } = render(<Inline><span>A</span></Inline>);
    expect(container.firstElementChild?.className).toContain("flex-wrap");
    rerender(<Inline nowrap justify="between"><span>A</span></Inline>);
    expect(container.firstElementChild?.className).toContain("flex-nowrap");
    expect(container.firstElementChild?.className).toContain("justify-between");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Stack>
        <Inline as="ul">
          <li>Approved</li>
          <li>Annual Leave</li>
        </Inline>
      </Stack>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
