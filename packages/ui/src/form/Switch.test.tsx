import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { CheckboxField, Switch, ToggleRow } from "./Switch";

describe("Switch, ToggleRow, CheckboxField", () => {
  it("Switch is a named switch that toggles with Space", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Late Alerts" />);
    const sw = screen.getByRole("switch", { name: "Late Alerts" });
    sw.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("ToggleRow names its switch by its title", () => {
    render(<ToggleRow title="Weekend Shifts" text="Saturdays 09:00 to 15:00" checked onChange={() => undefined} />);
    expect(screen.getByRole("switch", { name: "Weekend Shifts" })).toBeChecked();
  });

  it("CheckboxField ticks by its own label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckboxField label="Send a Copy to Me" value={false} onChange={onChange} />);
    await user.click(screen.getByText("Send a Copy to Me"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <ToggleRow title="Late Alerts" checked={false} onChange={() => undefined} />
        <CheckboxField label="Send a Copy to Me" value onChange={() => undefined} />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
