import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("says it in one line, as an alert, and Try Again reloads", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState error={{ status: 500, message: "Something went wrong on our side. Try again.", reference: "REF-7Q2K" }} onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This did not load");
    expect(alert).not.toHaveTextContent("Something went wrong");
    expect(screen.getByText("REF-7Q2K")).toHaveAttribute("data-copy", "content");
    await user.click(screen.getByRole("button", { name: "Try Again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("chooses the line from the status and leaves out Try Again where it cannot help", () => {
    const { rerender } = render(<ErrorState error={{ status: 403 }} onRetry={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent("You do not have access to this");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ErrorState error={{ status: 0 }} onRetry={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent("You are offline");
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    rerender(<ErrorState message="The chart did not draw" />);
    expect(screen.getByRole("alert")).toHaveTextContent("The chart did not draw");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws the error illustration for a whole screen", () => {
    const { container } = render(<ErrorState page message="This screen hit a problem" />);
    expect(container.querySelector('[data-illustration="Error"]')).not.toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ErrorState error={{ status: 500, reference: "REF-7Q2K" }} onRetry={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
