import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "./Button";
import { ActionGroup } from "./ActionGroup";

/** Work the test finishes by hand. */
function work() {
  let finish: () => void = () => undefined;
  const promise = new Promise<void>((res) => (finish = res));
  return { promise, finish };
}

describe("ActionGroup", () => {
  it("holds the other buttons while one is working", async () => {
    const user = userEvent.setup();
    const job = work();
    const approve = vi.fn();
    render(
      <ActionGroup>
        <Button onClick={() => job.promise}>Reject Leave</Button>
        <Button variant="primary" onClick={approve}>
          Approve Leave
        </Button>
      </ActionGroup>,
    );
    await user.click(screen.getByRole("button", { name: "Reject Leave" }));
    const other = screen.getByRole("button", { name: "Approve Leave" });
    expect(other).toHaveAttribute("data-press", "waiting");
    expect(other).toHaveAttribute("aria-disabled", "true");
    expect(other).not.toHaveAttribute("aria-busy");
    expect(other).not.toBeDisabled();
    await user.click(other);
    expect(approve).not.toHaveBeenCalled();
    await act(async () => job.finish());
    await waitFor(() => expect(other).not.toHaveAttribute("data-press"));
    await user.click(other);
    expect(approve).toHaveBeenCalledOnce();
  });

  it("refuses a sibling pressed in the same frame as the first", () => {
    const approve = vi.fn();
    render(
      <ActionGroup>
        <Button onClick={() => work().promise}>Reject Leave</Button>
        <Button onClick={approve}>Approve Leave</Button>
      </ActionGroup>,
    );
    act(() => {
      screen.getByRole("button", { name: "Reject Leave" }).click();
      screen.getByRole("button", { name: "Approve Leave" }).click();
    });
    expect(approve).not.toHaveBeenCalled();
  });

  it("holds the group around it, and is held by it", async () => {
    const user = userEvent.setup();
    const inner = work();
    render(
      <ActionGroup>
        <Button>Close Record</Button>
        <ActionGroup>
          <Button onClick={() => inner.promise}>Retire Worksite</Button>
          <Button>Edit Worksite</Button>
        </ActionGroup>
      </ActionGroup>,
    );
    await user.click(screen.getByRole("button", { name: "Retire Worksite" }));
    expect(screen.getByRole("button", { name: "Close Record" })).toHaveAttribute("data-press", "waiting");
    expect(screen.getByRole("button", { name: "Edit Worksite" })).toHaveAttribute("data-press", "waiting");
    await act(async () => inner.finish());
    await waitFor(() => expect(screen.getByRole("button", { name: "Close Record" })).not.toHaveAttribute("data-press"));
  });

  it("is held by a busy the caller sets", () => {
    render(
      <ActionGroup>
        <Button busy>Send Note</Button>
        <Button>Cancel</Button>
      </ActionGroup>,
    );
    expect(screen.getByRole("button", { name: "Send Note" })).toHaveAttribute("data-press", "busy");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("data-press", "waiting");
  });

  it("leaves groups apart alone", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ActionGroup>
          <Button onClick={() => work().promise}>Approve Leave</Button>
        </ActionGroup>
        <ActionGroup>
          <Button>Approve Expense</Button>
        </ActionGroup>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Approve Leave" }));
    expect(screen.getByRole("button", { name: "Approve Expense" })).not.toHaveAttribute("data-press");
  });

  it("has no accessibility violations while a button waits", async () => {
    const { container } = render(
      <ActionGroup>
        <Button busy>Approve Leave</Button>
        <Button variant="ghost">Reject Leave</Button>
      </ActionGroup>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
