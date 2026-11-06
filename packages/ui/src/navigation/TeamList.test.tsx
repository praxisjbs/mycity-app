import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { TeamList } from "./TeamList";

const items = [
  { value: "", label: "All Teams", count: 12 },
  { value: "MKT", label: "Marketing & Sales", count: 4 },
  { value: "STU", label: "Studio", count: 2 },
];

describe("TeamList", () => {
  it("marks the team picked and passes the one pressed", async () => {
    const onChange = vi.fn();
    render(<TeamList label="Teams" items={items} value="" onChange={onChange} />);
    const list = screen.getByRole("list", { name: "Teams" });
    expect(list).toHaveClass("ps-teams");
    expect(screen.getByRole("button", { name: "All Teams 12" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Studio 2" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Marketing & Sales 4" }));
    expect(onChange).toHaveBeenCalledWith("MKT");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<TeamList label="Teams" items={items} value="MKT" onChange={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
