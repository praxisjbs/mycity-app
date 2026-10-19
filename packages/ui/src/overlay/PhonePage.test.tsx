import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { PhonePage } from "./PhonePage";
import { installOverlayTestEnv } from "./test-env";

beforeAll(installOverlayTestEnv);

function Host({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Settings</Button>
      <PhonePage
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Notification Settings"
      >
        <p>Approvals</p>
      </PhonePage>
    </>
  );
}

describe("PhonePage", () => {
  it("opens as a dialog named by its title, and Back closes it", async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    const page = await screen.findByRole("dialog", { name: "Notification Settings" });
    expect(page).toHaveTextContent("Approvals");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes with Esc", async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(await axe(await screen.findByRole("dialog"))).toHaveNoViolations();
  });
});
