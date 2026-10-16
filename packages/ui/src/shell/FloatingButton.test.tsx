import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { setViewport } from "../testing/viewport";
import { FloatingButton } from "./FloatingButton";
import { ShellScrollContext } from "./scroll";

const actions = (clock = vi.fn()) => [
  { key: "new", label: "New Task", icon: "plus" as const, onSelect: vi.fn() },
  { key: "clock", label: "Clock In", icon: "clock" as const, onSelect: clock },
  { key: "ai", label: "Praxis AI", icon: "spark" as const, onSelect: vi.fn() },
  { key: "help", label: "Help", icon: "help" as const, onSelect: vi.fn() },
];

beforeAll(installOverlayTestEnv);

describe("FloatingButton", () => {
  it("fans out its actions with Hide Here last, focusing the first", async () => {
    setViewport(390);
    render(<FloatingButton actions={actions()} onHideHere={vi.fn()} />);
    const main = screen.getByRole("button", { name: "Quick Actions" });
    expect(main).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(main);
    expect(main).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "Quick Actions" });
    const buttons = list.querySelectorAll("button");
    expect([...buttons].map((b) => b.textContent)).toEqual(["New Task", "Clock In", "Praxis AI", "Help", "Hide Here"]);
    expect(buttons[0]).toHaveFocus();
  });

  it("runs an action and closes; Esc closes and returns focus", async () => {
    setViewport(390);
    const clock = vi.fn();
    render(<FloatingButton actions={actions(clock)} onHideHere={vi.fn()} />);
    const main = screen.getByRole("button", { name: "Quick Actions" });
    await userEvent.click(main);
    await userEvent.click(screen.getByRole("button", { name: "Clock In" }));
    expect(clock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("list")).toBeNull();
    await userEvent.click(main);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list")).toBeNull();
    expect(main).toHaveFocus();
  });

  it("Hide Here asks the app to hide it; hidden, it leaves the tab order", async () => {
    setViewport(390);
    const onHideHere = vi.fn();
    const { container, rerender } = render(<FloatingButton actions={actions()} onHideHere={onHideHere} />);
    await userEvent.click(screen.getByRole("button", { name: "Quick Actions" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide Here" }));
    expect(onHideHere).toHaveBeenCalledOnce();
    rerender(<FloatingButton actions={actions()} onHideHere={onHideHere} hidden />);
    expect(container.querySelector("[data-fab]")).toHaveAttribute("aria-hidden", "true");
  });

  it("tucks away while the page scrolls down", () => {
    setViewport(390);
    const { container } = render(
      <ShellScrollContext.Provider value={{ direction: "down", atTop: false }}>
        <FloatingButton actions={actions()} onHideHere={vi.fn()} />
      </ShellScrollContext.Provider>,
    );
    expect(container.querySelector("[data-fab]")).toHaveAttribute("aria-hidden", "true");
  });

  it("hides while a dialog is open", async () => {
    setViewport(390);
    const { container } = render(<FloatingButton actions={actions()} onHideHere={vi.fn()} />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    await act(async () => {
      document.body.appendChild(dialog);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector("[data-fab]")).toHaveAttribute("aria-hidden", "true");
    dialog.remove();
  });

  it("has no accessibility violations, closed and open", async () => {
    setViewport(390);
    const { container } = render(<FloatingButton actions={actions()} onHideHere={vi.fn()} defaultOpen />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
