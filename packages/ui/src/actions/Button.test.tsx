import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { BigButton, Button, IconButton } from "./Button";

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
