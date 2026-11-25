import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { unreadNotices } from "../lib/format";
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

  it("says its words in full, and shows them in a tooltip on hover on desktop", async () => {
    installOverlayTestEnv();
    render(<CountBadge count={21} words={unreadNotices(21)} tip />);
    expect(screen.getByText("21 unread notices")).toHaveClass("sr-only");
    await userEvent.hover(screen.getByText("21").parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("21 unread notices");
  });

  it("keeps the words in the accessible name only on a phone", async () => {
    setViewport(390);
    render(<CountBadge count={1} words={unreadNotices(1, true)} tip tone="err" />);
    expect(screen.getByText("1 unread notice, urgent")).toHaveClass("sr-only");
    await userEvent.hover(screen.getByText("1").parentElement!);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("tooltip")).toBeNull();
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
