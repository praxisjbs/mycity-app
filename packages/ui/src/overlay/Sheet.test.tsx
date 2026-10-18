import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Button } from "../actions/Button";
import { Sheet } from "./Sheet";
import { installOverlayTestEnv } from "./test-env";

beforeAll(installOverlayTestEnv);


function Host({ onClose = () => undefined, refuse = false }: { onClose?: () => void; refuse?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Leave Balance</Button>
      <Sheet
        open={open}
        onClose={() => {
          onClose();
          if (!refuse) setOpen(false);
        }}
        title="Leave Balance"
        footer={<Button variant="primary">Request Leave</Button>}
      >
        <p>12 days left</p>
      </Sheet>
    </>
  );
}

const scrim = () => document.querySelector<HTMLElement>("[data-vaul-overlay]")!;
const handle = () => screen.getByRole("dialog").querySelector(":scope > div[aria-hidden=true]");

/** An 800 px tall page whose visual viewport the test shrinks the way a phone's keyboard does. */
function keyboard() {
  const target = new EventTarget();
  const view = Object.assign(target, { height: 800, offsetTop: 0, scale: 1 });
  const had = Object.getOwnPropertyDescriptor(window, "visualViewport");
  Object.defineProperty(window, "visualViewport", { configurable: true, value: view });
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 800 });
  return {
    open(height: number, offsetTop = 0) {
      view.height = 800 - height;
      view.offsetTop = offsetTop;
      view.dispatchEvent(new Event("resize"));
    },
    restore() {
      if (had) Object.defineProperty(window, "visualViewport", had);
      else Reflect.deleteProperty(window, "visualViewport");
      Reflect.deleteProperty(document.documentElement, "clientHeight");
    },
  };
}

describe("Sheet", () => {
  it("slides up from the bottom with a handle, a title and a footer", async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Leave Balance" }));
    const sheet = screen.getByRole("dialog", { name: "Leave Balance" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("data-vaul-drawer");
    expect(sheet.className).toContain("rounded-t-sheet");
    expect(sheet.querySelector('[data-ui="modal-footer"]')).toContainElement(screen.getByRole("button", { name: "Request Leave" }));
    expect(sheet).toHaveFocus();
  });

  it("closes on Esc and the close button, and returns focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Leave Balance" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("stays open when its owner refuses to close", async () => {
    const user = userEvent.setup();
    render(<Host refuse />);
    await user.click(screen.getByRole("button", { name: "Leave Balance" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Leave Balance" })).toBeInTheDocument();
  });

  it("closes on a scrim tap while it holds no text field", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Leave Balance">
        <p>12 days left</p>
      </Sheet>,
    );
    expect(handle()).not.toBeNull();
    await user.click(scrim());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("holding a text field, ignores the scrim and closes only on purpose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Register Device">
        <label>
          Device Name
          <input />
        </label>
      </Sheet>,
    );
    const field = screen.getByRole("textbox", { name: "Device Name" });
    await user.type(field, "Work Phone");
    expect(handle()).toBeNull();
    await user.click(scrim());
    expect(onClose).not.toHaveBeenCalled();
    // The tap put the keyboard away: the field lost focus, the typing stayed.
    expect(field).not.toHaveFocus();
    expect(field).toHaveValue("Work Phone");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("still closes from the close button when not dismissible", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Sheet open dismissible={false} onClose={onClose} title="Sign Offer" />);
    await user.keyboard("{Escape}");
    await user.click(scrim());
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays above the keyboard with its header in view", () => {
    const view = keyboard();
    render(
      <Sheet open onClose={() => undefined} title="Register Device">
        <input aria-label="Device Name" />
      </Sheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "Register Device" });
    act(() => view.open(300));
    expect(sheet.style.bottom).toBe("300px");
    expect(sheet.style.maxHeight).toBe("458px");
    act(() => view.open(0));
    expect(sheet.style.bottom).toBe("");
    expect(sheet.style.maxHeight).toBe("");
    view.restore();
  });

  it("keeps a full sheet between the top of the visible area and the keyboard", () => {
    const view = keyboard();
    render(<Sheet open full onClose={() => undefined} title="New Message" />);
    const sheet = screen.getByRole("dialog", { name: "New Message" });
    act(() => view.open(300, 40));
    expect(sheet.style.top).toBe("40px");
    expect(sheet.style.bottom).toBe("260px");
    view.restore();
  });

  it("keeps the title for screen readers only when the header is hidden", () => {
    render(
      <Sheet open hideHeader onClose={() => undefined} title="Actions">
        <p>Archive</p>
      </Sheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "Actions" });
    expect(sheet.querySelector('[data-ui="title"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    render(
      <Sheet open onClose={() => undefined} title="Leave Balance" sub="Annual leave this year" footer={<Button variant="primary">Request Leave</Button>}>
        <p>12 days left</p>
      </Sheet>,
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
