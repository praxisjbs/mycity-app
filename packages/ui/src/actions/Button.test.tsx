import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { BigButton, Button, IconButton } from "./Button";

/** Work the test finishes by hand. */
function work() {
  let finish: () => void = () => undefined;
  let fail: (e: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    finish = res;
    fail = rej;
  });
  return { promise, finish, fail };
}

describe("Button", () => {
  it("renders a native button with the slot and variant", () => {
    render(<Button variant="primary" icon="plus">Create Rule</Button>);
    const button = screen.getByRole("button", { name: "Create Rule" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-ui", "button");
    expect(button).toHaveAttribute("data-variant", "primary");
    expect(button.className).toContain("h-control");
  });

  it("answers a click, Enter and Space", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Clock In</Button>);
    const button = screen.getByRole("button", { name: "Clock In" });
    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("ignores presses while busy but stays focusable", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button busy onClick={onClick}>Save Changes</Button>);
    const button = screen.getByRole("button", { name: "Save Changes" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is busy from the press until the work it returns settles, and ignores presses meanwhile", async () => {
    const user = userEvent.setup();
    const job = work();
    const onClick = vi.fn(() => job.promise);
    render(<Button variant="primary" icon="send" onClick={onClick}>Send Note</Button>);
    const button = screen.getByRole("button", { name: "Send Note" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("data-press", "busy");
    expect(button).not.toBeDisabled();
    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
    await act(async () => job.finish());
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("refuses a double click before React has drawn the spinner", () => {
    const onClick = vi.fn(() => work().promise);
    render(<Button onClick={onClick}>Approve Leave</Button>);
    const button = screen.getByRole("button", { name: "Approve Leave" });
    // Both clicks land before React renders again, so only the button's own ref can stop the second.
    act(() => {
      button.click();
      button.click();
    });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("comes back when the work fails, and logs what nobody caught", async () => {
    const user = userEvent.setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const job = work();
    render(<Button onClick={() => job.promise}>Save Changes</Button>);
    const button = screen.getByRole("button", { name: "Save Changes" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => job.fail(new Error("offline")));
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    expect(logged).toHaveBeenCalledWith(new Error("offline"));
  });

  it("stays plain for a press that returns nothing", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Open Payslips</Button>);
    const button = screen.getByRole("button", { name: "Open Payslips" });
    await user.click(button);
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("data-press");
  });

  it("spins in the icon's place, else over the label, keeping the label as its name", async () => {
    const user = userEvent.setup();
    const job = work();
    render(
      <div>
        <Button icon="plus" onClick={() => job.promise}>Create Rule</Button>
        <Button iconRight="right" onClick={() => job.promise}>View All</Button>
        <Button onClick={() => job.promise}>Save Worksite</Button>
      </div>,
    );
    const lead = screen.getByRole("button", { name: "Create Rule" });
    const trail = screen.getByRole("button", { name: "View All" });
    const bare = screen.getByRole("button", { name: "Save Worksite" });
    await user.click(lead);
    expect(lead.querySelectorAll("svg")).toHaveLength(1);
    expect(lead.querySelector("svg")).toHaveClass("animate-spin");
    await act(async () => job.finish());
    await waitFor(() => expect(lead).not.toHaveAttribute("aria-busy"));
    const again = work();
    render(<Button iconRight="right" onClick={() => again.promise}>Open Report</Button>);
    const right = screen.getByRole("button", { name: "Open Report" });
    await user.click(right);
    expect(right.lastElementChild).toHaveClass("animate-spin");
    expect(trail).not.toHaveAttribute("aria-busy");
    const third = work();
    render(<Button onClick={() => third.promise}>Record Decision</Button>);
    const middle = screen.getByRole("button", { name: "Record Decision" });
    await user.click(middle);
    expect(middle).toHaveClass("relative");
    expect(middle.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.getByText("Record Decision")).toHaveClass("opacity-0");
    expect(bare).not.toHaveAttribute("aria-busy");
  });

  it("renders its child with the button's look when asChild", () => {
    render(
      <Button asChild variant="ghost" iconRight="right">
        <a href="/people?tab=leave">View All</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "View All" });
    expect(link).toHaveAttribute("data-ui", "button");
    expect(link).not.toHaveAttribute("type");
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Create Rule</Button>
        <Button variant="danger">Delete Rule</Button>
        <IconButton icon="bell" label="Notifications" dot />
        <BigButton icon="right">Sign In</BigButton>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("IconButton", () => {
  it("turns its glyph to a spinner while the work it returns runs", async () => {
    const user = userEvent.setup();
    const job = work();
    const onClick = vi.fn(() => job.promise);
    render(<IconButton icon="refresh" label="Refresh List" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Refresh List" });
    await user.click(button);
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg")).toHaveClass("animate-spin");
    await act(async () => job.finish());
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
  });

  it("is named by its label", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="srch" label="Search" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Search" });
    expect(button).not.toHaveAttribute("title");
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("BigButton", () => {
  it("spins while the work it returns runs", async () => {
    const user = userEvent.setup();
    const job = work();
    const onClick = vi.fn(() => job.promise);
    render(<BigButton icon="clock" onClick={onClick}>Clock In</BigButton>);
    const button = screen.getByRole("button", { name: "Clock In" });
    await user.click(button);
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => job.finish());
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
  });

  it("submits a form unless busy", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <BigButton type="submit">Sign In</BigButton>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    rerender(
      <form onSubmit={onSubmit}>
        <BigButton type="submit" busy>
          Sign In
        </BigButton>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
