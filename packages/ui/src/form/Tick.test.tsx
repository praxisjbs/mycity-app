import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Tick } from "./Tick";

describe("Tick", () => {
  it("is a checkbox named by what it picks", () => {
    render(<Tick checked={false} onChange={vi.fn()} label="Select Ada Obi" />);
    expect(screen.getByRole("checkbox", { name: "Select Ada Obi" })).toBeInTheDocument();
  });

  it("reports the new state on a press", async () => {
    const onChange = vi.fn();
    render(<Tick checked={false} onChange={onChange} label="Select Page" />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not let the press reach the row underneath", async () => {
    const onRow = vi.fn();
    const onChange = vi.fn();
    // A button stands in for the row the tick sits on.
    render(
      <button type="button" onClick={onRow}>
        <Tick checked={false} onChange={onChange} label="Select Ada Obi" />
      </button>,
    );
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("keeps a 44 px target around the box", () => {
    render(<Tick checked onChange={vi.fn()} label="Select Page" />);
    expect(screen.getByRole("checkbox").className).toContain("size-tap");
  });

  it("cannot be pressed when disabled", async () => {
    const onChange = vi.fn();
    render(<Tick checked={false} onChange={onChange} label="Select Page" disabled />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Tick checked={false} onChange={vi.fn()} label="Select Page" />
        <Tick checked onChange={vi.fn()} label="Select Ada Obi" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
