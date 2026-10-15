import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { CountBadge } from "./CountBadge";

describe("CountBadge", () => {
  it("shows the number and says what it counts", () => {
    render(<CountBadge count={3} label="approvals waiting" />);
    expect(screen.getByText("3")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("3 approvals waiting")).toHaveClass("sr-only");
  });

  it("caps at max on screen but says the full count", () => {
    render(<CountBadge count={1200} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toHaveClass("sr-only");
  });

  it("draws nothing for zero unless asked", () => {
    const { container, rerender } = render(<CountBadge count={0} />);
    expect(container.innerHTML).toBe("");
    rerender(<CountBadge count={0} showZero tone="neutral" />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <p>
        Approvals <CountBadge count={3} label="waiting" /> <CountBadge count={140} tone="err" />
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
