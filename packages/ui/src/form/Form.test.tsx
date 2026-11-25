import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Button } from "../actions/Button";
import { Grow, Modal } from "../overlay/Modal";
import { installOverlayTestEnv } from "../overlay/test-env";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { Form, FormFooter } from "./Form";

beforeAll(installOverlayTestEnv);

/** A New Request form in a modal: a bottom sheet on a phone, a centred dialog on desktop. */
function InModal({ onSubmit }: { onSubmit: () => unknown }) {
  return (
    <Modal open onClose={() => undefined} title="New Request">
      <Form onSubmit={onSubmit}>
        <Field label="Purpose">
          <TextField value="Generator diesel" onChange={() => undefined} />
        </Field>
        <FormFooter>
          <Button>Save Draft</Button>
          <Grow />
          <Button variant="primary" type="submit">
            Send Request
          </Button>
        </FormFooter>
      </Form>
    </Modal>
  );
}

describe("Form and FormFooter", () => {
  it("submits on Enter in a single-line form, without the browser's own checks", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <Form onSubmit={onSubmit}>
        <Field label="Rule Name">
          <TextField value="Late Three Times" onChange={() => undefined} />
        </Field>
      </Form>,
    );
    expect(document.querySelector("form")).toHaveAttribute("novalidate");
    await user.type(screen.getByLabelText("Rule Name"), "{Enter}");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("sends a save it is waiting on once, however often Enter is pressed, and spins its submit button", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(
      <Form onSubmit={onSubmit}>
        <Field label="Rule Name">
          <TextField value="Late Three Times" onChange={() => undefined} />
        </Field>
        <FormFooter>
          <Button>Cancel</Button>
          <Button variant="primary" type="submit">
            Create Rule
          </Button>
        </FormFooter>
      </Form>,
    );
    await user.type(screen.getByLabelText("Rule Name"), "{Enter}{Enter}");
    const submit = screen.getByRole("button", { name: "Create Rule" });
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("data-press", "waiting");
    await act(async () => finish());
    await waitFor(() => expect(submit).not.toHaveAttribute("aria-busy"));
    await user.type(screen.getByLabelText("Rule Name"), "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("spins the button that submitted it from outside, by form=", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(
      <div>
        <Form id="unlock" onSubmit={onSubmit}>
          <Field label="PIN">
            <TextField value="2468" onChange={() => undefined} />
          </Field>
        </Form>
        <Button variant="primary" type="submit" form="unlock" icon="lock">
          Unlock
        </Button>
      </div>,
    );
    const unlock = screen.getByRole("button", { name: "Unlock" });
    await user.click(unlock);
    expect(unlock).toHaveAttribute("aria-busy", "true");
    await user.click(unlock);
    expect(onSubmit).toHaveBeenCalledOnce();
    await act(async () => finish());
    await waitFor(() => expect(unlock).not.toHaveAttribute("aria-busy"));
  });

  it("FormFooter holds buttons, the primary last", () => {
    render(
      <FormFooter>
        <Button>Cancel</Button>
        <Button variant="primary" type="submit">
          Create Rule
        </Button>
      </FormFooter>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Create Rule"]);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Form onSubmit={() => undefined}>
        <Field label="Rule Name">
          <TextField value="" onChange={() => undefined} />
        </Field>
        <FormFooter>
          <Button>Cancel</Button>
          <Button variant="primary" type="submit">
            Create Rule
          </Button>
        </FormFooter>
      </Form>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("FormFooter in a sheet on a phone", () => {
  it("pins its buttons in the sheet's footer, out of the scrolling body, the primary last", async () => {
    setViewport(390);
    render(<InModal onSubmit={() => undefined} />);
    const sheet = await screen.findByRole("dialog", { name: "New Request" });
    const footer = sheet.querySelector<HTMLElement>('[data-ui="modal-footer"]');
    expect(footer).not.toBeNull();
    const send = within(footer!).getByRole("button", { name: "Send Request" });
    expect(within(footer!).getAllByRole("button").map((b) => b.textContent)).toEqual(["Save Draft", "Send Request"]);
    // Out of the form in the page, so it never scrolls away with the fields.
    expect(sheet.querySelector("form")?.contains(send)).toBe(false);
  });

  it("still submits its form from the pinned footer, by the button or by Enter, once while it saves", async () => {
    setViewport(390);
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<InModal onSubmit={onSubmit} />);
    const sheet = await screen.findByRole("dialog", { name: "New Request" });
    const form = sheet.querySelector("form")!;
    const send = screen.getByRole("button", { name: "Send Request" });
    expect(send).toHaveAttribute("form", form.id);
    // The draft button is not a submit button: it names no form.
    expect(screen.getByRole("button", { name: "Save Draft" })).not.toHaveAttribute("form");
    await user.click(send);
    expect(onSubmit).toHaveBeenCalledOnce();
    // One press, one request (F26): it spins, the button beside it waits, a second press does nothing.
    expect(send).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Save Draft" })).toHaveAttribute("data-press", "waiting");
    await user.click(send);
    expect(onSubmit).toHaveBeenCalledOnce();
    await act(async () => finish());
    await waitFor(() => expect(send).not.toHaveAttribute("aria-busy"));
    await user.type(screen.getByLabelText("Purpose"), "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("folds a Grow away in the pinned footer", async () => {
    setViewport(390);
    render(<InModal onSubmit={() => undefined} />);
    const footer = (await screen.findByRole("dialog")).querySelector('[data-ui="modal-footer"]')!;
    expect(footer.querySelector('[aria-hidden="true"].mr-auto')?.className).toContain("phone:hidden");
  });

  it("keeps the buttons at the form's foot on desktop", async () => {
    setViewport(1440);
    render(<InModal onSubmit={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "New Request" });
    const send = within(dialog).getByRole("button", { name: "Send Request" });
    expect(dialog.querySelector("form")?.contains(send)).toBe(true);
    expect(send).not.toHaveAttribute("form");
  });

  it("keeps the buttons in place on a phone page, outside any sheet", () => {
    setViewport(390);
    render(
      <Form onSubmit={() => undefined}>
        <FormFooter>
          <Button variant="primary" type="submit">
            Create Rule
          </Button>
        </FormFooter>
      </Form>,
    );
    expect(document.querySelector("form")?.contains(screen.getByRole("button", { name: "Create Rule" }))).toBe(true);
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    render(<InModal onSubmit={() => undefined} />);
    await screen.findByRole("dialog");
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
