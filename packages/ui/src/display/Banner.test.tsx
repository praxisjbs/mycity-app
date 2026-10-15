import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { Banner } from "./Banner";

describe("Banner", () => {
  it("is a status region in its tone, warn by default", () => {
    render(<Banner>Attendance policy updated</Banner>);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("data-tone", "warn");
    expect(region).toHaveTextContent("Attendance policy updated");
  });

  it("is an alert for an error", () => {
    render(<Banner tone="err">Payroll run failed</Banner>);
    expect(screen.getByRole("alert")).toHaveTextContent("Payroll run failed");
  });

  it("takes one action, by the new and the merged prop, reachable by keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Banner tone="info" action={<Button size="sm" onClick={onClick}>Read Policy</Button>}>Policy updated</Banner>);
    await user.tab();
    expect(screen.getByRole("button", { name: "Read Policy" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<Banner tone="info" actions={<Button size="sm">Read Policy</Button>}>Policy updated</Banner>);
    expect(screen.getByRole("button", { name: "Read Policy" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Banner tone="ok" icon="ok">Clocked in at 08:04</Banner>
        <Banner tone="warn" action={<Button size="sm">Read Policy</Button>}>Attendance policy updated</Banner>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
