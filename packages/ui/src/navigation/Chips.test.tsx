import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Chips } from "./Chips";

type Status = "all" | "late" | "remote";

function Single({ onChange }: { onChange?: (v: Status) => void }) {
  const [status, setStatus] = useState<Status>("all");
  return (
    <Chips
      label="Status"
      value={status}
      onChange={(v) => {
        setStatus(v);
        onChange?.(v);
      }}
      options={[["all", "Everyone"], { value: "late", label: "Late", count: 4 }, { value: "remote", label: "Remote", count: 1200 }]}
    />
  );
}

describe("Chips", () => {
  it("draws the unread notifications behind a chip as a yellow count after its own, red and at least 1 while urgent", () => {
    render(
      <Chips
        label="State"
        value="all"
        options={[
          { value: "all", label: "All", unread: 2 },
          { value: "late", label: "Late", count: 4, unread: 1 },
          { value: "cancelled", label: "Cancelled", urgent: true },
          { value: "done", label: "Done", unread: 0 },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "All 2 unread" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Late 4 1 unread" })).toBeInTheDocument();
    const urgent = screen.getByRole("button", { name: "Cancelled 1 unread" });
    expect(urgent.querySelector("[data-count]")).toHaveClass("bg-destructive");
    expect(screen.getByRole("button", { name: "All 2 unread" }).querySelector("[data-count]")).toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: "Done" }).querySelector("[data-count]")).toBeNull();
  });

  it("chooses one, with aria-pressed, a slot on each chip and counts beside the label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Single onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
    const late = screen.getByRole("button", { name: "Late 4" });
    expect(late).toHaveAttribute("data-ui", "button");
    expect(screen.getByRole("button", { name: "Remote 1,200" })).toBeInTheDocument();
    await user.click(late);
    expect(onChange).toHaveBeenCalledWith("late");
    expect(late).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "false");
    await user.click(late);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("toggles several on and off with selected, from the keyboard too", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    function Toggle() {
      const [depts, setDepts] = useState<string[]>(["Operations"]);
      return (
        <Chips
          label="Departments"
          selected={depts}
          onSelectedChange={(next) => {
            setDepts(next);
            onSelectedChange(next);
          }}
          options={["Operations", "People", "Finance"].map((d) => [d, d] as [string, string])}
        />
      );
    }
    render(<Toggle />);
    await user.click(screen.getByRole("button", { name: "People" }));
    expect(onSelectedChange).toHaveBeenLastCalledWith(["Operations", "People"]);
    screen.getByRole("button", { name: "Operations" }).focus();
    await user.keyboard(" ");
    expect(onSelectedChange).toHaveBeenLastCalledWith(["People"]);
    expect(screen.getByRole("button", { name: "Operations" })).toHaveAttribute("aria-pressed", "false");
  });

  it("scrolls sideways inside itself on a phone and keeps 44 px targets", () => {
    render(<Single />);
    expect(screen.getByRole("group").className).toContain("overflow-x-auto");
    expect(screen.getByRole("button", { name: "Everyone" }).className).toContain("phone:min-h-tap");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Single />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
