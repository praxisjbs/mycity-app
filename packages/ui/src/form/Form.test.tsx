import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
