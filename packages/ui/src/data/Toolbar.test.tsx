import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { SearchInput } from "../form/SearchInput";
import { Button } from "../actions/Button";
import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  it("groups the list's controls under the list's name", () => {
    render(
      <Toolbar label="Employees">
        <SearchInput value="" onChange={vi.fn()} placeholder="Search People" />
        <Button>Clear Filters</Button>
      </Toolbar>,
    );
    const group = screen.getByRole("group", { name: "Employees" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Filters" })).toBeInTheDocument();
  });

  it("names itself when the list does not", () => {
    render(
      <Toolbar>
        <Button>Clear Filters</Button>
      </Toolbar>,
    );
    expect(screen.getByRole("group", { name: "List controls" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Toolbar label="Leave Requests">
        <SearchInput value="" onChange={vi.fn()} placeholder="Search People" />
      </Toolbar>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
