import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { SegmentedControl } from "./SegmentedControl";

type Scope = "mine" | "team";

function Host({ onChange }: { onChange?: (v: Scope) => void }) {
  const [scope, setScope] = useState<Scope>("mine");
  return (
    <SegmentedControl
      label="Whose Tasks"
      value={scope}
      onChange={(v) => {
        setScope(v);
        onChange?.(v);
      }}
      options={[["mine", "Mine"], ["team", "My Team"]]}
    />
  );
}

describe("SegmentedControl", () => {
  it("draws the unread notifications behind a view as a yellow count, nothing for none", () => {
    render(
      <SegmentedControl
        label="Worksites"
        value="permanent"
        onChange={() => undefined}
        options={[
          { value: "permanent", label: "Permanent" },
          { value: "temporary", label: "Temporary", unread: 2 },
        ]}
      />,
    );
    const temporary = screen.getByRole("radio", { name: "Temporary 2" });
    expect(temporary.querySelector("[data-count]")).toHaveClass("bg-primary");
    expect(screen.getByRole("radio", { name: "Permanent" }).querySelector("[data-count]")).toBeNull();
  });

  it("is a named radiogroup that takes the merged tuples", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "Whose Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mine" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Mine" })).toHaveAttribute("data-ui", "button");
    await user.click(screen.getByRole("radio", { name: "My Team" }));
    expect(onChange).toHaveBeenCalledWith("team");
    expect(screen.getByRole("radio", { name: "My Team" })).toBeChecked();
  });

  it("has one Tab stop and chooses with the arrow keys, skipping disabled ones", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Period"
        value="week"
        onChange={onChange}
        disabled={["quarter"]}
        options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year", icon: "check" }]}
      />,
    );
    await user.tab();
    expect(screen.getByRole("radio", { name: "Week" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Month" })).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("month");
    expect(screen.getByRole("radio", { name: "Month" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("year");
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("month");
  });

  it("warns in development past 5 options", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<SegmentedControl label="Day" value="mon" onChange={() => undefined} options={["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, d.toUpperCase()] as [string, string])} />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("at most 5"));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Host />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
