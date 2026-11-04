import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { SourceChip } from "./SourceChip";

describe("SourceChip", () => {
  it("names a kind of record with how many, and opens the pane on them", async () => {
    const onSelect = vi.fn();
    render(<SourceChip label="partnership" count={4} onSelect={onSelect} />);
    const chip = screen.getByRole("button", { name: "partnership, 4 records" });
    expect(chip.textContent).toBe("partnership ×4");
    await userEvent.click(chip);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("names the one record an answer rests on, without a count", () => {
    render(<SourceChip kind="record" label="Ayo Bello" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ayo Bello" }).textContent).toBe("Ayo Bello");
  });

  it("is a plain label with nothing to open", () => {
    render(<SourceChip label="employee" count={1} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("employee")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<SourceChip label="leave request" count={2} onSelect={vi.fn()} selected />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
