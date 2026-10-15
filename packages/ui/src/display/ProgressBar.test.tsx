import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Meter, ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("is a named progressbar with its percent", () => {
    render(<ProgressBar label="Importing Employees" value={32} max={50} />);
    const bar = screen.getByRole("progressbar", { name: "Importing Employees" });
    expect(bar).toHaveAttribute("aria-valuenow", "64");
    expect(bar).toHaveAttribute("aria-valuetext", "64%");
    expect(bar).toHaveAttribute("data-state", "determinate");
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(bar.firstElementChild?.getAttribute("style")).toContain("--fill: 64%");
  });

  it("is busy with no value while the end is unknown", () => {
    render(<ProgressBar name="Preparing Payslips" />);
    const bar = screen.getByRole("progressbar", { name: "Preparing Payslips" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-busy", "true");
    expect(bar).toHaveAttribute("data-state", "indeterminate");
  });

  it("clamps out-of-range values", () => {
    render(<ProgressBar name="Upload" value={140} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <ProgressBar label="Importing Employees" value={64} />
        <ProgressBar label={<b>Preparing Payslips</b>} />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Meter", () => {
  it("is a meter with its figure, taking the merged colour", () => {
    const { container } = render(<Meter pct={40} label="8 of 20" color="var(--chart-2)" />);
    const meter = screen.getByRole("meter", { name: "8 of 20" });
    expect(meter).toHaveAttribute("aria-valuenow", "40");
    expect(container.querySelector(".bg-chart-2")).not.toBeNull();
  });

  it("names itself from the percent when the merged label is empty", () => {
    render(<Meter pct={72.4} label="" />);
    expect(screen.getByRole("meter", { name: "72%" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Meter pct={40} label="8 of 20" name="Annual Leave Used" tone="ok" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
