import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { FilterSelect, SearchInput } from "./SearchInput";

describe("SearchInput and FilterSelect", () => {
  it("is a named searchbox that passes each key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput label="Search Employees" value="" onChange={onChange} />);
    await user.type(screen.getByRole("searchbox", { name: "Search Employees" }), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("FilterSelect has a visible label and sends the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<FilterSelect label="Status" value="" onChange={onChange} options={[["", "All"], ["late", "Late"]]} />);
    const button = screen.getByRole("combobox", { name: "Status" });
    expect(button).toHaveTextContent("All");
    await user.click(button);
    await user.click(screen.getByRole("option", { name: "Late" }));
    expect(onChange).toHaveBeenCalledWith("late");
    rerender(<FilterSelect label="Status" value="late" onChange={onChange} options={[["", "All"], ["late", "Late"]]} />);
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(screen.getByRole("option", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <SearchInput label="Search Employees" value="ada" onChange={() => undefined} />
        <FilterSelect label="Status" value="" onChange={() => undefined} options={[["", "All"]]} />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
