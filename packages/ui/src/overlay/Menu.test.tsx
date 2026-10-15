import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Button, IconButton } from "../actions/Button";
import { ModalProvider, useModal } from "./Modal";
import { Menu, type MenuItem } from "./Menu";
import { installOverlayTestEnv } from "./test-env";

beforeAll(installOverlayTestEnv);

function items(archive = vi.fn(), trash = vi.fn()): MenuItem[] {
  return [
    { label: "Archive", icon: "book", onSelect: archive },
    { label: "Move to Spam", icon: "alert", onSelect: () => undefined, disabled: true },
    "sep",
    { label: "Move to Trash", icon: "x", danger: true, onSelect: trash },
  ];
}

describe("Menu on desktop", () => {
  it("opens from the keyboard, moves with arrows and runs the chosen item after closing", async () => {
    const user = userEvent.setup();
    const archive = vi.fn();
    render(<Menu trigger={(p) => <IconButton {...p} icon="dots" label="Move this message" />} items={items(archive)} />);
    const trigger = screen.getByRole("button", { name: "Move this message" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("separator")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Move to Trash" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(archive).toHaveBeenCalledOnce());
    expect(trigger).toHaveFocus();
  });

  it("draws destructive items in red", async () => {
    const user = userEvent.setup();
    render(<Menu trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} items={items()} />);
    screen.getByRole("button", { name: "More Actions" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "Move to Trash" }).className).toContain("text-destructive");
  });

  it("takes a plain element as the trigger", async () => {
    const user = userEvent.setup();
    render(<Menu trigger={<Button icon="clock">Schedule</Button>} items={items()} />);
    const trigger = screen.getByRole("button", { name: "Schedule" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("lets an item open a modal that keeps its focus", async () => {
    const user = userEvent.setup();
    function Screen() {
      const modal = useModal();
      return (
        <Menu
          trigger={(p) => <IconButton {...p} icon="dots" label="Channel Menu" />}
          items={[{ label: "View Members", icon: "users", onSelect: () => modal.open({ title: "Members", body: <input aria-label="Find Member" /> }) }]}
        />
      );
    }
    render(
      <ModalProvider>
        <Screen />
      </ModalProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Channel Menu" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "Find Member" });
    await waitFor(() => expect(field).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("has no accessibility violations", async () => {
    const user = userEvent.setup();
    render(<Menu trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} items={items()} />);
    screen.getByRole("button", { name: "More Actions" }).focus();
    await user.keyboard("{Enter}");
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe("Menu on a phone", () => {
  it("is an action sheet with large rows, red destructive items and Cancel", async () => {
    setViewport(390);
    const user = userEvent.setup();
    const trash = vi.fn();
    render(<Menu trigger={(p) => <IconButton {...p} icon="dots" label="Move this message" />} items={items(vi.fn(), trash)} />);
    const trigger = screen.getByRole("button", { name: "Move this message" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const sheet = screen.getByRole("dialog", { name: "Actions" });
    expect(sheet).toHaveAttribute("data-vaul-drawer");
    const row = screen.getByRole("button", { name: "Move to Trash" });
    expect(row.className).toContain("min-h-tap");
    expect(row.className).toContain("text-destructive");
    expect(screen.getByRole("button", { name: "Move to Spam" })).toBeDisabled();
    await user.click(row);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(trash).toHaveBeenCalledOnce());
  });

  it("closes on Cancel without running anything", async () => {
    setViewport(390);
    const user = userEvent.setup();
    const archive = vi.fn();
    render(<Menu trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} items={items(archive)} />);
    await user.click(screen.getByRole("button", { name: "More Actions" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(archive).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(<Menu trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} items={items()} />);
    await user.click(screen.getByRole("button", { name: "More Actions" }));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
