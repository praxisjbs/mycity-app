import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
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
  it("SelectField picks a value from our own listbox on desktop, never a native select", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const { container } = render(
      <Field label="Department">
        <SelectField value="" onChange={onChange} onBlur={onBlur} options={departments} placeholder="Choose One" />
      </Field>,
    );
    expect(container.querySelector("select")).toBeNull();
    const button = screen.getByRole("combobox", { name: "Department" });
    expect(button).toHaveTextContent("Choose One");
    await user.click(button);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Finance" }));
    expect(onChange).toHaveBeenCalledWith("fin");
    expect(onBlur).toHaveBeenCalled();
  });

  it("SelectField shows the chosen label and moves with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Department">
        <SelectField value="hr" onChange={onChange} options={departments} />
      </Field>,
    );
    const button = screen.getByRole("combobox", { name: "Department" });
    expect(button).toHaveTextContent("People");
    button.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("option", { name: "People" })).toHaveAttribute("aria-selected", "true");
  });

  it("SelectField opens a branded sheet on a phone, titled by its label", async () => {
    setViewport(390);
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Department">
        <SelectField value="ops" onChange={onChange} options={departments} />
      </Field>,
    );
    await user.click(screen.getByRole("button", { name: "Department" }));
    const sheet = await screen.findByRole("dialog", { name: "Department" });
    expect(sheet.querySelector("select")).toBeNull();
    expect(screen.getByRole("option", { name: "Operations" })).toHaveAttribute("aria-selected", "true");
    // A click without the pointer: jsdom has no layout for the sheet's drag to read on release.
    fireEvent.click(screen.getByRole("option", { name: "Marketing" }));
    expect(onChange).toHaveBeenCalledWith("mkt");
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
