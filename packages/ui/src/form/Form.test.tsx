import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { Form, FormFooter } from "./Form";

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
