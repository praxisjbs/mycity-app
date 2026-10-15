import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Button } from "../actions/Button";
import { SidePanel } from "./SidePanel";
import { installOverlayTestEnv } from "./test-env";

beforeAll(installOverlayTestEnv);


describe("SidePanel", () => {
  it("sits on the right edge on desktop", () => {
    render(
      <SidePanel open onClose={() => undefined} title="Edit Employee" footer={<Button variant="primary">Save Changes</Button>}>
        <p>Cynthia Osakunih</p>
      </SidePanel>,
    );
    const panel = screen.getByRole("dialog", { name: "Edit Employee" });
    expect(panel.className).toContain("h-full");
    expect(panel.className).toContain("border-l");
    expect(panel.parentElement?.className).toContain("justify-items-end");
  });

  it("is a full-screen sheet on a phone", () => {
    setViewport(390);
    render(<SidePanel open onClose={() => undefined} title="Edit Employee" />);
    const sheet = screen.getByRole("dialog", { name: "Edit Employee" });
    expect(sheet).toHaveAttribute("data-vaul-drawer");
    expect(sheet.className).not.toContain("rounded-t-sheet");
  });

  it("closes on Esc, asking first when there are unsaved changes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<SidePanel open onClose={onClose} title="Edit Employee" />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<SidePanel open dirty onClose={onClose} title="Edit Employee" />);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog", { name: "Discard Changes" })).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    render(
      <SidePanel open onClose={() => undefined} title="Edit Employee">
        <p>Cynthia Osakunih</p>
      </SidePanel>,
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
