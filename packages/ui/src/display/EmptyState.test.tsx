import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("shows the Empty drawing, the title and the line in their slots, inside a card", () => {
    const { container } = render(<EmptyState title="No Requests Yet" text="Your leave requests appear here" />);
    expect(container.querySelector("[data-card]")).not.toBeNull();
    expect(container.querySelector("[data-illustration=Empty]")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "No Requests Yet" })).toHaveAttribute("data-ui", "title");
    expect(screen.getByText("Your leave requests appear here")).toHaveAttribute("data-ui", "empty-text");
  });

  it("takes a named drawing, the merged icon, and draws bare", () => {
    const { container, rerender } = render(<EmptyState illustration="Search" title="No Matches" bare />);
    expect(container.querySelector("[data-card]")).toBeNull();
    expect(container.querySelector("[data-illustration=Search]")).not.toBeNull();
    rerender(<EmptyState icon="clock" title="No Clock Events" bare />);
    expect(container.querySelector("[data-illustration]")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("a bare one is h3 unless its place asks for another level", () => {
    const { rerender } = render(<EmptyState title="Try Asking" bare />);
    expect(screen.getByRole("heading", { level: 3, name: "Try Asking" })).toBeInTheDocument();
    rerender(<EmptyState title="Try Asking" bare level={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "Try Asking" })).toBeInTheDocument();
  });

  it("offers its one action to the keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<EmptyState title="No Requests Yet" action={<Button variant="primary" onClick={onClick}>Request Leave</Button>} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Request Leave" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<EmptyState title="No Requests Yet" text="Your leave requests appear here" action={<Button variant="primary">Request Leave</Button>} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
