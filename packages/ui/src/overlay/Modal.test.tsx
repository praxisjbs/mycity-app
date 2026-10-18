import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Button } from "../actions/Button";
import { Grow, Modal, ModalFooter, ModalProvider, useModal } from "./Modal";
import { useDismiss, useUnsavedChanges } from "./context";
import { installOverlayTestEnv } from "./test-env";

beforeAll(installOverlayTestEnv);


function Controlled({ dirty = false, onClose = () => undefined }: { dirty?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New Rule</Button>
      <Modal
        open={open}
        dirty={dirty}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="New Rule"
        footer={(close) => (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary">Create Rule</Button>
          </>
        )}
      >
        <p>Rule body</p>
        <button type="button">Pick Trigger</button>
      </Modal>
    </>
  );
}

describe("Modal on desktop", () => {
  it("opens a labelled, modal dialog with the title and footer slots", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole("button", { name: "New Rule" }));
    const dialog = screen.getByRole("dialog", { name: "New Rule" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.querySelector('[data-ui="title"]')).toHaveTextContent("New Rule");
    const footer = dialog.querySelector('[data-ui="modal-footer"]');
    expect(footer).toContainElement(screen.getByRole("button", { name: "Create Rule" }));
    expect(dialog).toHaveFocus();
  });

  it("closes on Esc and returns focus to the opener", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Controlled onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "New Rule" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("cannot be dismissed while a button in it is working, and closes when the save does", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const onClose = vi.fn();
    function Saving() {
      const [open, setOpen] = useState(true);
      return (
        <Modal
          open={open}
          onClose={() => (onClose(), setOpen(false))}
          title="Edit Worksite"
          footer={(close) => (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={() => new Promise<void>((r) => (finish = r)).then(close)}>
                Save Worksite
              </Button>
            </>
          )}
        >
          <p>Worksite body</p>
        </Modal>
      );
    }
    render(<Saving />);
    await user.click(screen.getByRole("button", { name: "Save Worksite" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("data-press", "waiting");
    await act(async () => finish());
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole("button", { name: "New Rule" }));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("focuses the first field when there is one", async () => {
    const user = userEvent.setup();
    function WithField() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Add Grade</Button>
          <Modal open={open} onClose={() => setOpen(false)} title="Add Grade">
            <input aria-label="Grade Code" />
          </Modal>
        </>
      );
    }
    render(<WithField />);
    await user.click(screen.getByRole("button", { name: "Add Grade" }));
    expect(screen.getByRole("textbox", { name: "Grade Code" })).toHaveFocus();
  });

  it("asks once before Esc discards unsaved changes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Controlled dirty onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "New Rule" }));
    await user.keyboard("{Escape}");
    const ask = screen.getByRole("alertdialog", { name: "Discard Changes" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Keep Editing" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(ask).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New Rule" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets a form inside raise the unsaved flag, and a footer Cancel use the same check", async () => {
    const user = userEvent.setup();
    function Form() {
      const [text, setText] = useState("");
      useUnsavedChanges(text !== "");
      const dismiss = useDismiss();
      return (
        <>
          <input aria-label="Rule Name" value={text} onChange={(e) => setText(e.target.value)} />
          <ModalFooter>
            <Button onClick={dismiss}>Cancel</Button>
            <Grow />
            <Button variant="primary">Create Rule</Button>
          </ModalFooter>
        </>
      );
    }
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="New Rule">
          <Form />
        </Modal>
      );
    }
    render(<Host />);
    const footer = screen.getByRole("dialog").querySelector('[data-ui="modal-footer"]');
    expect(footer).toContainElement(screen.getByRole("button", { name: "Create Rule" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks when a form inside says it has changes", async () => {
    const user = userEvent.setup();
    function Form() {
      const [text, setText] = useState("");
      useUnsavedChanges(text !== "");
      return <input aria-label="Rule Name" value={text} onChange={(e) => setText(e.target.value)} />;
    }
    render(
      <Modal open onClose={() => undefined} title="New Rule">
        <Form />
      </Modal>,
    );
    await user.type(screen.getByRole("textbox", { name: "Rule Name" }), "Late twice");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog", { name: "Discard Changes" })).toBeInTheDocument();
  });

  it("ignores Esc and the scrim when not dismissible", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open dismissible={false} onClose={onClose} title="Sign Offer" />);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    render(
      <Modal open onClose={() => undefined} title="New Rule" sub="Raised automatically on a schedule" footer={<Button variant="primary">Create Rule</Button>}>
        <p>Rule body</p>
      </Modal>,
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe("Modal on a phone", () => {
  it("is a bottom sheet with the footer at the bottom", async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole("button", { name: "New Rule" }));
    const sheet = screen.getByRole("dialog", { name: "New Rule" });
    expect(sheet).toHaveAttribute("data-vaul-drawer");
    expect(sheet.className).toContain("bottom-0");
    expect(sheet.querySelector('[data-ui="modal-footer"]')?.className).toContain("phone:flex-col");
    expect(sheet).toHaveFocus();
  });

  it("fills the screen when full", () => {
    setViewport(390);
    render(<Modal open full onClose={() => undefined} title="New Message" />);
    expect(screen.getByRole("dialog").className).not.toContain("rounded-t-sheet");
  });

  it("asks before Esc discards unsaved changes", async () => {
    setViewport(390);
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Controlled dirty onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "New Rule" }));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog", { name: "Discard Changes" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    render(
      <Modal open onClose={() => undefined} title="New Rule" footer={<Button variant="primary">Create Rule</Button>}>
        <p>Rule body</p>
      </Modal>,
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe("useModal", () => {
  function Opener({ spec }: { spec?: Partial<Parameters<ReturnType<typeof useModal>["open"]>[0]> }) {
    const modal = useModal();
    return (
      <>
        <Button onClick={() => modal.open({ title: "New Task", body: (close) => <Button onClick={close}>Done Here</Button>, ...spec })}>New Task</Button>
        <span data-testid="state">{modal.isOpen ? "open" : "shut"}</span>
      </>
    );
  }

  it("opens a modal from anywhere and gives the body its close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ModalProvider>
        <Opener spec={{ onClose }} />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "New Task" }));
    expect(screen.getByRole("dialog", { name: "New Task" })).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    await user.click(screen.getByRole("button", { name: "Done Here" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByTestId("state")).toHaveTextContent("shut");
  });

  it("replaces rather than stacks", async () => {
    let api: ReturnType<typeof useModal> | null = null;
    function Grab() {
      api = useModal();
      return null;
    }
    render(
      <ModalProvider>
        <Grab />
      </ModalProvider>,
    );
    act(() => api!.open({ title: "Alert Rules", body: "One" }));
    act(() => api!.open({ title: "New Alert Rule", body: "Two" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "New Alert Rule" })).toHaveTextContent("Two");
  });

  it("closes when the route changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ModalProvider resetKey="/people">
        <Opener />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "New Task" }));
    rerender(
      <ModalProvider resetKey="/payroll">
        <Opener />
      </ModalProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses to run outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Opener />)).toThrow(/ModalProvider/);
  });
});

describe("Grow and ModalFooter outside an overlay", () => {
  it("draws the footer row in place", () => {
    render(
      <ModalFooter>
        <Grow />
        <Button variant="primary">Approve Leave</Button>
      </ModalFooter>,
    );
    const row = screen.getByRole("button", { name: "Approve Leave" }).parentElement;
    expect(row).toHaveAttribute("data-ui", "modal-footer");
    expect(row?.querySelector("span")?.className).toContain("mr-auto");
  });
});
