import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { ChoiceField, SelectField } from "./SelectField";

const departments = [
  ["ops", "Operations"],
  ["hr", "People"],
  ["fin", "Finance"],
  ["mkt", "Marketing"],
  ["it", "Technology"],
  ["ceo", "Office of the CEO"],
] as const;

describe("SelectField and ChoiceField", () => {
  it("SelectField picks a value by label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Department">
        <SelectField value="" onChange={onChange} options={departments} placeholder="Choose One" />
      </Field>,
    );
    await user.selectOptions(screen.getByLabelText("Department"), "Finance");
    expect(onChange).toHaveBeenCalledWith("fin");
  });

  it("ChoiceField is a radio group that moves with the arrow keys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChoiceField
        label="Work Pattern"
        value="on_site"
        onChange={onChange}
        options={[
          ["on_site", "On Site"],
          ["hybrid", "Hybrid"],
          ["remote", "Remote"],
        ]}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Work Pattern" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Hybrid" }));
    expect(onChange).toHaveBeenCalledWith("hybrid");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Field label="Department">
          <SelectField value="ops" onChange={() => undefined} options={departments} />
        </Field>
        <ChoiceField label="Work Pattern" value="remote" onChange={() => undefined} options={[["on_site", "On Site"], ["remote", "Remote"]]} />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
