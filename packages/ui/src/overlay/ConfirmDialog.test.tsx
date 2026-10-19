import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Button } from "../actions/Button";
import { ModalProvider, useModal } from "./Modal";
import { ConfirmDialog, useConfirm, type ConfirmOptions } from "./ConfirmDialog";
import { installOverlayTestEnv } from "./test-env";

beforeAll(installOverlayTestEnv);


describe("ConfirmDialog", () => {
  it("is an alertdialog named for the action, with Cancel focused", () => {
    render(<ConfirmDialog open title="Delete Rule" destructive onConfirm={() => undefined} onCancel={() => undefined} />);
    const dialog = screen.getByRole("alertdialog", { name: "Delete Rule" });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    const confirm = screen.getByRole("button", { name: "Delete Rule" });
    expect(confirm).toHaveAttribute("data-variant", "danger");
    expect(dialog.querySelector('[data-ui="modal-footer"]')).toContainElement(confirm);
  });

  it("answers no on Esc unless destructive, and on Cancel always", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(<ConfirmDialog open title="Empty Trash" onConfirm={() => undefined} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<ConfirmDialog open title="Empty Trash" destructive onConfirm={() => undefined} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("stays busy while an async confirm runs, and nothing else answers meanwhile", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Revoke Device" confirmLabel="Revoke Device" onConfirm={onConfirm} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Revoke Device" }));
    await user.click(screen.getByRole("button", { name: "Revoke Device" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Revoke Device" })).toHaveAttribute("aria-busy", "true");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).not.toBeDisabled();
    await user.click(cancel);
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Revoke Device" })).not.toHaveAttribute("aria-busy"));
    expect(cancel).not.toHaveAttribute("aria-disabled");
  });

  it("is a short sheet on a phone", () => {
    setViewport(390);
    render(<ConfirmDialog open title="Delete Rule" destructive onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("alertdialog", { name: "Delete Rule" })).toHaveAttribute("data-vaul-drawer");
  });

  it("has no accessibility violations", async () => {
    render(<ConfirmDialog open title="Delete Rule" body="Queries already raised keep their history." destructive onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe("useConfirm", () => {
  function Remove({ onAnswer, options }: { onAnswer: (ok: boolean) => void; options?: Partial<ConfirmOptions> }) {
    const confirm = useConfirm();
    return <Button onClick={async () => onAnswer(await confirm({ title: "Delete Rule", destructive: true, ...options }))}>Delete</Button>;
  }

  it("resolves true on confirm and false on cancel", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <ModalProvider>
        <Remove onAnswer={onAnswer} />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete Rule" }));
    await waitFor(() => expect(onAnswer).toHaveBeenLastCalledWith(true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onAnswer).toHaveBeenLastCalledWith(false));
  });

  it("shows above an open modal and leaves it open", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    function Record() {
      const modal = useModal();
      return <Button onClick={() => modal.open({ title: "Late Rule", body: <Remove onAnswer={onAnswer} /> })}>Open Rule</Button>;
    }
    render(
      <ModalProvider>
        <Record />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Open Rule" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog", { name: "Delete Rule" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
    expect(screen.getByRole("dialog", { name: "Late Rule" })).toBeInTheDocument();
  });

  it("answers no when the route changes or the app unmounts", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    const { rerender, unmount } = render(
      <ModalProvider resetKey="a">
        <Remove onAnswer={onAnswer} />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    rerender(
      <ModalProvider resetKey="b">
        <Remove onAnswer={onAnswer} />
      </ModalProvider>,
    );
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    unmount();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2));
  });

  it("refuses to run outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Remove onAnswer={() => undefined} />)).toThrow(/ModalProvider/);
  });
});

describe("ConfirmDialog as state", () => {
  it("works without the provider", async () => {
    const user = userEvent.setup();
    function Screen() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Remove</Button>
          <ConfirmDialog open={open} title="Remove Member" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </>
      );
    }
    render(<Screen />);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove Member" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
