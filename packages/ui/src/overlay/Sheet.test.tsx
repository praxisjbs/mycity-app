import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
