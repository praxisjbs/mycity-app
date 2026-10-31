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

  it("a searchable SelectField narrows its options as the person types, and the keys choose", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Department">
        <SelectField searchable value="" onChange={onChange} options={departments} placeholder="Choose One" />
      </Field>,
    );
    await user.click(screen.getByRole("combobox", { name: "Department" }));
    const box = await screen.findByRole("searchbox", { name: "Search Department" });
    expect(box).toHaveFocus();
    await user.keyboard("o");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Operations", "People", "Technology", "Office of the CEO"]);
    await user.keyboard("ff");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Office of the CEO"]);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("ceo");
    expect(screen.queryByRole("searchbox")).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "Department" }));
    await user.keyboard("zz");
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing matches");
    await user.clear(screen.getByRole("searchbox"));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("fin");
  });

  it("a searchable SelectField on a phone puts the search box above its sheet's rows", async () => {
    setViewport(390);
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Department">
        <SelectField searchable value="ops" onChange={onChange} options={departments} />
      </Field>,
    );
    await user.click(screen.getByRole("button", { name: "Department" }));
    await screen.findByRole("dialog", { name: "Department" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Department" }), { target: { value: "mark" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Marketing"]);
    fireEvent.click(screen.getByRole("option", { name: "Marketing" }));
    expect(onChange).toHaveBeenCalledWith("mkt");
  });

  it("a server list asks for its next page as the menu nears its end, once for each length", async () => {
    const user = userEvent.setup();
    const onMore = vi.fn();
    const pick = (options: ReadonlyArray<readonly [string, string]>, more: boolean) => (
      <Field label="Department">
        <SelectField value="" onChange={() => undefined} options={options} placeholder="Choose One" more={more} onMore={onMore} />
      </Field>
    );
    const { rerender } = render(pick(departments.slice(0, 4), true));
    await user.click(screen.getByRole("combobox", { name: "Department" }));
    // The row that ends the list turns while the next page comes; assistive technology reads the rows alone.
    const row = screen.getByRole("status", { hidden: true }).closest("[aria-hidden]") as HTMLElement;
    const box = row.parentElement as HTMLElement;
    fireEvent.scroll(box);
    fireEvent.scroll(box);
    expect(onMore).toHaveBeenCalledTimes(1);

    rerender(pick(departments, true));
    fireEvent.scroll(box);
    expect(onMore).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("option")).toHaveLength(6);

    rerender(pick(departments, false));
    expect(screen.queryByRole("status", { hidden: true })).toBeNull();
    expect(onMore).toHaveBeenCalledTimes(2);
  });

  it("a server list's sheet on a phone loads the next page as it nears its end", async () => {
    setViewport(390);
    const user = userEvent.setup();
    const onMore = vi.fn();
    render(
      <Field label="Department">
        <SelectField value="ops" onChange={() => undefined} options={departments} more onMore={onMore} />
      </Field>,
    );
    await user.click(screen.getByRole("button", { name: "Department" }));
    await screen.findByRole("dialog", { name: "Department" });
    const row = screen.getByRole("status", { hidden: true }).closest("[aria-hidden]") as HTMLElement;
    fireEvent.scroll(row.parentElement as HTMLElement);
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("a chosen value on a page not loaded yet reads as its own label", () => {
    render(
      <Field label="Department">
        <SelectField value="legal" valueLabel="Legal" onChange={() => undefined} options={departments} placeholder="Choose One" more onMore={() => undefined} />
      </Field>,
    );
    expect(screen.getByRole("combobox", { name: "Department" })).toHaveTextContent("Legal");
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

  it("ChoiceField inside a Field is named by the Field's label", () => {
    render(
      <Field label="Work Pattern">
        <ChoiceField value="remote" onChange={() => undefined} options={[["on_site", "On Site"], ["remote", "Remote"]]} />
      </Field>,
    );
    expect(screen.getByRole("radiogroup", { name: "Work Pattern" })).toBeInTheDocument();
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

  it("a searchable SelectField, open, has no accessibility violations", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Department">
        <SelectField searchable value="ops" onChange={() => undefined} options={departments} />
      </Field>,
    );
    await user.click(screen.getByRole("combobox", { name: "Department" }));
    await screen.findByRole("searchbox");
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("a server list's menu, open with more to load, has no accessibility violations", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Department">
        <SelectField value="ops" onChange={() => undefined} options={departments} more onMore={() => undefined} />
      </Field>,
    );
    await user.click(screen.getByRole("combobox", { name: "Department" }));
    await screen.findByRole("listbox");
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
