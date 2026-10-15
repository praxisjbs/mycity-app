import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("marks the title and subtitle slots", () => {
    render(<PageHeader title="My Leave" subtitle="2026 entitlement" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "My Leave" });
    expect(h1).toHaveAttribute("data-ui", "page-title");
    const sub = screen.getByText("2026 entitlement");
    expect(sub).toHaveAttribute("data-ui", "page-subtitle");
    expect(sub.className).toContain("phone:hidden");
  });

  it("takes the merged `sub` prop and skips an empty one", () => {
    const { rerender, container } = render(<PageHeader title="Devices" sub="Devices used to clock in" />);
    expect(screen.getByText("Devices used to clock in")).toHaveAttribute("data-ui", "page-subtitle");
    rerender(<PageHeader title="Devices" sub="" />);
    expect(container.querySelector("[data-ui=page-subtitle]")).toBeNull();
  });

  it("puts the actions in reach of the keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<PageHeader title="Worksites" actions={<Button variant="primary" icon="plus" onClick={onClick}>Add Worksite</Button>} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Add Worksite" })).toHaveFocus();
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<PageHeader title="My Leave" subtitle="2026 entitlement" actions={<Button variant="primary">Request Leave</Button>} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
