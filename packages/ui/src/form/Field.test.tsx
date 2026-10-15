import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Field, FormError, FormRow } from "./Field";
import { TextField } from "./TextField";

const noop = () => undefined;

describe("Field", () => {
  it("labels its control, shows Optional, and no asterisk", () => {
    render(
      <Field label="Middle Name" optional>
        <TextField value="" onChange={noop} />
      </Field>,
    );
    expect(screen.getByLabelText("Middle Name")).toBeInTheDocument();
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("*");
  });

  it("puts the error on the field and links it", () => {
    render(
      <Field label="Work Email" state="bad" message="Check the email">
        <TextField value="ada" onChange={noop} />
      </Field>,
    );
    const input = screen.getByLabelText("Work Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Check the email");
  });

  it("with help, labels the control by id and keeps the help out of its name", () => {
    render(
      <Field label="Grace Period" help="Minutes after the shift starts before a clock-in counts as late.">
        <TextField value="" onChange={noop} />
      </Field>,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAccessibleName("Grace Period");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("FormError says nothing when empty and one line when set", () => {
    const { rerender } = render(<FormError />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<FormError>Could not reach the server</FormError>);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <FormRow>
        <Field label="First Name">
          <TextField value="Ada" onChange={noop} />
        </Field>
        <Field label="Work Email" state="bad" message="Check the email">
          <TextField value="ada" onChange={noop} />
        </Field>
      </FormRow>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
